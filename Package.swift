// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "PayrailSDK",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [.library(name: "PayrailSDK", targets: ["PayrailSDK"])],
    targets: [
        .target(name: "PayrailSDK", path: "swift/Sources/PayrailSDK"),
        .testTarget(
            name: "PayrailSDKTests",
            dependencies: ["PayrailSDK"],
            path: "swift/Tests/PayrailSDKTests"
        ),
    ]
)
