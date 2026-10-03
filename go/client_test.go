package payrail

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClaimKeepsCredentialInHeader(t *testing.T) {
	t.Parallel()
	checkoutID := strings.Repeat("ab", 32)
	server := httptest.NewTLSServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer "+strings.Repeat("s", 32) {
			t.Error("merchant credential was not sent in the authorization header")
		}
		if request.URL.RawQuery != "" {
			t.Error("merchant credential or code leaked into the query")
		}
		var body map[string]string
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil || body["code"] != "004219" {
			t.Error("claim body is not canonical")
		}
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(ApprovalCodeClaim{Status: "claimed", CheckoutID: checkoutID})
	}))
	defer server.Close()
	client, err := NewMerchantClient(server.URL, strings.Repeat("s", 32), server.Client())
	if err != nil {
		t.Fatal(err)
	}
	claim, err := client.ClaimApprovalCode(context.Background(), checkoutID, "004219")
	if err != nil {
		t.Fatal(err)
	}
	if claim.CheckoutID != checkoutID {
		t.Fatal("claim changed checkout ID")
	}
}

func TestRejectsMalformedCodeBeforeRequest(t *testing.T) {
	t.Parallel()
	client, err := NewMerchantClient("https://payrail.example/api", strings.Repeat("s", 32), nil)
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.ClaimApprovalCode(context.Background(), strings.Repeat("ab", 32), "12 456")
	if err == nil {
		t.Fatal("malformed code was accepted")
	}
}

func TestBuildsSMSComposerURL(t *testing.T) {
	t.Parallel()
	checkoutID := strings.Repeat("ab", 32)
	checkout := Checkout{
		ID: checkoutID, Amount: "12500000", PaymentPath: "/pay/" + checkoutID,
		SMSText: "Open {origin}/pay/" + checkoutID + ". A link never authorizes payment.",
	}
	message, err := CheckoutSMSMessage(checkout, "https://wallet.payrail.one")
	if err != nil {
		t.Fatal(err)
	}
	composer, err := SMSComposerURL(message, "+375291234567")
	if err != nil || !strings.HasPrefix(composer, "sms:+375291234567?body=") {
		t.Fatalf("unexpected composer URL: %q (%v)", composer, err)
	}
}
