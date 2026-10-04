import CryptoKit
import Foundation

public struct AtomicUnits: Codable, Hashable, Comparable, Sendable {
    public let value: String

    public init(_ value: String) throws {
        guard value.range(of: #"^(0|[1-9][0-9]*)$"#, options: .regularExpression) != nil,
              value.count <= 39
        else { throw PayrailSDKError.invalidField("atomic units must be canonical u128") }
        self.value = value
        _ = try encodedUnsigned(length: 16)
    }

    public static func < (lhs: AtomicUnits, rhs: AtomicUnits) -> Bool {
        lhs.value.count == rhs.value.count ? lhs.value < rhs.value : lhs.value.count < rhs.value.count
    }

    func encodedUnsigned(length: Int) throws -> Data {
        var bytes = [UInt8](repeating: 0, count: length)
        for character in value.utf8 {
            var carry = Int(character - 48)
            for index in bytes.indices.reversed() {
                let next = Int(bytes[index]) * 10 + carry
                bytes[index] = UInt8(next & 0xff)
                carry = next >> 8
            }
            guard carry == 0 else {
                throw PayrailSDKError.invalidField("atomic units exceed u128")
            }
        }
        return Data(bytes)
    }
}

public struct TransferIntent: Sendable {
    public let networkID: Data
    public let idempotencyKey: Data
    public let assetID: Data
    public let recipientAccountID: Data
    public let amount: AtomicUnits
    public let fee: AtomicUnits
    public let nonce: UInt64
    public let validUntilHeight: UInt64

    public init(
        networkID: Data,
        idempotencyKey: Data,
        assetID: Data,
        recipientAccountID: Data,
        amount: AtomicUnits,
        fee: AtomicUnits,
        nonce: UInt64,
        validUntilHeight: UInt64
    ) throws {
        try requireLength(networkID, 32, "networkID")
        try requireLength(idempotencyKey, 32, "idempotencyKey")
        try requireLength(assetID, 32, "assetID")
        try requireLength(recipientAccountID, 32, "recipientAccountID")
        self.networkID = networkID
        self.idempotencyKey = idempotencyKey
        self.assetID = assetID
        self.recipientAccountID = recipientAccountID
        self.amount = amount
        self.fee = fee
        self.nonce = nonce
        self.validUntilHeight = validUntilHeight
    }
}

public struct PayrailWallet: Sendable {
    private static let authorizationDomain = Data("ledger.authorization\0".utf8)
    private static let envelopeDomain = Data("ledger.envelope\0".utf8)
    private let key: Curve25519.Signing.PrivateKey
    public let prefix: String
    public let publicKey: Data
    public let accountID: String
    public let address: String

    public init(prefix: String, privateKeySeed: Data) throws {
        guard prefix.range(of: #"^[a-z0-9]{1,20}$"#, options: .regularExpression) != nil else {
            throw PayrailSDKError.invalidField("address prefix is invalid")
        }
        do { key = try Curve25519.Signing.PrivateKey(rawRepresentation: privateKeySeed) }
        catch { throw PayrailSDKError.invalidField("private key seed must contain 32 bytes") }
        self.prefix = prefix
        publicKey = key.publicKey.rawRepresentation
        accountID = publicKey.hex
        address = try Bech32m.encode(prefix: prefix, payload: Data([0]) + publicKey)
    }

    public func sign(_ message: Data) throws -> Data {
        try key.signature(for: message)
    }

    public func signTransfer(_ intent: TransferIntent) throws -> Data {
        var operation = Data([0])
        operation.append(intent.networkID)
        operation.append(intent.idempotencyKey)
        operation.append(intent.assetID)
        operation.append(publicKey)
        operation.append(intent.recipientAccountID)
        operation.append(try intent.amount.encodedUnsigned(length: 16))
        operation.append(try intent.fee.encodedUnsigned(length: 16))
        operation.append(intent.nonce.bigEndianData)
        operation.append(intent.validUntilHeight.bigEndianData)

        let message = Self.authorizationDomain + Data([0]) + operation
        let signature = try sign(message)
        return Self.envelopeDomain + operation + publicKey + signature + Data([0])
    }

