package payrail

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const maxResponseBytes = 1 << 20

var (
	checkoutIDPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
	codePattern       = regexp.MustCompile(`^[0-9]{6}$`)
	amountPattern     = regexp.MustCompile(`^[1-9][0-9]*$`)
	orderPattern      = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	merchantPattern   = regexp.MustCompile(`^pay[a-z0-9]{2,15}1[02-9ac-hj-np-z]{20,120}$`)
)

type Asset struct {
	ID       string `json:"id"`
	Symbol   string `json:"symbol"`
	Decimals uint8  `json:"decimals"`
}

type Checkout struct {
	ID               string `json:"id"`
	MerchantLabel    string `json:"merchantLabel"`
	MerchantAddress  string `json:"merchantAddress"`
	Amount           string `json:"amount"`
	Fee              string `json:"fee"`
	Asset            Asset  `json:"asset"`
	Status           string `json:"status"`
	ExpiresAtMS      string `json:"expiresAtMs"`
	ValidUntilHeight string `json:"validUntilHeight"`
	PaymentPath      string `json:"paymentPath"`
	SMSText          string `json:"smsText"`
}

type ApprovalCodeClaim struct {
	Status     string `json:"status"`
	CheckoutID string `json:"checkoutId"`
}

type APIError struct {
	StatusCode int
	Message    string
}

func (err *APIError) Error() string {
	return fmt.Sprintf("payrail API returned %d: %s", err.StatusCode, err.Message)
}

type MerchantClient struct {
	baseURL       *url.URL
	merchantToken string
	httpClient    *http.Client
}

func NewMerchantClient(baseURL, merchantToken string, httpClient *http.Client) (*MerchantClient, error) {
	parsed, err := url.Parse(strings.TrimRight(baseURL, "/"))
	if err != nil || parsed.Scheme != "https" && parsed.Hostname() != "localhost" ||
		parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, errors.New("Payrail API URL must use HTTPS")
	}
	if len(merchantToken) < 32 || len(merchantToken) > 256 {
		return nil, errors.New("merchant token must contain 32-256 characters")
	}
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 15 * time.Second}
	}
	return &MerchantClient{baseURL: parsed, merchantToken: merchantToken, httpClient: httpClient}, nil
}

func (client *MerchantClient) Checkout(ctx context.Context, checkoutID string) (Checkout, error) {
	if !checkoutIDPattern.MatchString(checkoutID) {
		return Checkout{}, errors.New("checkout ID is not canonical")
	}
	var checkout Checkout
	if err := client.request(ctx, http.MethodGet, "/checkouts/"+url.PathEscape(checkoutID), nil, false, &checkout); err != nil {
		return Checkout{}, err
	}
	if checkout.ID != checkoutID {
		return Checkout{}, errors.New("checkout response changed its identifier")
	}
	return checkout, validateCheckout(checkout)
}

func (client *MerchantClient) WaitForFinalization(ctx context.Context, checkoutID string, interval time.Duration) (Checkout, error) {
	if interval <= 0 || interval > time.Minute {
		return Checkout{}, errors.New("poll interval must be between zero and one minute")
	}
	for {
		checkout, err := client.Checkout(ctx, checkoutID)
		if err != nil {
			return Checkout{}, err
		}
		switch checkout.Status {
		case "finalized":
			return checkout, nil
		case "expired":
			return Checkout{}, errors.New("checkout expired before finalization")
		case "open", "processing":
		default:
			return Checkout{}, errors.New("checkout response contains an unknown status")
		}
		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return Checkout{}, ctx.Err()
		case <-timer.C:
		}
	}
}

func (client *MerchantClient) CreateCheckout(ctx context.Context, merchantAddress, amountAtomic, orderReference string) (Checkout, error) {
	if !merchantPattern.MatchString(merchantAddress) {
		return Checkout{}, errors.New("merchant address is not canonical")
	}
	if !amountPattern.MatchString(amountAtomic) {
		return Checkout{}, errors.New("amount must be a positive canonical atomic-unit string")
	}
	if !orderPattern.MatchString(orderReference) {
		return Checkout{}, errors.New("order reference is not canonical")
	}
	body := struct {
		MerchantAddress string `json:"merchantAddress"`
		Amount          string `json:"amount"`
		OrderReference  string `json:"orderReference"`
	}{merchantAddress, amountAtomic, orderReference}
	var checkout Checkout
	if err := client.request(ctx, http.MethodPost, "/checkouts", body, false, &checkout); err != nil {
		return Checkout{}, err
	}
	if checkout.MerchantAddress != merchantAddress || checkout.Amount != amountAtomic || checkout.Status != "open" {
		return Checkout{}, errors.New("checkout response changed an immutable payment field")
	}
	return checkout, validateCheckout(checkout)
}

func (client *MerchantClient) ClaimApprovalCode(ctx context.Context, checkoutID, code string) (ApprovalCodeClaim, error) {
	if !checkoutIDPattern.MatchString(checkoutID) {
		return ApprovalCodeClaim{}, errors.New("checkout ID is not canonical")
	}
	if !codePattern.MatchString(code) {
		return ApprovalCodeClaim{}, errors.New("Payrail Code must contain exactly six ASCII digits")
	}
	var claim ApprovalCodeClaim
	path := "/checkouts/" + url.PathEscape(checkoutID) + "/approval-code"
	if err := client.request(ctx, http.MethodPost, path, struct {
		Code string `json:"code"`
	}{code}, true, &claim); err != nil {
		return ApprovalCodeClaim{}, err
	}
	if claim.Status != "claimed" || claim.CheckoutID != checkoutID {
		return ApprovalCodeClaim{}, errors.New("approval claim response is inconsistent")
	}
	return claim, nil
}

func (client *MerchantClient) request(ctx context.Context, method, path string, body any, authenticated bool, output any) error {
	var encoded []byte
	if body != nil {
		var err error
		encoded, err = json.Marshal(body)
		if err != nil {
			return fmt.Errorf("encode Payrail request: %w", err)
		}
	}
	target := client.baseURL.ResolveReference(&url.URL{Path: strings.TrimRight(client.baseURL.Path, "/") + path})
	req, err := http.NewRequestWithContext(ctx, method, target.String(), bytes.NewReader(encoded))
	if err != nil {
		return fmt.Errorf("create Payrail request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if authenticated {
		req.Header.Set("Authorization", "Bearer "+client.merchantToken)
	}
	response, err := client.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send Payrail request: %w", err)
	}
	defer response.Body.Close()
	reader := io.LimitReader(response.Body, maxResponseBytes+1)
	payload, err := io.ReadAll(reader)
	if err != nil {
		return fmt.Errorf("read Payrail response: %w", err)
	}
	if len(payload) > maxResponseBytes {
		return errors.New("Payrail response exceeds size limit")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var failure struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(payload, &failure)
		if failure.Error == "" {
			failure.Error = http.StatusText(response.StatusCode)
		}
		return &APIError{StatusCode: response.StatusCode, Message: failure.Error}
	}
	if err := json.Unmarshal(payload, output); err != nil {
		return fmt.Errorf("decode Payrail response: %w", err)
	}
	return nil
}

func validateCheckout(checkout Checkout) error {
	if !checkoutIDPattern.MatchString(checkout.ID) || checkout.PaymentPath != "/pay/"+checkout.ID {
		return errors.New("checkout response is not canonical")
	}
	if !amountPattern.MatchString(checkout.Amount) {
		return errors.New("checkout amount is not canonical")
	}
	return nil
}
