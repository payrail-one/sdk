# Payrail SDK

Multi-platform SDKs for Payrail checkout, Payrail Code, smart contracts and R1 games. The repository ships
browser and Node.js TypeScript, an iOS Swift Package, an Android/JVM Kotlin
library, and dependency-light Go and Python server clients.

Every implementation uses the same immutable checkout contract. Payrail Code is
a short-lived six-digit, BLIK-inspired locator: a merchant can claim the code,
but only the customer's wallet can review and sign the payment. Private keys
remain on the wallet device, merchant credentials remain on trusted servers,
and money is always represented with integer atomic units or canonical decimal
strings—never binary floating point.

> **Development network:** the current public endpoint uses test assets and a
> four-validator quorum. It is not a production settlement claim.

## Platforms

| Runtime           | Package                         | Intended use                                     |
| ----------------- | ------------------------------- | ------------------------------------------------ |
| Browser / Node.js | `@payrail-one/sdk`              | Checkout UI, wallet and Node server integrations |
| iOS / macOS       | `PayrailSDK` Swift Package      | Wallet signing, API access and Payrail Code      |
| Android / JVM     | `one.payrail:payrail-sdk`       | Wallet signing, API access and Payrail Code      |
| Go                | `github.com/payrail-one/sdk/go` | Merchant checkout and code-claim backend         |
| Python            | `payrail-sdk`                   | Merchant checkout and code-claim backend         |

The normative wire contract and cross-language byte vector are in
[`spec/payrail-code-v1.md`](spec/payrail-code-v1.md) and
[`fixtures/payrail-code-v1.json`](fixtures/payrail-code-v1.json).

## Install

TypeScript for browser or Node.js:

```sh
npm install github:payrail-one/sdk#v0.6.0
```

Swift Package Manager:

```swift
.package(url: "https://github.com/payrail-one/sdk", exact: "0.6.0")
```

Go server:

```sh
go get github.com/payrail-one/sdk/go@v0.5.0
```

Python server directly from this monorepo:

```sh
python -m pip install "payrail-sdk @ git+https://github.com/payrail-one/sdk@v0.5.0#subdirectory=python"
```

The Android/JVM JAR, sources and POM are attached to the GitHub release. Gradle
projects can also include `kotlin/` as a composite build. Maven
Central publishing will use the same `one.payrail:payrail-sdk` coordinates once
repository signing credentials are provisioned.

## TypeScript checkout

```ts
import { PayrailCheckout, parseAmount } from '@payrail-one/sdk';

const payrail = new PayrailCheckout({
  apiBaseUrl: 'https://devnet.payrail.one/api',
  merchantAddress: 'paydev1…',
});

const payment = await payrail.createPayment({
  amountAtomic: parseAmount('12.50', 6).toString(),
  orderReference: 'order_1042',
});

// Use the same canonical URL for a button, iframe or QR encoder.
payButton.href = payment.paymentUrl;
renderQr(payment.qrPayload);

const finalized = await payrail.waitForFinalization(payment.checkout.id, {
  onUpdate: (checkout) => renderStatus(checkout.status),
});

console.log(finalized.checkout.transaction?.id);
```

The SDK rejects a response if the recipient, amount, checkout identifier or
hosted payment path differs from the requested immutable payment.

## Smart contracts

Payrail Contract Language v1 compiles to deterministic, bounded `PRC1`
bytecode. Deploy and call envelopes use the same browser Ed25519 key boundary
as payments and are finalized by the four-validator Payrail devnet.

```ts
import { compileContractSource } from '@payrail-one/sdk/contracts';
import { createEphemeralWallet } from '@payrail-one/sdk/wallet-core';

const source = `payrail 1
entry deposit
  attached_amount
  store deposited
  emit Deposited
end`;

const wallet = await createEphemeralWallet(network.addressPrefix);
const envelope = await wallet.signContractDeploy({
  networkId: network.networkId,
  assetId: network.asset.id,
  idempotencyKey: crypto.getRandomValues(new Uint8Array(32)),
  salt: crypto.getRandomValues(new Uint8Array(32)),
  code: compileContractSource(source),
  fee: 1n,
  nonce,
  validUntilHeight,
});
await api.submit(envelope);
```

The v1 VM has checked `u128` arithmetic and bounded state, events and transfers;
it has no filesystem, network, clock, randomness, floating point or unbounded
execution. TEST assets have no monetary value. R1 is a separate network and is
not the Payrail contract runtime.

