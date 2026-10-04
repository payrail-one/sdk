import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct NetworkStatus: Codable, Equatable, Sendable {
    public let networkId: String
    public let addressPrefix: String
    public let finalizedHeight: String
    public let finalityMode: String
    public let validatorCount: Int
    public let onlineValidators: Int
    public let quorumWeight: Int
    public let asset: NetworkAsset
}

public struct AccountState: Codable, Equatable, Sendable {
    public let address: String
    public let accountId: String
    public let nonce: String
    public let balance: String
    public let finalizedHeight: String
}

public struct FinalizedTransaction: Codable, Equatable, Sendable {
    public let id: String
    public let blockHeight: String
    public let operationIndex: String
    public let from: String
    public let to: String
    public let amount: String
    public let fee: String
    public let outcome: String
    public let kind: String
}

public struct FinalizedBlock: Codable, Equatable, Sendable {
    public let height: String
    public let hash: String
    public let stateRoot: String
    public let transactionCount: Int
}

public struct SubmissionResult: Codable, Equatable, Sendable {
    public let transaction: FinalizedTransaction
    public let checkpoint: FinalizedBlock
}

public struct ExplorerOverview: Codable, Equatable, Sendable {
    public let status: NetworkStatus
    public let blocks: [FinalizedBlock]
    public let transactions: [FinalizedTransaction]
}

public struct PayrailClient: Sendable {
    private let transport: PayrailAPITransport

    public init(apiBaseURL: URL, session: URLSession = .shared) throws {
        transport = try PayrailAPITransport(baseURL: apiBaseURL, session: session)
    }

    public func status() async throws -> NetworkStatus {
        let value: NetworkStatus = try await transport.request(path: "status", method: "GET")
        guard value.networkId.isLowercaseHex(bytes: 32),
              value.asset.id.isLowercaseHex(bytes: 32),
              value.finalizedHeight.isCanonicalUnsigned,
              value.asset.decimals <= 18,
              value.validatorCount >= value.onlineValidators,
              value.onlineValidators >= value.quorumWeight,
              value.quorumWeight > 0
        else { throw PayrailSDKError.invalidResponse }
        return value
    }

    public func account(address: String) async throws -> AccountState {
        let encoded = try pathComponent(address)
        let value: AccountState = try await transport.request(
            path: "accounts/\(encoded)", method: "GET"
        )
        guard value.address == address,
              value.accountId.isLowercaseHex(bytes: 32),
              value.nonce.isCanonicalUnsigned,
              value.balance.isCanonicalUnsigned,
              value.finalizedHeight.isCanonicalUnsigned
        else { throw PayrailSDKError.invalidResponse }
        return value
    }

    public func faucet(address: String) async throws -> SubmissionResult {
        try await transport.request(
            path: "faucet", method: "POST", body: AddressRequest(address: address)
        )
    }

    public func submit(envelope: Data) async throws -> SubmissionResult {
        guard !envelope.isEmpty else {
            throw PayrailSDKError.invalidField("envelope cannot be empty")
        }
        return try await transport.request(
            path: "transactions", method: "POST", body: EnvelopeRequest(envelope: envelope.hex)
        )
    }

    public func checkout(id: String) async throws -> Checkout {
        let encoded = try pathComponent(id)
        let value: Checkout = try await transport.request(
            path: "checkouts/\(encoded)", method: "GET"
        )
        guard value.id == id else { throw PayrailSDKError.invalidResponse }
        return value
    }

    public func overview() async throws -> ExplorerOverview {
        try await transport.request(path: "explorer", method: "GET")
    }

    public func submitCheckout(id: String, envelope: Data) async throws -> Checkout {
        let encoded = try pathComponent(id)
        guard !envelope.isEmpty else {
            throw PayrailSDKError.invalidField("envelope cannot be empty")
        }
        let value: Checkout = try await transport.request(
            path: "checkouts/\(encoded)/transactions",
            method: "POST",
            body: EnvelopeRequest(envelope: envelope.hex)
        )
        guard value.id == id else { throw PayrailSDKError.invalidResponse }
        return value
    }
}

struct PayrailAPITransport: Sendable {
    private let baseURL: URL
    private let session: URLSession

    init(baseURL: URL, session: URLSession) throws {
        guard (baseURL.scheme == "https" || baseURL.host == "localhost"),
              baseURL.user == nil,
              baseURL.password == nil,
              baseURL.query == nil,
              baseURL.fragment == nil
        else { throw PayrailSDKError.invalidField("apiBaseURL must use HTTPS") }
        self.baseURL = baseURL
        self.session = session
    }

    func request<Response: Decodable & Sendable>(
        path: String, method: String
    ) async throws -> Response {
        try await request(path: path, method: method, encodedBody: nil)
    }

    func request<Response: Decodable & Sendable, Body: Encodable & Sendable>(
        path: String, method: String, body: Body
    ) async throws -> Response {
        try await request(path: path, method: method, encodedBody: try JSONEncoder().encode(body))
    }

    private func request<Response: Decodable & Sendable>(
        path: String, method: String, encodedBody: Data?
    ) async throws -> Response {
        let url = baseURL.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = encodedBody
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if encodedBody != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await session.data(for: request)
        guard data.count <= 1_048_576, let http = response as? HTTPURLResponse else {
            throw PayrailSDKError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let failure = try? JSONDecoder().decode(APIErrorBody.self, from: data)
            throw PayrailSDKError.api(
                status: http.statusCode,
                message: failure?.error ?? "request failed"
            )
        }
        do { return try JSONDecoder().decode(Response.self, from: data) }
        catch { throw PayrailSDKError.invalidResponse }
    }
}

private struct AddressRequest: Encodable, Sendable { let address: String }
private struct EnvelopeRequest: Encodable, Sendable { let envelope: String }
private struct APIErrorBody: Decodable { let error: String }

private func pathComponent(_ value: String) throws -> String {
    guard !value.isEmpty,
          value.count <= 256,
          let encoded = value.addingPercentEncoding(withAllowedCharacters: .alphanumerics)
    else { throw PayrailSDKError.invalidField("path identifier is invalid") }
    return encoded
}

private extension String {
    var isCanonicalUnsigned: Bool {
        range(of: #"^(0|[1-9][0-9]*)$"#, options: .regularExpression) != nil
    }

    func isLowercaseHex(bytes: Int) -> Bool {
        count == bytes * 2 && range(of: #"^[0-9a-f]+$"#, options: .regularExpression) != nil
    }
}

extension Data {
    var hex: String { map { String(format: "%02x", $0) }.joined() }
}
