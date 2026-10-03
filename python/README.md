# Payrail Python SDK

Standard-library-only server SDK for immutable checkouts and Payrail Code
claims. Keep `merchant_token` in the server environment; never ship it to a
browser or mobile application.

```python
from payrail_sdk import MerchantClient

client = MerchantClient("https://devnet.payrail.one/api", merchant_token)
checkout = client.create_checkout(merchant_address, "12500000", "order_1042")
client.claim_approval_code(checkout["id"], "004219")
```
