package one.payrail.sdk

import java.math.BigInteger
import java.nio.ByteBuffer
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer

public class AtomicUnits(public val value: String) : Comparable<AtomicUnits> {
    private val number: BigInteger

    init {
        if (!value.matches(Regex("^(0|[1-9][0-9]*)$"))) {
            throw PayrailException("atomic units must be canonical u128")
        }
        number = value.toBigInteger()
        if (number > MAX_U128) throw PayrailException("atomic units exceed u128")
    }

    internal fun encode(): ByteArray = number.toFixedUnsigned(16)

    override fun compareTo(other: AtomicUnits): Int = number.compareTo(other.number)
    override fun equals(other: Any?): Boolean = other is AtomicUnits && value == other.value
    override fun hashCode(): Int = value.hashCode()
    override fun toString(): String = value

    private companion object {
        val MAX_U128: BigInteger = BigInteger.ONE.shiftLeft(128).subtract(BigInteger.ONE)
    }
}

public data class TransferIntent(
    val networkId: ByteArray,
    val idempotencyKey: ByteArray,
    val assetId: ByteArray,
    val recipientAccountId: ByteArray,
    val amount: AtomicUnits,
    val fee: AtomicUnits,
    val nonce: ULong,
    val validUntilHeight: ULong,
) {
    init {
        requireSize(networkId, 32, "networkId")
        requireSize(idempotencyKey, 32, "idempotencyKey")
        requireSize(assetId, 32, "assetId")
        requireSize(recipientAccountId, 32, "recipientAccountId")
    }

    override fun equals(other: Any?): Boolean = other is TransferIntent &&
        networkId.contentEquals(other.networkId) &&
        idempotencyKey.contentEquals(other.idempotencyKey) &&
        assetId.contentEquals(other.assetId) &&
        recipientAccountId.contentEquals(other.recipientAccountId) &&
        amount == other.amount && fee == other.fee && nonce == other.nonce &&
        validUntilHeight == other.validUntilHeight

    override fun hashCode(): Int = networkId.contentHashCode()
}

public class PayrailWallet(prefix: String, privateKeySeed: ByteArray) {
    public val prefix: String
    public val publicKey: ByteArray
    public val accountId: String
    public val address: String
    private val privateKey: Ed25519PrivateKeyParameters

    init {
        if (!prefix.matches(Regex("^[a-z0-9]{1,20}$"))) {
            throw PayrailException("address prefix is invalid")
        }
        requireSize(privateKeySeed, 32, "private key seed")
        this.prefix = prefix
        privateKey = Ed25519PrivateKeyParameters(privateKeySeed.copyOf(), 0)
        publicKey = privateKey.generatePublicKey().encoded.copyOf()
        accountId = publicKey.toCanonicalHex()
        address = Bech32m.encode(prefix, byteArrayOf(0) + publicKey)
    }

    public fun sign(message: ByteArray): ByteArray {
        val signer = Ed25519Signer()
        signer.init(true, privateKey)
        signer.update(message, 0, message.size)
        return signer.generateSignature()
    }

    public fun signTransfer(intent: TransferIntent): ByteArray {
        val operation = byteArrayOf(0) + intent.networkId + intent.idempotencyKey +
            intent.assetId + publicKey + intent.recipientAccountId + intent.amount.encode() +
            intent.fee.encode() + intent.nonce.bigEndianBytes() + intent.validUntilHeight.bigEndianBytes()
        val authorization = AUTHORIZATION_DOMAIN + byteArrayOf(0) + operation
        return ENVELOPE_DOMAIN + operation + publicKey + sign(authorization) + byteArrayOf(0)
    }

    public fun approvalCodeRequest(
        networkId: ByteArray,
        deviceId: ByteArray,
        issuedAtMs: Long = System.currentTimeMillis(),
    ): ApprovalCodeIssueRequest = PayrailCode.issueRequest(
        accountAddress = address,
        networkId = networkId,
        publicKey = publicKey,
        deviceId = deviceId,
        issuedAtMs = issuedAtMs,
        signer = PayrailSigner(::sign),
    )

    public fun verify(message: ByteArray, signature: ByteArray): Boolean {
        if (signature.size != 64) return false
        val verifier = Ed25519Signer()
        verifier.init(false, Ed25519PublicKeyParameters(publicKey, 0))
        verifier.update(message, 0, message.size)
        return verifier.verifySignature(signature)
    }

