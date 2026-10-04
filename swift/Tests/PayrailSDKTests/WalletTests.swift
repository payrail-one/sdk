import Foundation
import CryptoKit
import XCTest
@testable import PayrailSDK

final class WalletTests: XCTestCase {
    private let seed = Data((0..<32).map(UInt8.init))

    func testAddressMatchesBrowserWalletCore() throws {
        let wallet = try PayrailWallet(prefix: "paydev", privateKeySeed: seed)
        XCTAssertEqual(wallet.accountID, "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8")
        XCTAssertEqual(
            wallet.address,
            "paydev1qqp6zpal708pp0sawrw33e6tczvk0exkxzd62r2lrhwgveqj25cms7uc5hh"
        )
        XCTAssertEqual(try PayrailWallet.accountID(from: wallet.address, prefix: "paydev"), wallet.publicKey)
    }

    func testTransferEnvelopeMatchesBrowserWalletCore() throws {
        let wallet = try PayrailWallet(prefix: "paydev", privateKeySeed: seed)
        let intent = try TransferIntent(
            networkID: Data(repeating: 0x11, count: 32),
            idempotencyKey: Data(repeating: 0x22, count: 32),
            assetID: Data(repeating: 0x33, count: 32),
            recipientAccountID: Data(repeating: 0x44, count: 32),
            amount: AtomicUnits("1000000"),
            fee: AtomicUnits("0"),
            nonce: 7,
            validUntilHeight: 99
        )
        let envelope = try wallet.signTransfer(intent)
        let envelopeDomain = Data("ledger.envelope\0".utf8)
        let operation = envelope[envelopeDomain.count..<(envelopeDomain.count + 209)]
        XCTAssertEqual(operation.count, 209)
        let signerStart = envelopeDomain.count + operation.count
        let signer = envelope[signerStart..<(signerStart + 32)]
        let signature = envelope[(signerStart + 32)..<(signerStart + 96)]
        XCTAssertEqual(Data(signer), wallet.publicKey)
        XCTAssertEqual(envelope.last, 0)
        let authorization = Data("ledger.authorization\0".utf8) + Data([0]) + operation
        XCTAssertEqual(
            Data(SHA256.hash(data: authorization)).hex,
            "f82a43b0bcb98f83962971d0a393b3f6703fb585ac5dad6bd9fb4f4d21e8163f"
        )
        let verificationKey = try Curve25519.Signing.PublicKey(rawRepresentation: wallet.publicKey)
        XCTAssertTrue(verificationKey.isValidSignature(signature, for: authorization))
    }

    func testAtomicUnitsRejectNonCanonicalAndOverflowValues() throws {
        XCTAssertThrowsError(try AtomicUnits("01"))
        XCTAssertThrowsError(try AtomicUnits("-1"))
        XCTAssertNoThrow(try AtomicUnits("340282366920938463463374607431768211455"))
        XCTAssertThrowsError(try AtomicUnits("340282366920938463463374607431768211456"))
    }

    func testCanonicalHexRejectsMixedCaseAndWrongLength() throws {
        XCTAssertEqual(
            try CanonicalHex.decode(String(repeating: "ab", count: 32), expectedBytes: 32).count,
            32
        )
        XCTAssertThrowsError(try CanonicalHex.decode("AB"))
        XCTAssertThrowsError(try CanonicalHex.decode("abc"))
        XCTAssertThrowsError(try CanonicalHex.decode("00", expectedBytes: 32))
    }
}
