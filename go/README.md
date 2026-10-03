# Payrail Go SDK

Server-side merchant client built entirely on the Go standard library. Amounts
are canonical atomic-unit strings and the merchant credential is emitted only
in the authorization header of a Payrail Code claim.

```go
client, err := payrail.NewMerchantClient(apiURL, merchantToken, nil)
checkout, err := client.CreateCheckout(ctx, merchantAddress, "12500000", "order_1042")
claim, err := client.ClaimApprovalCode(ctx, checkout.ID, "004219")
```
