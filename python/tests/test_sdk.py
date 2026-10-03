import json
import unittest

from payrail_sdk import MerchantClient, PayrailError, checkout_sms_message, sms_composer_url


CHECKOUT_ID = "ab" * 32


class Response:
    status = 200

    def __init__(self, body):
        self._body = json.dumps(body).encode()

    def read(self, limit):
        return self._body[:limit]


class Opener:
    def __init__(self):
        self.request = None

    def open(self, request, timeout):
        self.request = request
        return Response({"status": "claimed", "checkoutId": CHECKOUT_ID})


class SDKTests(unittest.TestCase):
    def test_claim_keeps_token_in_header(self):
        opener = Opener()
        client = MerchantClient(
            "https://payrail.example/api", "s" * 32, opener=opener
        )
        claim = client.claim_approval_code(CHECKOUT_ID, "004219")
        self.assertEqual(claim["checkoutId"], CHECKOUT_ID)
        self.assertEqual(opener.request.get_header("Authorization"), "Bearer " + "s" * 32)
        self.assertEqual(json.loads(opener.request.data), {"code": "004219"})
        self.assertEqual(opener.request.full_url.find("004219"), -1)

    def test_rejects_bad_code_before_io(self):
        opener = Opener()
        client = MerchantClient(
            "https://payrail.example/api", "s" * 32, opener=opener
        )
        with self.assertRaises(PayrailError):
            client.claim_approval_code(CHECKOUT_ID, "12 456")
        self.assertIsNone(opener.request)

    def test_sms_helpers(self):
        checkout = {
            "id": CHECKOUT_ID,
            "amount": "12500000",
            "paymentPath": f"/pay/{CHECKOUT_ID}",
            "smsText": f"Open {{origin}}/pay/{CHECKOUT_ID}. A link never authorizes payment.",
        }
        message = checkout_sms_message(checkout)
        self.assertIn("https://wallet.payrail.one/pay/", message)
        self.assertTrue(sms_composer_url(message, "+375291234567").startswith("sms:+375291234567?body="))


if __name__ == "__main__":
    unittest.main()
