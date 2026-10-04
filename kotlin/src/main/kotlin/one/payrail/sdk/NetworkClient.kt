package one.payrail.sdk

import java.io.BufferedReader
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable
public data class NetworkStatus(
    val networkId: String,
    val addressPrefix: String,
    val finalizedHeight: String,
    val finalityMode: String,
    val validatorCount: Int,
    val onlineValidators: Int,
    val quorumWeight: Int,
    val asset: NetworkAsset,
)

@Serializable
public data class AccountState(
    val address: String,
    val accountId: String,
    val nonce: String,
    val balance: String,
    val finalizedHeight: String,
)

@Serializable
public data class FinalizedTransaction(
    val id: String,
    val blockHeight: String,
    val operationIndex: String,
    val from: String,
    val to: String,
    val amount: String,
    val fee: String,
    val outcome: String,
    val kind: String,
)

@Serializable
public data class FinalizedBlock(
    val height: String,
    val hash: String,
    val stateRoot: String,
    val transactionCount: Int,
)

@Serializable
public data class SubmissionResult(
    val transaction: FinalizedTransaction,
    val checkpoint: FinalizedBlock,
)

@Serializable
public data class ExplorerOverview(
    val status: NetworkStatus,
    val blocks: List<FinalizedBlock>,
    val transactions: List<FinalizedTransaction>,
)

@Serializable
private data class AddressRequest(val address: String)

@Serializable
private data class EnvelopeRequest(val envelope: String)

public class PayrailClient(
    apiBaseUrl: String,
    private val connectTimeoutMs: Int = 10_000,
    private val readTimeoutMs: Int = 30_000,
) {
    private val baseUrl: String
    private val json = Json { ignoreUnknownKeys = true }

    init {
        val parsed = parseBaseUrl(apiBaseUrl)
        baseUrl = parsed.toString().trimEnd('/')
    }

    public fun status(): NetworkStatus = decode<NetworkStatus>(call("GET", "/status", null)).also {
        if (!it.networkId.isCanonicalHex(32) || !it.asset.id.isCanonicalHex(32) ||
            !it.finalizedHeight.isCanonicalUnsigned() || it.asset.decimals !in 0..18 ||
            it.validatorCount < it.onlineValidators || it.onlineValidators < it.quorumWeight ||
            it.quorumWeight <= 0) throw PayrailException("Payrail returned invalid network status")
    }

    public fun account(address: String): AccountState =
        decode<AccountState>(call("GET", "/accounts/${pathComponent(address)}", null)).also {
            if (it.address != address || !it.accountId.isCanonicalHex(32) ||
                !it.nonce.isCanonicalUnsigned() || !it.balance.isCanonicalUnsigned() ||
                !it.finalizedHeight.isCanonicalUnsigned()) {
                throw PayrailException("Payrail returned invalid account state")
            }
        }

    public fun faucet(address: String): SubmissionResult =
        decode(call("POST", "/faucet", json.encodeToString(AddressRequest(address))))

    public fun submit(envelope: ByteArray): SubmissionResult {
        if (envelope.isEmpty()) throw PayrailException("envelope cannot be empty")
        return decode(call("POST", "/transactions", json.encodeToString(EnvelopeRequest(envelope.toCanonicalHex()))))
    }

    public fun checkout(id: String): Checkout =
        decode<Checkout>(call("GET", "/checkouts/${pathComponent(id)}", null)).also {
            if (it.id != id) throw PayrailException("Payrail returned a different checkout")
        }

    public fun overview(): ExplorerOverview = decode(call("GET", "/explorer", null))

    public fun submitCheckout(id: String, envelope: ByteArray): Checkout {
        if (envelope.isEmpty()) throw PayrailException("envelope cannot be empty")
        return decode<Checkout>(
            call(
                "POST",
                "/checkouts/${pathComponent(id)}/transactions",
                json.encodeToString(EnvelopeRequest(envelope.toCanonicalHex())),
            ),
        ).also { if (it.id != id) throw PayrailException("Payrail returned a different checkout") }
    }

    private inline fun <reified T> decode(value: String): T = try {
        json.decodeFromString<T>(value)
    } catch (error: Exception) {
        throw PayrailException("Payrail returned malformed JSON", error)
    }

    private fun call(method: String, path: String, body: String?): String {
        val connection = URI(baseUrl + path).toURL().openConnection() as HttpURLConnection
        try {
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
            val response = stream?.bufferedReader(Charsets.UTF_8)?.use(BufferedReader::readTextLimited).orEmpty()
            if (status !in 200..299) throw PayrailException("Payrail API returned HTTP $status")
            return response
        } finally {
            connection.disconnect()
        }
    }
}

private fun parseBaseUrl(value: String): URI {
    val parsed = try { URI(value) } catch (error: Exception) {
        throw PayrailException("apiBaseUrl is invalid", error)
    }
    if (parsed.scheme != "https" && parsed.host != "localhost" || parsed.userInfo != null ||
        parsed.rawQuery != null || parsed.rawFragment != null) {
        throw PayrailException("apiBaseUrl must use HTTPS")
    }
    return parsed
}

private fun pathComponent(value: String): String {
    if (value.isEmpty() || value.length > 256 || !value.matches(Regex("^[A-Za-z0-9]+$"))) {
        throw PayrailException("path identifier is invalid")
    }
    return value
}

private fun String.isCanonicalUnsigned(): Boolean = matches(Regex("^(0|[1-9][0-9]*)$"))
private fun String.isCanonicalHex(bytes: Int): Boolean =
    length == bytes * 2 && matches(Regex("^[0-9a-f]+$"))

private fun BufferedReader.readTextLimited(): String {
    val output = StringBuilder()
    val buffer = CharArray(8_192)
    while (true) {
        val count = read(buffer)
        if (count < 0) return output.toString()
        output.append(buffer, 0, count)
        if (output.length > 1_048_576) throw PayrailException("Payrail response exceeds size limit")
    }
}
