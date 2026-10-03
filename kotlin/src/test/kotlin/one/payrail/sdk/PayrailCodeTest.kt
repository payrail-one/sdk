package one.payrail.sdk

import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class PayrailCodeTest {
    @Test
    fun `matches the interoperability vector`() {
        val message = PayrailCode.issueMessage(
            networkId = ByteArray(32) { 0x11 },
            publicKey = ByteArray(32) { 0x22 },
            deviceId = ByteArray(32) { 0x33 },
            issuedAtMs = 1_791_043_200_000,
            nonce = ByteArray(32) { 0x44 },
        )
        val expected = "7061797261696c2e617070726f76616c2e69737375652e763100" +
            "11".repeat(32) + "22".repeat(32) + "33".repeat(32) +
            "000001a1027e6400" + "44".repeat(32)
        assertEquals(162, message.size)
        assertEquals(expected, message.joinToString("") { "%02x".format(it) })
    }

    @Test
    fun `builds a canonical signed request`() {
        val request = PayrailCode.issueRequest(
            accountAddress = "paydev1example",
            networkId = ByteArray(32) { 0x11 },
            publicKey = ByteArray(32) { 0x22 },
            deviceId = ByteArray(32) { 0x33 },
            issuedAtMs = 1_791_043_200_000,
            nonce = ByteArray(32) { 0x44 },
            signer = PayrailSigner { message ->
                assertEquals(162, message.size)
                ByteArray(64) { 0x55 }
            },
        )
        assertEquals("1791043200000", request.issuedAtMs)
        assertEquals("33".repeat(32), request.deviceId)
        assertEquals("55".repeat(64), request.signature)
    }

    @Test
    fun `rejects malformed field lengths before signing`() {
        assertThrows(PayrailException::class.java) {
            PayrailCode.issueMessage(
                networkId = ByteArray(31),
                publicKey = ByteArray(32),
                deviceId = ByteArray(32),
                issuedAtMs = 1,
                nonce = ByteArray(32),
            )
        }
    }
}
