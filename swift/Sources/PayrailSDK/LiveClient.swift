import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum PayrailLiveEvent: Equatable, Sendable {
    case connected(finalizedHeight: String)
    case finalized(transaction: FinalizedTransaction, checkpoint: FinalizedBlock)
    case checkoutUpdated(Checkout)
    case resyncRequired
}

public struct PayrailLiveClient: Sendable {
    public static let protocolName = "payrail.live.v1"

    private let baseURL: URL
    private let session: URLSession

    public init(apiBaseURL: URL, session: URLSession = .shared) throws {
        _ = try PayrailAPITransport(baseURL: apiBaseURL, session: session)
        baseURL = apiBaseURL
        self.session = session
    }

    public func events(
        address: String
    ) throws -> AsyncThrowingStream<PayrailLiveEvent, Error> {
        guard !address.isEmpty, address.count <= 256 else {
            throw PayrailSDKError.invalidField("account address is malformed")
        }
        let url = try liveURL(address: address)
        let socket = session.webSocketTask(with: url, protocols: [Self.protocolName])
        return AsyncThrowingStream { continuation in
            let receiver = Task {
                socket.resume()
                do {
                    while !Task.isCancelled {
                        let message = try await socket.receive()
                        guard case let .string(text) = message,
                              let event = try Self.decodeEvent(Data(text.utf8))
                        else { continue }
                        continuation.yield(event)
                    }
                    continuation.finish()
                } catch {
                    if Task.isCancelled { continuation.finish() }
                    else { continuation.finish(throwing: error) }
                }
            }
            continuation.onTermination = { @Sendable _ in
                receiver.cancel()
                socket.cancel(with: .goingAway, reason: nil)
            }
        }
    }

    static func decodeEvent(_ data: Data) throws -> PayrailLiveEvent? {
        let envelope: LiveEnvelope
        do { envelope = try JSONDecoder().decode(LiveEnvelope.self, from: data) }
        catch { throw PayrailSDKError.invalidResponse }
        switch envelope.type {
        case "connected":
            guard envelope.protocol == protocolName,
                  let height = envelope.finalizedHeight,
                  height.isCanonicalUnsigned
            else { throw PayrailSDKError.invalidResponse }
            return .connected(finalizedHeight: height)
        case "finalized":
            guard let transaction = envelope.transaction,
                  let checkpoint = envelope.checkpoint
            else { throw PayrailSDKError.invalidResponse }
            return .finalized(transaction: transaction, checkpoint: checkpoint)
        case "checkoutUpdated":
            guard let checkout = envelope.checkout else { throw PayrailSDKError.invalidResponse }
            return .checkoutUpdated(checkout)
        case "resyncRequired":
            return .resyncRequired
        case "pong":
            return nil
        default:
            throw PayrailSDKError.invalidResponse
        }
    }

    private func liveURL(address: String) throws -> URL {
        var components = URLComponents(
            url: baseURL.appendingPathComponent("live"),
            resolvingAgainstBaseURL: false
        )
        components?.scheme = baseURL.scheme == "https" ? "wss" : "ws"
        components?.queryItems = [URLQueryItem(name: "address", value: address)]
        guard let url = components?.url else { throw PayrailSDKError.invalidField("live URL is invalid") }
        return url
    }
}

private struct LiveEnvelope: Decodable {
    let type: String
    let `protocol`: String?
    let finalizedHeight: String?
    let transaction: FinalizedTransaction?
    let checkpoint: FinalizedBlock?
    let checkout: Checkout?
}

private extension String {
    var isCanonicalUnsigned: Bool {
        range(of: #"^(0|[1-9][0-9]*)$"#, options: .regularExpression) != nil
    }
}
