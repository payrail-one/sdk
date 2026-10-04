import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum PayrailSDKError: Error, Equatable {
    case invalidField(String)
    case invalidVault
    case vaultAuthenticationFailed
    case cryptographyFailure
    case invalidResponse
    case api(status: Int, message: String)
}

public struct ApprovalCodeIssueRequest: Codable, Equatable, Sendable {
    public let accountAddress: String
    public let deviceId: String
    public let issuedAtMs: String
    public let nonce: String
    public let signature: String
}

public struct IssuedApprovalCode: Codable, Equatable, Sendable {
    public let code: String
    public let sessionToken: String
    public let expiresAtMs: String
}

public struct NetworkAsset: Codable, Equatable, Sendable {
    public let id: String
    public let symbol: String
    public let decimals: UInt8
}

public struct Checkout: Codable, Equatable, Sendable {
    public let id: String
    public let merchantLabel: String
    public let merchantAddress: String
    public let amount: String
    public let fee: String
    public let asset: NetworkAsset
    public let status: String
    public let expiresAtMs: String
    public let validUntilHeight: String
    public let paymentPath: String
    public let smsText: String
    public let transaction: FinalizedTransaction?
}

public struct ApprovalCodeChallenge: Codable, Equatable, Sendable {
    public let status: String
    public let checkout: Checkout?
}

public enum PayrailCode {
    private static let domain = Data("payrail.approval.issue.v1\0".utf8)

    public static func issueMessage(
        networkID: Data,
        publicKey: Data,
        deviceID: Data,
        issuedAtMilliseconds: UInt64,
        nonce: Data
    ) throws -> Data {
        try requireLength(networkID, 32, "networkID")
        try requireLength(publicKey, 32, "publicKey")
        try requireLength(deviceID, 32, "deviceID")
        try requireLength(nonce, 32, "nonce")
        var timestamp = issuedAtMilliseconds.bigEndian
        let timestampData = withUnsafeBytes(of: &timestamp) { Data($0) }
        var message = Data(capacity: 162)
        message.append(domain)
        message.append(networkID)
        message.append(publicKey)
        message.append(deviceID)
        message.append(timestampData)
        message.append(nonce)
        return message
    }

    public static func issueRequest(
        accountAddress: String,
        networkID: Data,
        publicKey: Data,
        deviceID: Data,
        issuedAtMilliseconds: UInt64 = UInt64(Date().timeIntervalSince1970 * 1_000),
        nonce: Data? = nil,
        signer: @Sendable (Data) async throws -> Data
    ) async throws -> ApprovalCodeIssueRequest {
        let requestNonce = nonce ?? randomBytes(count: 32)
        let message = try issueMessage(
            networkID: networkID,
            publicKey: publicKey,
            deviceID: deviceID,
            issuedAtMilliseconds: issuedAtMilliseconds,
            nonce: requestNonce
        )
        let signature = try await signer(message)
        try requireLength(signature, 64, "signature")
        return ApprovalCodeIssueRequest(
            accountAddress: accountAddress,
            deviceId: deviceID.hex,
            issuedAtMs: String(issuedAtMilliseconds),
            nonce: requestNonce.hex,
            signature: signature.hex
        )
    }

    public static func createDeviceID() -> Data {
        randomBytes(count: 32)
    }

    private static func requireLength(_ value: Data, _ length: Int, _ name: String) throws {
        guard value.count == length else {
            throw PayrailSDKError.invalidField("\(name) must contain \(length) bytes")
        }
    }

    private static func randomBytes(count: Int) -> Data {
        var generator = SystemRandomNumberGenerator()
        return Data((0..<count).map { _ in UInt8.random(in: .min ... .max, using: &generator) })
    }
}

public struct PayrailCodeClient: Sendable {
    private let transport: PayrailAPITransport

    public init(apiBaseURL: URL, session: URLSession = .shared) throws {
        transport = try PayrailAPITransport(baseURL: apiBaseURL, session: session)
    }

    public func issue(_ requestBody: ApprovalCodeIssueRequest) async throws -> IssuedApprovalCode {
        let issued: IssuedApprovalCode = try await transport.request(
            path: "approval-codes", method: "POST", body: requestBody
        )
        guard issued.code.range(of: #"^[0-9]{6}$"#, options: .regularExpression) != nil,
              issued.expiresAtMs.range(of: #"^[1-9][0-9]*$"#, options: .regularExpression) != nil
        else {
            throw PayrailSDKError.invalidResponse
        }
        return issued
    }

    public func challenge(sessionToken: String) async throws -> ApprovalCodeChallenge {
        guard sessionToken.range(of: #"^[0-9a-f]{144}$"#, options: .regularExpression) != nil else {
            throw PayrailSDKError.invalidField("session token is malformed")
        }
        let challenge: ApprovalCodeChallenge = try await transport.request(
            path: "approval-codes/sessions/\(sessionToken)", method: "GET"
        )
        guard (challenge.status == "waiting" && challenge.checkout == nil)
                || (["claimed", "finalized"].contains(challenge.status) && challenge.checkout != nil)
        else {
            throw PayrailSDKError.invalidResponse
        }
        return challenge
    }

}