    public func approvalCodeRequest(
        networkID: Data,
        deviceID: Data,
        issuedAtMilliseconds: UInt64 = UInt64(Date().timeIntervalSince1970 * 1_000)
    ) async throws -> ApprovalCodeIssueRequest {
        try await PayrailCode.issueRequest(
            accountAddress: address,
            networkID: networkID,
            publicKey: publicKey,
            deviceID: deviceID,
            issuedAtMilliseconds: issuedAtMilliseconds,
            signer: { [self] message in try self.sign(message) }
        )
    }

    public static func accountID(from address: String, prefix: String) throws -> Data {
        let decoded = try Bech32m.decode(address)
        guard decoded.prefix == prefix,
              decoded.payload.count == 33,
              decoded.payload.first == 0
        else { throw PayrailSDKError.invalidField("address is not a supported account") }
        return decoded.payload.dropFirst()
    }
}

private enum Bech32m {
    private static let alphabet = Array("qpzry9x8gf2tvdw0s3jn54khce6mua7l")
    private static let checksumConstant: UInt64 = 0x2bc830a3

    static func encode(prefix: String, payload: Data) throws -> String {
        let words = try convertBits(Array(payload), from: 8, to: 5, pad: true)
        let values = hrpExpand(prefix) + words + [UInt8](repeating: 0, count: 6)
        let polymod = checksum(values) ^ checksumConstant
        let check = (0..<6).map { UInt8((polymod >> UInt64(5 * (5 - $0))) & 31) }
        return prefix + "1" + (words + check).map { String(alphabet[Int($0)]) }.joined()
    }

    static func decode(_ value: String) throws -> (prefix: String, payload: Data) {
        guard value == value.lowercased(),
              let separator = value.lastIndex(of: "1"),
              separator != value.startIndex
        else { throw PayrailSDKError.invalidField("address is malformed") }
        let prefix = String(value[..<separator])
        let encoded = value[value.index(after: separator)...]
        guard encoded.count >= 6 else { throw PayrailSDKError.invalidField("address is malformed") }
        let words = try encoded.map { character -> UInt8 in
            guard let index = alphabet.firstIndex(of: character) else {
                throw PayrailSDKError.invalidField("address is malformed")
            }
            return UInt8(index)
        }
        guard checksum(hrpExpand(prefix) + words) == checksumConstant else {
            throw PayrailSDKError.invalidField("address checksum is invalid")
        }
        return (prefix, Data(try convertBits(Array(words.dropLast(6)), from: 5, to: 8, pad: false)))
    }

    private static func hrpExpand(_ prefix: String) -> [UInt8] {
        prefix.utf8.map { $0 >> 5 } + [0] + prefix.utf8.map { $0 & 31 }
    }

    private static func checksum(_ values: [UInt8]) -> UInt64 {
        let generators: [UInt64] = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
        return values.reduce(UInt64(1)) { current, value in
            let top = current >> 25
            var next = ((current & 0x1ffffff) << 5) ^ UInt64(value)
            for index in 0..<5 where ((top >> UInt64(index)) & 1) != 0 { next ^= generators[index] }
            return next
        }
    }

    private static func convertBits(
        _ input: [UInt8], from: Int, to: Int, pad: Bool
    ) throws -> [UInt8] {
        var accumulator = 0
        var bits = 0
        let maximum = (1 << to) - 1
        var output: [UInt8] = []
        for value in input {
            guard Int(value) >> from == 0 else { throw PayrailSDKError.invalidField("address is malformed") }
            accumulator = (accumulator << from) | Int(value)
            bits += from
            while bits >= to {
                bits -= to
                output.append(UInt8((accumulator >> bits) & maximum))
            }
        }
        if pad, bits > 0 { output.append(UInt8((accumulator << (to - bits)) & maximum)) }
        if !pad && (bits >= from || ((accumulator << (to - bits)) & maximum) != 0) {
            throw PayrailSDKError.invalidField("address padding is invalid")
        }
        return output
    }
}

private func requireLength(_ value: Data, _ length: Int, _ name: String) throws {
    guard value.count == length else {
        throw PayrailSDKError.invalidField("\(name) must contain \(length) bytes")
    }
}

private extension UInt64 {
    var bigEndianData: Data {
        var value = bigEndian
        return withUnsafeBytes(of: &value) { Data($0) }
    }
}