Try the live open-source sandbox at
[dapp.payrail.one](https://dapp.payrail.one).

## R1 Game SDK

Third-party games can prepare, locally sign, submit and independently observe
finalized R1 contract operations through `@payrail-one/sdk/games`. Private keys
never cross the SDK boundary. Monetary values are canonical decimal strings in
atomic units; JavaScript `number` is not used for money.

```ts
import {
  R1GameClient,
  cryptoKeyGameSigner,
  createGameOperationId,
  utf8GamePayload,
} from '@payrail-one/sdk/games';

const games = new R1GameClient(); // https://r1.verita.tech
const signer = cryptoKeyGameSigner(walletPrivateKey, walletPublicKey);

const admitted = await games.signAndSubmit(
  {
    operation: {
      gameId: 'studio.roulette',
      roundId: 'round-1042',
      operationId: createGameOperationId(),
      action: 'place_bet',
      payloadHex: utf8GamePayload(JSON.stringify({ selection: 'red' })),
    },
    contractAddress: gameContractAddress,
    amountAtomic: '1000000',
    feeAtomic: '1',
    nonce,
    timestamp: Date.now(),
    expiresAt: finalizedHeight + 100,
  },
  signer,
);

const settled = await games.waitForFinalization(admitted.transactionHash);
if (settled.status !== 'finalized' || settled.execution !== 'successful') {
  throw new Error('The game operation did not settle successfully.');
}
```

The SDK also exposes finalized, domain-separated randomness. A game must commit
its target height before that height finalizes; choosing from already revealed
heights is not fair randomness. See
[`spec/r1-game-api-v1.md`](spec/r1-game-api-v1.md) for the trust boundary and
wire contract. The live protocol document is available at
[`https://r1.verita.tech/v1/games/openapi.json`](https://r1.verita.tech/v1/games/openapi.json).

## Recommended architecture

Calculate prices and create the checkout in a backend-for-frontend. Return only
the resulting payment session to the browser or mobile application.
The public [Payrail demo store](https://store.payrail.one) is the reference:
its Workstar frontend and Go backend live in one repository, while this SDK
handles the Payrail payment contract.

Never place merchant custody keys, wallet seeds or privileged credentials in a
browser bundle. Opening a checkout does not authorize payment; authorization
occurs only inside the customer's Payrail wallet.

## Payrail Code and SMS

The wallet issues a two-minute code from a signed, device-bound request and
waits on an opaque session token:

```ts
import {
  PayrailCodeWalletClient,
  createPayrailDeviceId,
} from '@payrail-one/sdk/sms';

const codes = new PayrailCodeWalletClient({ apiBaseUrl: '/api' });
const issued = await codes.issue({
  wallet,
  networkId: network.networkId,
  deviceId: createPayrailDeviceId(), // persist one ID per wallet device
});

showSixDigits(issued.code);
const challenge = await codes.waitForChallenge(issued.sessionToken);
showCheckoutForExplicitApproval(challenge.checkout);
```

The merchant claim runs only on a trusted backend. Never put the merchant token
in browser JavaScript:

```ts
import { PayrailCodeMerchantClient } from '@payrail-one/sdk/sms';

const codes = new PayrailCodeMerchantClient({
  apiBaseUrl: process.env.PAYRAIL_API_URL!,
  merchantToken: process.env.PAYRAIL_CODE_MERCHANT_TOKEN!,
});
await codes.claim(checkoutId, sixDigitCode);
```

`checkoutSmsMessage` and `smsComposerUrl` create the provider-neutral SMS link.
An SMS or six-digit code never authorizes payment by itself; the wallet still
shows the immutable recipient and amount and produces the normal signed
transaction.

Swift and Kotlin accept a signer callback, allowing the host wallet to keep its
Ed25519 key inside its existing secure key boundary. The SDK constructs and
validates the canonical 162-byte message; it never exports wallet key material.
Go, Python and the Node.js client intentionally expose only merchant operations.

The Swift and Kotlin products additionally expose `PayrailWallet`, `AtomicUnits`,
`TransferIntent`, `PayrailClient` and `WalletVault`; Swift also provides the
native `PayrailLiveClient`. Their
Ed25519 address, transfer envelope and encrypted-vault vectors are checked
against the browser wallet core. `WalletVault` uses the same AES-256-GCM,
600,000-round PBKDF2 format as the web wallet, so users can move an encrypted
JSON backup between platforms. Mobile applications should store the active
32-byte seed behind a device-only Keychain or Android Keystore boundary,
require user presence before calling `signTransfer`, and treat live events only
as a signal to reload authoritative HTTP state.

## Packages and exports

- `@payrail-one/sdk` — checkout integration, amount helpers and public types;
- `@payrail-one/sdk/api-client` — typed development-network API client;
- `@payrail-one/sdk/money` — canonical decimal and atomic-unit conversion;
- `@payrail-one/sdk/wallet-core` — client-side signing and encrypted vaults.
- `@payrail-one/sdk/sms` — SMS composition and Payrail Code wallet/merchant clients.
- `@payrail-one/sdk/contracts` — `PRC1` builder, source compiler and typed contract intents.
- `@payrail-one/sdk/games` — client-signed R1 game operations, finality polling and finalized randomness.

## Develop and verify

```sh
npm ci --ignore-scripts
npm run check
npm test
npm pack --dry-run
cd go && go test -race ./...
PYTHONPATH=python python3 -m unittest discover -s python/tests
swift test
mvn -f kotlin/pom.xml test
```

Dependencies are exact-pinned in each ecosystem manifest. The TypeScript and
Kotlin inventories have committed SBOM evidence; Swift, Go and Python have no
third-party runtime dependencies.

## License

Licensed under [Apache License 2.0](LICENSE). See [NOTICE](NOTICE).
