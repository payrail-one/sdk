package one.payrail.sdk

import java.security.SecureRandom
import java.util.Base64
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable
public data class EncryptedWalletVault(
    val version: Int,
    val address: String,
    val publicKey: String,
    val salt: String,
    val iv: String,
    val ciphertext: String,
)

public object WalletVault {
    public const val PASSWORD_ITERATIONS: Int = 600_000
    public const val MAXIMUM_JSON_BYTES: Int = 32_768

    private const val DOMAIN = "payrail.wallet.v1"
    private val privateKeyInfoPrefix = byteArrayOf(
        0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
        0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
    )
    private val random = SecureRandom()
    private val json = Json { ignoreUnknownKeys = false }

    public fun create(prefix: String, privateKeySeed: ByteArray, password: String): EncryptedWalletVault =
        create(prefix, privateKeySeed, password, randomBytes(16), randomBytes(12))

    public fun encode(vault: EncryptedWalletVault): ByteArray {
        validate(vault)
        return json.encodeToString(vault).encodeToByteArray().also {
            if (it.size > MAXIMUM_JSON_BYTES) throw PayrailException("wallet vault is too large")
        }
    }

    public fun decode(data: ByteArray): EncryptedWalletVault {
        if (data.isEmpty() || data.size > MAXIMUM_JSON_BYTES) throw PayrailException("invalid wallet vault")
        val vault = try { json.decodeFromString<EncryptedWalletVault>(data.decodeToString()) }
        catch (error: Exception) { throw PayrailException("invalid wallet vault", error) }
        validate(vault)
        return vault
    }

    public fun restoreSeed(prefix: String, password: String, vault: EncryptedWalletVault): ByteArray {
        validatePassword(password)
        validate(vault)
        val publicKey = canonicalBase64(vault.publicKey, 32)
        val salt = canonicalBase64(vault.salt, 16)
        val iv = canonicalBase64(vault.iv, 12)
        val sealed = canonicalBase64(vault.ciphertext)
        if (sealed.size <= 16) throw PayrailException("invalid wallet vault")
        val clear = try {
            crypt(Cipher.DECRYPT_MODE, password, salt, iv, associatedData(prefix, publicKey), sealed)
        } catch (error: AEADBadTagException) {
            throw PayrailException("wallet vault authentication failed", error)
        } catch (error: Exception) {
            throw PayrailException("wallet vault authentication failed", error)
        }
        if (clear.size != privateKeyInfoPrefix.size + 32 ||
            !clear.copyOfRange(0, privateKeyInfoPrefix.size).contentEquals(privateKeyInfoPrefix)) {
            throw PayrailException("invalid wallet vault")
        }
        val seed = clear.copyOfRange(privateKeyInfoPrefix.size, clear.size)
        val wallet = PayrailWallet(prefix, seed)
        if (!wallet.publicKey.contentEquals(publicKey) || wallet.address != vault.address) {
            throw PayrailException("invalid wallet vault")
        }
        return seed
    }

    internal fun create(
        prefix: String,
        privateKeySeed: ByteArray,
        password: String,
        salt: ByteArray,
        iv: ByteArray,
    ): EncryptedWalletVault {
        validatePassword(password)
        if (salt.size != 16 || iv.size != 12) throw PayrailException("invalid wallet vault")
        val wallet = PayrailWallet(prefix, privateKeySeed)
        val sealed = crypt(
            Cipher.ENCRYPT_MODE,
            password,
            salt,
            iv,
            associatedData(prefix, wallet.publicKey),
            privateKeyInfoPrefix + privateKeySeed,
        )
        return EncryptedWalletVault(
            version = 1,
            address = wallet.address,
            publicKey = wallet.publicKey.canonicalBase64(),
            salt = salt.canonicalBase64(),
            iv = iv.canonicalBase64(),
            ciphertext = sealed.canonicalBase64(),
        )
    }

    private fun crypt(
        mode: Int,
        password: String,
        salt: ByteArray,
        iv: ByteArray,
        associatedData: ByteArray,
        input: ByteArray,
    ): ByteArray {
        val passwordChars = password.toCharArray()
        val spec = PBEKeySpec(passwordChars, salt, PASSWORD_ITERATIONS, 256)
        try {
            val key = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
            try {
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(mode, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
                cipher.updateAAD(associatedData)
                return cipher.doFinal(input)
            } finally {
                key.fill(0)
            }
        } finally {
            spec.clearPassword()
            passwordChars.fill('\u0000')
        }
    }

    private fun associatedData(prefix: String, publicKey: ByteArray): ByteArray =
        "$DOMAIN\u0000$prefix\u0000${publicKey.toCanonicalHex()}".encodeToByteArray()

    private fun validate(vault: EncryptedWalletVault) {
        if (vault.version != 1 || vault.address.isEmpty() || vault.address.length > 256) {
            throw PayrailException("invalid wallet vault")
        }
        canonicalBase64(vault.publicKey, 32)
        canonicalBase64(vault.salt, 16)
        canonicalBase64(vault.iv, 12)
        if (canonicalBase64(vault.ciphertext).size <= 16) throw PayrailException("invalid wallet vault")
    }

    private fun validatePassword(password: String) {
        if (password.length !in 10..256) {
            throw PayrailException("password must contain between 10 and 256 characters")
        }
    }

    private fun canonicalBase64(value: String, size: Int? = null): ByteArray {
        if (value.length > 1_024) throw PayrailException("invalid wallet vault")
        val decoded = try { Base64.getDecoder().decode(value) }
        catch (error: IllegalArgumentException) { throw PayrailException("invalid wallet vault", error) }
        if (Base64.getEncoder().encodeToString(decoded) != value || size != null && decoded.size != size) {
            throw PayrailException("invalid wallet vault")
        }
        return decoded
    }

    private fun ByteArray.canonicalBase64(): String = Base64.getEncoder().encodeToString(this)
    private fun randomBytes(size: Int): ByteArray = ByteArray(size).also(random::nextBytes)
}
