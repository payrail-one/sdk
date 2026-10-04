package one.payrail.sdk

import java.security.MessageDigest
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class WalletTest {
    private val seed = ByteArray(32) { it.toByte() }

    @Test
    fun `address matches browser and Swift wallet`() {
        val wallet = PayrailWallet("paydev", seed)
        assertEquals("03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8", wallet.accountId)
        assertEquals("paydev1qqp6zpal708pp0sawrw33e6tczvk0exkxzd62r2lrhwgveqj25cms7uc5hh", wallet.address)
        assertArrayEquals(wallet.publicKey, PayrailWallet.accountId(wallet.address, "paydev"))
    }

    @Test
    fun `transfer envelope matches canonical authorization`() {
        val wallet = PayrailWallet("paydev", seed)
        val envelope = wallet.signTransfer(
            TransferIntent(
                networkId = ByteArray(32) { 0x11 },
                idempotencyKey = ByteArray(32) { 0x22 },
                assetId = ByteArray(32) { 0x33 },
                recipientAccountId = ByteArray(32) { 0x44 },
                amount = AtomicUnits("1000000"),
                fee = AtomicUnits("0"),
                nonce = 7u,
                validUntilHeight = 99u,
            ),
        )
        val domainSize = "ledger.envelope\u0000".encodeToByteArray().size
        val operation = envelope.copyOfRange(domainSize, domainSize + 209)
        val signerStart = domainSize + operation.size
        val signature = envelope.copyOfRange(signerStart + 32, signerStart + 96)
        val authorization = "ledger.authorization\u0000".encodeToByteArray() + byteArrayOf(0) + operation
        assertEquals(
            "f82a43b0bcb98f83962971d0a393b3f6703fb585ac5dad6bd9fb4f4d21e8163f",
            MessageDigest.getInstance("SHA-256").digest(authorization).toCanonicalHex(),
        )
        assertTrue(wallet.verify(authorization, signature))
        assertEquals(0, envelope.last().toInt())
    }

    @Test
    fun `atomic units enforce canonical u128`() {
        assertThrows(PayrailException::class.java) { AtomicUnits("01") }
        assertThrows(PayrailException::class.java) { AtomicUnits("-1") }
        AtomicUnits("340282366920938463463374607431768211455")
        assertThrows(PayrailException::class.java) {
            AtomicUnits("340282366920938463463374607431768211456")
        }
    }
}
