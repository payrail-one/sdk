package one.payrail.sdk

import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI
import java.nio.ByteBuffer
import java.security.SecureRandom
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

public class PayrailException(message: String, cause: Throwable? = null) : Exception(message, cause)

public fun interface PayrailSigner {
    public fun sign(message: ByteArray): ByteArray
}

@Serializable
public data class ApprovalCodeIssueRequest(
    val accountAddress: String,
    val deviceId: String,
    val issuedAtMs: String,
    val nonce: String,
    val signature: String,
)

@Serializable
public data class IssuedApprovalCode(
    val code: String,
    val sessionToken: String,
    val expiresAtMs: String,
)

@Serializable
public data class NetworkAsset(val id: String, val symbol: String, val decimals: Int)

@Serializable
public data class Checkout(
    val id: String,
    val merchantLabel: String,
    val merchantAddress: String,
    val amount: String,
    val fee: String,
    val asset: NetworkAsset,
    val status: String,
    val expiresAtMs: String,
    val validUntilHeight: String,
    val paymentPath: String,
    val smsText: String,
    val transaction: FinalizedTransaction? = null,
)

@Serializable
public data class ApprovalCodeChallenge(val status: String, val checkout: Checkout? = null)

public object PayrailCode {
    private val domain = "payrail.approval.issue.v1\u0000".encodeToByteArray()
    private val secureRandom = SecureRandom()

    public fun issueMessage(
        networkId: ByteArray,
        publicKey: ByteArray,
        deviceId: ByteArray,
        issuedAtMs: Long,
        nonce: ByteArray,
    ): ByteArray {
        requireSize(networkId, 32, "networkId")
        requireSize(publicKey, 32, "publicKey")
        requireSize(deviceId, 32, "deviceId")
        requireSize(nonce, 32, "nonce")
        if (issuedAtMs < 0) throw PayrailException("issuedAtMs cannot be negative")
        return domain + networkId + publicKey + deviceId +
            ByteBuffer.allocate(Long.SIZE_BYTES).putLong(issuedAtMs).array() + nonce
    }

    public fun issueRequest(
        accountAddress: String,
        networkId: ByteArray,
        publicKey: ByteArray,
        deviceId: ByteArray,
        signer: PayrailSigner,
        issuedAtMs: Long = System.currentTimeMillis(),
        nonce: ByteArray = randomBytes(32),
    ): ApprovalCodeIssueRequest {
        val signature = signer.sign(issueMessage(networkId, publicKey, deviceId, issuedAtMs, nonce))
        requireSize(signature, 64, "signature")
        return ApprovalCodeIssueRequest(
            accountAddress = accountAddress,
            deviceId = deviceId.toHex(),
            issuedAtMs = issuedAtMs.toString(),
            nonce = nonce.toHex(),
            signature = signature.toHex(),
        )
    }

    public fun createDeviceId(): ByteArray = randomBytes(32)

    private fun randomBytes(size: Int): ByteArray = ByteArray(size).also(secureRandom::nextBytes)

    private fun requireSize(value: ByteArray, size: Int, name: String) {
        if (value.size != size) throw PayrailException("$name must contain $size bytes")
    }
}

public class PayrailCodeClient(
    apiBaseUrl: String,
    private val connectTimeoutMs: Int = 10_000,
    private val readTimeoutMs: Int = 10_000,
) {
    private val baseUrl: String
    private val json = Json { ignoreUnknownKeys = true }

    init {
        val parsed = try { URI(apiBaseUrl) } catch (error: Exception) {
            throw PayrailException("apiBaseUrl is invalid", error)
        }
        if (parsed.scheme != "https" && parsed.host != "localhost" ||
            parsed.userInfo != null || parsed.rawQuery != null || parsed.rawFragment != null) {
            throw PayrailException("apiBaseUrl must use HTTPS")
        }
        baseUrl = apiBaseUrl.trimEnd('/')
    }

    /** Execute this blocking operation away from the Android main thread. */
    public fun issue(request: ApprovalCodeIssueRequest): IssuedApprovalCode {
        val result = call("POST", "/approval-codes", json.encodeToString(request))
        val issued = decode<IssuedApprovalCode>(result)
        if (!issued.code.matches(Regex("^[0-9]{6}$")) ||
            !issued.expiresAtMs.matches(Regex("^[1-9][0-9]*$"))) {
            throw PayrailException("Payrail returned a malformed approval code")
        }
        return issued
    }

    /** Execute this blocking operation away from the Android main thread. */
    public fun challenge(sessionToken: String): ApprovalCodeChallenge {
        if (!sessionToken.matches(Regex("^[0-9a-f]{144}$"))) {
            throw PayrailException("session token is malformed")
        }
        val challenge = decode<ApprovalCodeChallenge>(
            call("GET", "/approval-codes/sessions/$sessionToken", null),
        )
        val valid = challenge.status == "waiting" && challenge.checkout == null ||
            challenge.status in setOf("claimed", "finalized") && challenge.checkout != null
        if (!valid) throw PayrailException("Payrail returned an inconsistent challenge")
        return challenge
    }

    private inline fun <reified T> decode(value: String): T = try {
        json.decodeFromString<T>(value)
    } catch (error: Exception) {
        throw PayrailException("Payrail returned malformed JSON", error)
    }

    private fun call(method: String, path: String, body: String?): String {
        val connection = URI(baseUrl + path).toURL().openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = connectTimeoutMs
        connection.readTimeout = readTimeoutMs
        connection.setRequestProperty("Accept", "application/json")
        if (body != null) {
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(body.encodeToByteArray()) }
        }
        val status = connection.responseCode
        val stream: InputStream? = if (status in 200..299) connection.inputStream else connection.errorStream
        val response = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readTextLimited() }.orEmpty()
        connection.disconnect()
        if (status !in 200..299) throw PayrailException("Payrail API returned HTTP $status")
        return response
    }
}

private fun java.io.BufferedReader.readTextLimited(): String {
    val output = StringBuilder()
    val buffer = CharArray(8_192)
    while (true) {
        val count = read(buffer)
        if (count < 0) return output.toString()
        output.append(buffer, 0, count)
        if (output.length > 1_048_576) throw PayrailException("Payrail response exceeds size limit")
    }
}

public fun ByteArray.toCanonicalHex(): String =
    joinToString("") { "%02x".format(it.toInt() and 0xff) }

private fun ByteArray.toHex(): String = toCanonicalHex()
