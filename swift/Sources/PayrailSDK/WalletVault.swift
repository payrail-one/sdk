import CommonCrypto
import CryptoKit
import Foundation
import Security

public struct EncryptedWalletVault: Codable, Equatable, Sendable {
    public let version: Int
    public let address: String
    public let publicKey: String
    public let salt: String
    public let iv: String
    public let ciphertext: String

    public init(
        version: Int,
        address: String,
        publicKey: String,
        salt: String,
        iv: String,
        ciphertext: String
    ) {
        self.version = version
        self.address = address
        self.publicKey = publicKey
        self.salt = salt
        self.iv = iv
        self.ciphertext = ciphertext
    }
}

public enum WalletVault {
    public static let passwordIterations: UInt32 = 600_000
    public static let maximumJSONBytes = 32_768

    private static let domain = "payrail.wallet.v1"
    private static let privateKeyInfoPrefix = Data([
        0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
        0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
    ])

    public static func create(
        prefix: String,
        privateKeySeed: Data,
        password: String
    ) throws -> EncryptedWalletVault {
        try create(
            prefix: prefix,
            privateKeySeed: privateKeySeed,
            password: password,
            salt: secureRandomBytes(count: 16),
            iv: secureRandomBytes(count: 12)
        )
    }

    public static func encode(_ vault: EncryptedWalletVault) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(vault)
        guard data.count <= maximumJSONBytes else { throw PayrailSDKError.invalidVault }
        return data
    }

    public static func decode(_ data: Data) throws -> EncryptedWalletVault {
        guard !data.isEmpty, data.count <= maximumJSONBytes,
              let vault = try? JSONDecoder().decode(EncryptedWalletVault.self, from: data)
        else { throw PayrailSDKError.invalidVault }
        try validate(vault)
        return vault
    }

    public static func restoreSeed(
        prefix: String,
        password: String,
        vault: EncryptedWalletVault
    ) throws -> Data {
        try validatePassword(password)
        try validate(vault)
        guard let publicKey = canonicalBase64(vault.publicKey, count: 32),
              let salt = canonicalBase64(vault.salt, count: 16),
              let iv = canonicalBase64(vault.iv, count: 12),
              let sealed = canonicalBase64(vault.ciphertext),
              sealed.count > 16
        else { throw PayrailSDKError.invalidVault }

        let associatedData = vaultAssociatedData(prefix: prefix, publicKey: publicKey)
        let key = try encryptionKey(password: password, salt: salt)
        let tagIndex = sealed.index(sealed.endIndex, offsetBy: -16)
        let box: AES.GCM.SealedBox
        do {
            box = try AES.GCM.SealedBox(
                nonce: AES.GCM.Nonce(data: iv),
                ciphertext: sealed[..<tagIndex],
                tag: sealed[tagIndex...]
            )
        } catch {
            throw PayrailSDKError.invalidVault
        }

        let privateKeyInfo: Data
        do {
            privateKeyInfo = try AES.GCM.open(box, using: key, authenticating: associatedData)
        } catch {
            throw PayrailSDKError.vaultAuthenticationFailed
        }
        guard privateKeyInfo.count == privateKeyInfoPrefix.count + 32,
              privateKeyInfo.starts(with: privateKeyInfoPrefix)
        else { throw PayrailSDKError.invalidVault }
        let seed = Data(privateKeyInfo.dropFirst(privateKeyInfoPrefix.count))
        let wallet = try PayrailWallet(prefix: prefix, privateKeySeed: seed)
        guard wallet.publicKey == publicKey, wallet.address == vault.address else {
            throw PayrailSDKError.invalidVault
        }
        return seed
    }

    static func create(
        prefix: String,
        privateKeySeed: Data,
        password: String,
        salt: Data,
        iv: Data
    ) throws -> EncryptedWalletVault {
        try validatePassword(password)
        guard salt.count == 16, iv.count == 12 else { throw PayrailSDKError.invalidVault }
        let wallet = try PayrailWallet(prefix: prefix, privateKeySeed: privateKeySeed)
        let key = try encryptionKey(password: password, salt: salt)
        let privateKeyInfo = privateKeyInfoPrefix + privateKeySeed
        let nonce: AES.GCM.Nonce
        do { nonce = try AES.GCM.Nonce(data: iv) }
        catch { throw PayrailSDKError.invalidVault }
        let sealed: AES.GCM.SealedBox
        do {
            sealed = try AES.GCM.seal(
                privateKeyInfo,
                using: key,
                nonce: nonce,
                authenticating: vaultAssociatedData(prefix: prefix, publicKey: wallet.publicKey)
            )
        } catch {
            throw PayrailSDKError.cryptographyFailure
        }
        return EncryptedWalletVault(
            version: 1,
            address: wallet.address,
            publicKey: wallet.publicKey.base64EncodedString(),
            salt: salt.base64EncodedString(),
            iv: iv.base64EncodedString(),
            ciphertext: (sealed.ciphertext + sealed.tag).base64EncodedString()
        )
    }

    private static func validate(_ vault: EncryptedWalletVault) throws {
        guard vault.version == 1,
              !vault.address.isEmpty, vault.address.count <= 256,
              canonicalBase64(vault.publicKey, count: 32) != nil,
              canonicalBase64(vault.salt, count: 16) != nil,
              canonicalBase64(vault.iv, count: 12) != nil,
              let ciphertext = canonicalBase64(vault.ciphertext),
              ciphertext.count > 16
        else { throw PayrailSDKError.invalidVault }
    }

    private static func validatePassword(_ password: String) throws {
        guard password.count >= 10, password.count <= 256 else {
            throw PayrailSDKError.invalidField("password must contain between 10 and 256 characters")
        }
    }

    private static func encryptionKey(password: String, salt: Data) throws -> SymmetricKey {
        let passwordBytes = Array(password.utf8)
        var derived = [UInt8](repeating: 0, count: 32)
        let status = passwordBytes.withUnsafeBytes { passwordBuffer in
            salt.withUnsafeBytes { saltBuffer in
                CCKeyDerivationPBKDF(
                    CCPBKDFAlgorithm(kCCPBKDF2),
                    passwordBuffer.bindMemory(to: Int8.self).baseAddress,
                    passwordBytes.count,
                    saltBuffer.bindMemory(to: UInt8.self).baseAddress,
                    salt.count,
                    CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                    passwordIterations,
                    &derived,
                    derived.count
                )
            }
        }
        guard status == kCCSuccess else { throw PayrailSDKError.cryptographyFailure }
        defer {
            _ = derived.withUnsafeMutableBytes {
                $0.initializeMemory(as: UInt8.self, repeating: 0)
            }
        }
        return SymmetricKey(data: derived)
    }

    private static func vaultAssociatedData(prefix: String, publicKey: Data) -> Data {
        Data("\(domain)\0\(prefix)\0\(publicKey.hex)".utf8)
    }

    private static func canonicalBase64(_ value: String, count: Int? = nil) -> Data? {
        guard value.count <= 1_024,
              let data = Data(base64Encoded: value),
              data.base64EncodedString() == value,
              count == nil || data.count == count
        else { return nil }
        return data
    }

    private static func secureRandomBytes(count: Int) throws -> Data {
        var bytes = [UInt8](repeating: 0, count: count)
        guard SecRandomCopyBytes(kSecRandomDefault, count, &bytes) == errSecSuccess else {
            throw PayrailSDKError.cryptographyFailure
        }
        return Data(bytes)
    }
}
