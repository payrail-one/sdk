# Payrail Android/JVM SDK

`PayrailSDK` implements Payrail Ed25519 wallets, Bech32m addresses, canonical
transfer envelopes, authoritative API access, cross-platform encrypted wallet
backups and signed Payrail Code requests. Network and PBKDF2 methods are
blocking; call them from an IO dispatcher on Android.

Until Maven Central signing is provisioned, download the JAR, sources, POM and
checksums from the `v0.6.0` GitHub release. Keep the supplied POM beside the JAR
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

The Android wallet reference app keeps its active seed encrypted by a
device-only Android Keystore key and requires biometric or device-credential
authentication before signing. `WalletVault` is for password-protected export;
do not use a vault file as the active key store.