    public companion object {
        private val AUTHORIZATION_DOMAIN = "ledger.authorization\u0000".encodeToByteArray()
        private val ENVELOPE_DOMAIN = "ledger.envelope\u0000".encodeToByteArray()

        public fun accountId(address: String, prefix: String): ByteArray {
            val decoded = Bech32m.decode(address)
            if (decoded.first != prefix || decoded.second.size != 33 || decoded.second[0] != 0.toByte()) {
                throw PayrailException("address is not a supported account")
            }
            return decoded.second.copyOfRange(1, 33)
        }
    }
}

public object CanonicalHex {
    public fun decode(value: String, expectedBytes: Int? = null): ByteArray {
        if (value.length % 2 != 0 || !value.matches(Regex("^[0-9a-f]*$")) ||
            expectedBytes != null && value.length != expectedBytes * 2) {
            throw PayrailException("value is not canonical lowercase hex")
        }
        return ByteArray(value.length / 2) { index ->
            value.substring(index * 2, index * 2 + 2).toInt(16).toByte()
        }
    }
}

private object Bech32m {
    private const val ALPHABET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
    private const val CHECKSUM_CONSTANT = 0x2bc830a3
    private val generators = intArrayOf(0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3)

    fun encode(prefix: String, payload: ByteArray): String {
        val words = convertBits(payload.map { it.toInt() and 0xff }, 8, 5, true)
        val values = hrpExpand(prefix) + words + List(6) { 0 }
        val checksum = polymod(values) xor CHECKSUM_CONSTANT
        val check = (0 until 6).map { (checksum ushr (5 * (5 - it))) and 31 }
        return prefix + "1" + (words + check).joinToString("") { ALPHABET[it].toString() }
    }

    fun decode(value: String): Pair<String, ByteArray> {
        if (value != value.lowercase()) throw PayrailException("address is malformed")
        val separator = value.lastIndexOf('1')
        if (separator < 1 || value.length - separator - 1 < 6) throw PayrailException("address is malformed")
        val prefix = value.substring(0, separator)
        val words = value.substring(separator + 1).map {
            ALPHABET.indexOf(it).takeIf { index -> index >= 0 }
                ?: throw PayrailException("address is malformed")
        }
        if (polymod(hrpExpand(prefix) + words) != CHECKSUM_CONSTANT) {
            throw PayrailException("address checksum is invalid")
        }
        return prefix to convertBits(words.dropLast(6), 5, 8, false).map(Int::toByte).toByteArray()
    }

    private fun hrpExpand(prefix: String): List<Int> =
        prefix.map { it.code ushr 5 } + 0 + prefix.map { it.code and 31 }

    private fun polymod(values: List<Int>): Int {
        var current = 1
        for (value in values) {
            val top = current ushr 25
            current = ((current and 0x1ffffff) shl 5) xor value
            for (index in 0 until 5) if (((top ushr index) and 1) != 0) {
                current = current xor generators[index]
            }
        }
        return current
    }

    private fun convertBits(input: List<Int>, from: Int, to: Int, pad: Boolean): List<Int> {
        var accumulator = 0
        var bits = 0
        val maximum = (1 shl to) - 1
        val output = mutableListOf<Int>()
        for (value in input) {
            if (value ushr from != 0) throw PayrailException("address is malformed")
            accumulator = (accumulator shl from) or value
            bits += from
            while (bits >= to) {
                bits -= to
                output += (accumulator ushr bits) and maximum
            }
        }
        if (pad && bits > 0) output += (accumulator shl (to - bits)) and maximum
        if (!pad && (bits >= from || (accumulator shl (to - bits)) and maximum != 0)) {
            throw PayrailException("address padding is invalid")
        }
        return output
    }
}

private fun requireSize(value: ByteArray, size: Int, name: String) {
    if (value.size != size) throw PayrailException("$name must contain $size bytes")
}

private fun ULong.bigEndianBytes(): ByteArray = ByteBuffer.allocate(8).putLong(toLong()).array()

private fun BigInteger.toFixedUnsigned(size: Int): ByteArray {
    val source = toByteArray()
    val unsigned = if (source.size > 1 && source[0] == 0.toByte()) source.copyOfRange(1, source.size) else source
    if (unsigned.size > size) throw PayrailException("unsigned integer overflow")
    return ByteArray(size - unsigned.size) + unsigned
}
