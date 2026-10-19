# R1 Game API v1

`@payrail-one/sdk/games` is the TypeScript boundary for third-party games that
settle operations on R1. It targets `https://r1.verita.tech/v1/games` by
default. R1 and Payrail are separate networks; including the client in this
repository does not merge their ledgers, assets or finality rules.

## Security boundary

- A wallet private key remains inside a browser `CryptoKey`, hardware wallet,
  custody boundary or caller-provided signer.
- The API receives only the public key, intent and Ed25519 signature.
- `prepare` returns the canonical 32-byte R1 transaction hash. The SDK verifies
  that the echoed intent and contract receiver are unchanged before signing.
- HTTP admission is not settlement. A game operation is settled only when its
  execution succeeds in a finalized block.
- Amount and fee values are canonical unsigned decimal strings in atomic units.
  Floating-point money is forbidden.
- `operationId` is an idempotency and replay-correlation key. Generate a new
  value for every logical operation and persist it with the game round.

## Operation intent

The public TypeScript API uses camel case and maps it to this JSON wire shape:

```json
{
  "operation": {
    "game_id": "studio.roulette",
    "round_id": "round-1042",
    "operation_id": "85c697c6-6603-4af8-b639-b5dfcedab0cd",
    "action": "place_bet",
    "payload_hex": "7b7d"
  },
  "contract_address": "<40-byte lowercase hex>",
  "amount": "1000000",
  "fee": "1",
  "nonce": 42,
  "timestamp": 1792425600000,
  "expires_at": 1518000,
  "public_key": "<32-byte lowercase hex>",
  "gas_limit": 1000000
}
```

Identifiers and actions are bounded ASCII. Payloads are opaque canonical hex,
limited to 16 KiB. All numeric JSON fields must fit in JavaScript's safe integer
range; money remains string encoded.

## Signing and submission

1. `POST /v1/games/prepare` with the intent.
2. Verify the returned intent, receiver, entrypoint and API version.
3. Sign the returned 32-byte `signing_hash` with Ed25519.
4. `POST /v1/games/submit` with the same intent and 64-byte signature.
5. Poll `/v1/games/transactions/{hash}` until `finalized` is true.
6. Accept settlement only when `status` is `finalized` and `execution` is
   `successful`. A finalized failed receipt is not a successful game action.

`R1GameClient.signAndSubmit` performs steps 1–4 without exposing private key
material. `waitForFinalization` performs step 5 and returns the terminal receipt
for the application to evaluate.

## Finalized randomness

`GET /v1/games/randomness/{height}` returns a BLAKE3 value bound to the R1
domain, chain ID, height and finalized block hash. The response also links to a
finality proof. A fair game must commit the target height before it is known and
must never select from multiple finalized heights after observing their values.

## Compatibility

The server also exposes `/api/v1/games` aliases for existing reverse proxies.
The SDK uses canonical `/v1/games` paths. Protocol discovery and OpenAPI are
available at:

- `GET /v1/games`
- `GET /v1/games/openapi.json`
