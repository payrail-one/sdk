# Payrail Code v1 interoperability profile

This document is the language-neutral contract implemented by the Payrail SDKs.
It does not define a new authorization mechanism: a code locates one checkout,
while the normal wallet signature authorizes the payment.

## Signed issue message

Wallets sign the exact byte concatenation below with their account Ed25519 key:

1. UTF-8 `payrail.approval.issue.v1` followed by one `00` byte;
2. 32-byte network identifier;
3. 32-byte account public key;
4. 32-byte persistent, random device identifier;
5. issue time as an unsigned 64-bit big-endian Unix millisecond value;
6. 32 bytes from an operating-system cryptographically secure random source.

No field has a length prefix. Hexadecimal JSON fields are canonical lowercase.
The resulting message is exactly 162 bytes and the Ed25519 signature is 64
bytes. Implementations MUST reject incorrect lengths before signing or sending.

`fixtures/payrail-code-v1.json` is the normative cross-language encoding vector.

## API lifecycle

- `POST /approval-codes` accepts a signed issue request and returns a six-digit
  string, an opaque session token and an expiry represented as a decimal string.
- A wallet polls `GET /approval-codes/sessions/{token}`. It MUST still show the
  immutable recipient and amount and require explicit payment authorization.
- A trusted merchant server sends the code to
  `POST /checkouts/{checkoutId}/approval-code` using a bearer credential.
- Merchant credentials MUST NOT be compiled into mobile or browser clients.
- Codes and SMS links are discovery data, never proof of payment.

Money uses canonical decimal strings at JSON boundaries and integer atomic units
inside applications. Implementations MUST NOT parse amounts through floating
point types.
