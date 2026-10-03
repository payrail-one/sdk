"""Payrail server SDK with no third-party runtime dependencies."""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Any, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urljoin, urlparse
from urllib.request import Request, build_opener

_CHECKOUT_ID = re.compile(r"^[0-9a-f]{64}$")
_CODE = re.compile(r"^[0-9]{6}$")
_AMOUNT = re.compile(r"^[1-9][0-9]*$")
_ORDER = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_E164 = re.compile(r"^\+[1-9][0-9]{7,14}$")
_MERCHANT = re.compile(r"^pay[a-z0-9]{2,15}1[02-9ac-hj-np-z]{20,120}$")
_MAX_RESPONSE_BYTES = 1 << 20


class PayrailError(Exception):
    """Base error for local invariants and remote API failures."""


@dataclass(frozen=True)
class PayrailAPIError(PayrailError):
    status_code: int
    message: str

    def __str__(self) -> str:
        return f"Payrail API returned {self.status_code}: {self.message}"


class MerchantClient:
    def __init__(
        self,
        api_base_url: str,
        merchant_token: str,
        *,
        timeout_seconds: float = 10.0,
        opener: Any | None = None,
    ) -> None:
        parsed = urlparse(api_base_url)
        if (
            parsed.scheme != "https"
            and parsed.hostname != "localhost"
            or parsed.username is not None
            or parsed.query
            or parsed.fragment
        ):
            raise PayrailError("Payrail API URL must use HTTPS")
        if not 32 <= len(merchant_token) <= 256:
            raise PayrailError("merchant token must contain 32-256 characters")
        if timeout_seconds <= 0 or timeout_seconds > 300:
            raise PayrailError("timeout must be between 0 and 300 seconds")
        self._base_url = api_base_url.rstrip("/") + "/"
        self._merchant_token = merchant_token
        self._timeout_seconds = timeout_seconds
        self._opener = opener or build_opener()

    def create_checkout(
        self, merchant_address: str, amount_atomic: str, order_reference: str
    ) -> Mapping[str, Any]:
        if not _MERCHANT.fullmatch(merchant_address):
            raise PayrailError("merchant address is not canonical")
        if not _AMOUNT.fullmatch(amount_atomic):
            raise PayrailError("amount must be a positive canonical atomic-unit string")
        if not _ORDER.fullmatch(order_reference):
            raise PayrailError("order reference is not canonical")
        checkout = self._request(
            "checkouts",
            {
                "merchantAddress": merchant_address,
                "amount": amount_atomic,
                "orderReference": order_reference,
            },
            authenticated=False,
        )
        _validate_checkout(checkout)
        if (
            checkout.get("merchantAddress") != merchant_address
            or checkout.get("amount") != amount_atomic
            or checkout.get("status") != "open"
        ):
            raise PayrailError("checkout response changed an immutable payment field")
        return checkout

    def claim_approval_code(
        self, checkout_id: str, code: str
    ) -> Mapping[str, Any]:
        _validate_checkout_id(checkout_id)
        if not _CODE.fullmatch(code):
            raise PayrailError("Payrail Code must contain exactly six ASCII digits")
        result = self._request(
            f"checkouts/{quote(checkout_id, safe='')}/approval-code",
            {"code": code},
            authenticated=True,
        )
        if result.get("status") != "claimed" or result.get("checkoutId") != checkout_id:
            raise PayrailError("approval claim response is inconsistent")
        return result

    def checkout(self, checkout_id: str) -> Mapping[str, Any]:
        _validate_checkout_id(checkout_id)
        checkout = self._request(
            f"checkouts/{quote(checkout_id, safe='')}",
            None,
            authenticated=False,
            method="GET",
        )
        _validate_checkout(checkout)
        if checkout.get("id") != checkout_id:
            raise PayrailError("checkout response changed its identifier")
        return checkout

    def wait_for_finalization(
        self, checkout_id: str, *, poll_interval_seconds: float = 2.0, timeout_seconds: float = 900.0
    ) -> Mapping[str, Any]:
        if not 0 < poll_interval_seconds <= 60 or not 0 < timeout_seconds <= 86_400:
            raise PayrailError("polling interval or timeout is outside the supported range")
        deadline = time.monotonic() + timeout_seconds
        while True:
            checkout = self.checkout(checkout_id)
            status = checkout.get("status")
            if status == "finalized":
                return checkout
            if status == "expired":
                raise PayrailError("checkout expired before finalization")
            if status not in {"open", "processing"}:
                raise PayrailError("checkout response contains an unknown status")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise PayrailError("checkout did not finalize before the timeout")
            time.sleep(min(poll_interval_seconds, remaining))

    def _request(
        self,
        path: str,
        body: Mapping[str, str] | None,
        *,
        authenticated: bool,
        method: str = "POST",
    ) -> Mapping[str, Any]:
        payload = (
            json.dumps(body, separators=(",", ":")).encode("utf-8")
            if body is not None
            else None
        )
        headers = {"Accept": "application/json"}
        if payload is not None:
            headers["Content-Type"] = "application/json"
        if authenticated:
            headers["Authorization"] = f"Bearer {self._merchant_token}"
        request = Request(
            urljoin(self._base_url, path), data=payload, headers=headers, method=method
        )
        try:
            response = self._opener.open(request, timeout=self._timeout_seconds)
            status = response.status
            raw = response.read(_MAX_RESPONSE_BYTES + 1)
        except HTTPError as error:
            status = error.code
            raw = error.read(_MAX_RESPONSE_BYTES + 1)
        except URLError as error:
            raise PayrailError("Payrail request failed") from error
        if len(raw) > _MAX_RESPONSE_BYTES:
            raise PayrailError("Payrail response exceeds size limit")
        try:
            decoded = json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise PayrailError("Payrail returned malformed JSON") from error
        if not isinstance(decoded, dict):
            raise PayrailError("Payrail returned a non-object response")
        if not 200 <= status < 300:
            message = decoded.get("error")
            raise PayrailAPIError(status, message if isinstance(message, str) else "request failed")
        return decoded


