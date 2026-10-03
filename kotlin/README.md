# Payrail Android/JVM SDK

`PayrailSDK` creates signed, device-bound Payrail Code requests and polls the
wallet challenge without taking ownership of private keys. Pass a signer backed
by your wallet's existing key boundary and run network methods away from the
Android main thread.

Until Maven Central signing is provisioned, download the JAR, sources, POM and
checksums from the `v0.3.0` GitHub release. Keep the supplied POM beside the JAR
so Gradle or Maven can resolve the exact Kotlin serialization dependencies.

```kotlin
val request = PayrailCode.issueRequest(
    accountAddress = wallet.address,
    networkId = networkId,
    publicKey = wallet.publicKey,
    deviceId = persistedDeviceId,
    signer = PayrailSigner { message -> wallet.sign(message) },
)

val issued = PayrailCodeClient("https://devnet.payrail.one/api").issue(request)
```
