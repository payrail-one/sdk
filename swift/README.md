# Payrail Swift SDK

Add `https://github.com/payrail-one/sdk` in Swift Package Manager and select the
`PayrailSDK` product. The package supports iOS 15 and macOS 12 or newer and has
no third-party runtime dependencies.

```swift
let request = try await PayrailCode.issueRequest(
    accountAddress: wallet.address,
    networkID: networkID,
    publicKey: wallet.publicKey,
    deviceID: persistedDeviceID,
    signer: { message in try await wallet.sign(message) }
)

let client = try PayrailCodeClient(
    apiBaseURL: URL(string: "https://devnet.payrail.one/api")!
)
let issued = try await client.issue(request)
```
