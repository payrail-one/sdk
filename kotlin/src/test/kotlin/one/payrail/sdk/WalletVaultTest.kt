package one.payrail.sdk

import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class WalletVaultTest {
    private val seed = ByteArray(32) { it.toByte() }
    private val password = "correct horse battery staple"

    @Test
    fun `vault matches browser and Swift format`() {
        val vault = WalletVault.create(
            prefix = "paydev",
            privateKeySeed = seed,
            password = password,
            salt = ByteArray(16) { it.toByte() },
            iv = ByteArray(12) { (it + 16).toByte() },
        )
        assertEquals("paydev1qqp6zpal708pp0sawrw33e6tczvk0exkxzd62r2lrhwgveqj25cms7uc5hh", vault.address)
        assertEquals("A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=", vault.publicKey)
        assertEquals("AAECAwQFBgcICQoLDA0ODw==", vault.salt)
        assertEquals("EBESExQVFhcYGRob", vault.iv)
        assertEquals(
            "PDx/xBDPrXHIkfy4yNFw2hE5mOeCYtCsyzkR4cS0TuCO0p364PTgO9QOuU265xJbSIxpi2n+sCUqyD5pgabEUw==",
            vault.ciphertext,
        )
        assertArrayEquals(seed, WalletVault.restoreSeed("paydev", password, vault))
    }

    @Test
    fun `vault round trips and wrong password fails`() {
        val vault = WalletVault.create("paydev", seed, password)
        assertEquals(vault, WalletVault.decode(WalletVault.encode(vault)))
        assertThrows(PayrailException::class.java) {
            WalletVault.restoreSeed("paydev", "wrong password value", vault)
        }
    }
}
