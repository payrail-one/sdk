import XCTest
@testable import PayrailSDK

final class PayrailCodeTests: XCTestCase {
    func testInteroperabilityVector() throws {
        let message = try PayrailCode.issueMessage(
            networkID: Data(repeating: 0x11, count: 32),
            publicKey: Data(repeating: 0x22, count: 32),
            deviceID: Data(repeating: 0x33, count: 32),
            issuedAtMilliseconds: 1_791_043_200_000,
            nonce: Data(repeating: 0x44, count: 32)
        )
        XCTAssertEqual(message.count, 162)
        XCTAssertEqual(
            message.map { String(format: "%02x", $0) }.joined(),
            "7061797261696c2e617070726f76616c2e69737375652e763100" +
                String(repeating: "11", count: 32) + String(repeating: "22", count: 32) +
                String(repeating: "33", count: 32) + "000001a1027e6400" +
                String(repeating: "44", count: 32)
        )
    }

    func testRequestKeepsLeadingZeroCodeDataCanonical() async throws {
        let request = try await PayrailCode.issueRequest(
            accountAddress: "paydev1example",
            networkID: Data(repeating: 0x11, count: 32),
            publicKey: Data(repeating: 0x22, count: 32),
            deviceID: Data(repeating: 0x33, count: 32),
            issuedAtMilliseconds: 1_791_043_200_000,
            nonce: Data(repeating: 0x44, count: 32),
            signer: { message in
                XCTAssertEqual(message.count, 162)
                return Data(repeating: 0x55, count: 64)
            }
        )
        XCTAssertEqual(request.issuedAtMs, "1791043200000")
        XCTAssertEqual(request.deviceId, String(repeating: "33", count: 32))
        XCTAssertEqual(request.signature, String(repeating: "55", count: 64))
    }
}