def checkout_sms_message(
    checkout: Mapping[str, Any], wallet_origin: str = "https://wallet.payrail.one"
) -> str:
    _validate_checkout(checkout)
    parsed = urlparse(wallet_origin)
    if parsed.scheme != "https" and parsed.hostname != "localhost":
        raise PayrailError("wallet origin must use HTTPS")
    origin = f"{parsed.scheme}://{parsed.netloc}"
    template = checkout.get("smsText")
    payment_path = checkout.get("paymentPath")
    if not isinstance(template, str) or not isinstance(payment_path, str):
        raise PayrailError("checkout SMS fields are malformed")
    message = template.replace("{origin}", origin)
    if not 1 <= len(message) <= 480 or origin + payment_path not in message:
        raise PayrailError("checkout SMS text does not contain its canonical payment URL")
    return message


def sms_composer_url(body: str, recipient: str = "") -> str:
    if not 1 <= len(body) <= 480:
        raise PayrailError("SMS body must contain 1-480 characters")
    if recipient and not _E164.fullmatch(recipient):
        raise PayrailError("SMS recipient must use E.164 format")
    return f"sms:{recipient}?{urlencode({'body': body})}"


def _validate_checkout(checkout: Mapping[str, Any]) -> None:
    checkout_id = checkout.get("id")
    if not isinstance(checkout_id, str):
        raise PayrailError("checkout ID is missing")
    _validate_checkout_id(checkout_id)
    if checkout.get("paymentPath") != f"/pay/{checkout_id}":
        raise PayrailError("checkout payment path is not canonical")
    amount = checkout.get("amount")
    if not isinstance(amount, str) or not _AMOUNT.fullmatch(amount):
        raise PayrailError("checkout amount is not canonical")


def _validate_checkout_id(checkout_id: str) -> None:
    if not _CHECKOUT_ID.fullmatch(checkout_id):
        raise PayrailError("checkout ID is not canonical")


__all__ = [
    "MerchantClient",
    "PayrailAPIError",
    "PayrailError",
    "checkout_sms_message",
    "sms_composer_url",
]
