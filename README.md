# Payrail Web SDK

Framework-agnostic TypeScript for adding Payrail checkout to a website. The SDK
creates immutable fixed-amount payment sessions, produces the hosted-wallet URL
and QR payload, and waits for an independently loaded final receipt.

The repository also contains the lower-level API, canonical money and browser
wallet packages used by the Payrail demos. Private keys remain client-side and
money is represented as atomic integer strings or `bigint`, never JavaScript
`number`.

> **Development network:** the current public endpoint uses test assets and
> single-node development finality. It is not a production settlement claim.

## Install from GitHub

```sh
npm install github:payrail-one/sdk
```

The install exposes `@payrail-one/sdk`. A registry release can use the same
package without changing application imports.

## Create a payment

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

## Recommended website architecture

For a real merchant integration, calculate prices and create the checkout in a
backend-for-frontend. Return only the resulting payment session to the browser.
The public [Payrail demo store](https://store.payrail.one) is the reference:
its Workstar frontend and Go backend live in one repository, while this SDK
handles the Payrail payment contract.

Never place merchant custody keys, wallet seeds or privileged credentials in a
browser bundle. Opening a checkout does not authorize payment; authorization
occurs only inside the customer's Payrail wallet.

## Packages and exports

- `@payrail-one/sdk` — checkout integration, amount helpers and public types;
- `@payrail-one/sdk/api-client` — typed development-network API client;
- `@payrail-one/sdk/money` — canonical decimal and atomic-unit conversion;
- `@payrail-one/sdk/wallet-core` — client-side signing and encrypted vaults.

## Develop and verify

```sh
npm ci --ignore-scripts
npm run check
npm test
npm pack --dry-run
```

Dependencies are exact-pinned in `package-lock.json`; `sbom.cdx.json` records
the reviewed dependency inventory.

## License

Licensed under [Apache License 2.0](LICENSE). See [NOTICE](NOTICE).
