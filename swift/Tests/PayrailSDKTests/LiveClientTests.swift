import Foundation
import XCTest
@testable import PayrailSDK

final class LiveClientTests: XCTestCase {
    func testDecodesConnectedAndResyncEvents() throws {
        XCTAssertEqual(
            try PayrailLiveClient.decodeEvent(
                Data(#"{"type":"connected","protocol":"payrail.live.v1","address":"paydev1x","finalizedHeight":"42"}"#.utf8)
            ),
            .connected(finalizedHeight: "42")
        )
        XCTAssertEqual(
            try PayrailLiveClient.decodeEvent(Data(#"{"type":"resyncRequired"}"#.utf8)),
            .resyncRequired
        )
        XCTAssertNil(try PayrailLiveClient.decodeEvent(Data(#"{"type":"pong"}"#.utf8)))
    }

    func testRejectsUnknownOrMalformedEvents() {
        XCTAssertThrowsError(
            try PayrailLiveClient.decodeEvent(Data(#"{"type":"connected","protocol":"wrong"}"#.utf8))
        )
        XCTAssertThrowsError(
            try PayrailLiveClient.decodeEvent(Data(#"{"type":"unknown"}"#.utf8))
        )
    }
}
