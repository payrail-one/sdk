import Foundation
import XCTest
@testable import PayrailSDK

final class WalletVaultTests: XCTestCase {
    private let seed = Data((0..<32).map(UInt8.init))
    private let password = "correct horse battery staple"

    func testVaultMatchesBrowserWalletFormat() throws {
        let vault = try WalletVault.create(
            prefix: "paydev",
            privateKeySeed: seed,
            password: password,
            salt: Data((0..<16).map(UInt8.init)),
            iv: Data((16..<28).map(UInt8.init))
        )
        XCTAssertEqual(vault.version, 1)
        XCTAssertEqual(
            vault.address,
            "paydev1qqp6zpal708pp0sawrw33e6tczvk0exkxzd62r2lrhwgveqj25cms7uc5hh"
        )
        XCTAssertEqual(vault.publicKey, "A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=")
        XCTAssertEqual(vault.salt, "AAECAwQFBgcICQoLDA0ODw==")
        XCTAssertEqual(vault.iv, "EBESExQVFhcYGRob")
        XCTAssertEqual(
            vault.ciphertext,
            "PDx/xBDPrXHIkfy4yNFw2hE5mOeCYtCsyzkR4cS0TuCO0p364PTgO9QOuU265xJbSIxpi2n+sCUqyD5pgabEUw=="
        )
        XCTAssertEqual(
            try WalletVault.restoreSeed(prefix: "paydev", password: password, vault: vault),
            seed
        )
    }

    func testVaultJSONRoundTrip() throws {
        let vault = try WalletVault.create(prefix: "paydev", privateKeySeed: seed, password: password)
        XCTAssertEqual(try WalletVault.decode(WalletVault.encode(vault)), vault)
    }

    func testWrongPasswordAndCorruptionFailClosed() throws {
        let vault = try WalletVault.create(prefix: "paydev", privateKeySeed: seed, password: password)
        XCTAssertThrowsError(
            try WalletVault.restoreSeed(prefix: "paydev", password: "wrong password value", vault: vault)
        ) { XCTAssertEqual($0 as? PayrailSDKError, .vaultAuthenticationFailed) }

        let corrupted = EncryptedWalletVault(
            version: vault.version,
            address: vault.address,
            publicKey: vault.publicKey,
            salt: vault.salt,
            iv: vault.iv,
            ciphertext: String(vault.ciphertext.dropLast()) + "A"
        )
        XCTAssertThrowsError(
            try WalletVault.restoreSeed(prefix: "paydev", password: password, vault: corrupted)
        )
    }

    func testRejectsOversizedAndUnsupportedVaults() throws {
        XCTAssertThrowsError(try WalletVault.decode(Data(repeating: 0x20, count: 32_769)))
        let unsupported = Data(#"{"version":2}"#.utf8)
        XCTAssertThrowsError(try WalletVault.decode(unsupported))
    }
}
