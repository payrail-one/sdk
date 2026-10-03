package payrail

import (
	"errors"
	"net/url"
	"regexp"
	"strings"
)

var e164Pattern = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)

func CheckoutSMSMessage(checkout Checkout, walletOrigin string) (string, error) {
	if err := validateCheckout(checkout); err != nil {
		return "", err
	}
	origin, err := url.Parse(walletOrigin)
	if err != nil || origin.Scheme != "https" && origin.Hostname() != "localhost" {
		return "", errors.New("wallet origin must use HTTPS")
	}
	origin.Path, origin.RawQuery, origin.Fragment = "", "", ""
	canonicalOrigin := strings.TrimRight(origin.String(), "/")
	message := strings.ReplaceAll(checkout.SMSText, "{origin}", canonicalOrigin)
	if len(message) == 0 || len(message) > 480 || !strings.Contains(message, canonicalOrigin+checkout.PaymentPath) {
		return "", errors.New("checkout SMS text does not contain its canonical payment URL")
	}
	return message, nil
}

func SMSComposerURL(body, recipient string) (string, error) {
	if len(body) == 0 || len(body) > 480 {
		return "", errors.New("SMS body must contain 1-480 characters")
	}
	if recipient != "" && !e164Pattern.MatchString(recipient) {
		return "", errors.New("SMS recipient must use E.164 format")
	}
	return "sms:" + recipient + "?body=" + url.QueryEscape(body), nil
}
