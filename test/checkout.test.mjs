import assert from 'node:assert/strict';
import test from 'node:test';
import { CheckoutInvariantError, PayrailCheckout } from '../dist/src/index.js';

const merchant =
  'paydev1qzn5sxzyfr7zs37hlh2vk8zmc76qsvhk42z9duygfyhm9zz8kaqpqut57pl';
const checkoutId = 'ab'.repeat(32);

test('creates a canonical hosted payment session', async () => {
  const requests = [];
  const sdk = new PayrailCheckout({
    apiBaseUrl: 'https://store.example/api',
    merchantAddress: merchant,
    fetcher: async (input, init) => {
      requests.push({ input: String(input), init });
      return Response.json(checkout());
    },
  });

  const session = await sdk.createPayment({
    amountAtomic: '12500000',
    orderReference: 'order_1042',
  });

  assert.equal(
    session.paymentUrl,
    `https://wallet.payrail.one/pay/${checkoutId}`,
  );
  assert.equal(session.qrPayload, session.paymentUrl);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].input, 'https://store.example/api/checkouts');
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    merchantAddress: merchant,
    amount: '12500000',
    orderReference: 'order_1042',
  });
});

test('rejects a checkout whose immutable amount changed', async () => {
  const sdk = new PayrailCheckout({
    apiBaseUrl: 'https://store.example/api',
    merchantAddress: merchant,
    fetcher: async () => Response.json(checkout({ amount: '12500001' })),
  });

  await assert.rejects(
    sdk.createPayment({
      amountAtomic: '12500000',
      orderReference: 'order_1042',
    }),
    CheckoutInvariantError,
  );
});

test('rejects non-canonical money before issuing a request', async () => {
  let requested = false;
  const sdk = new PayrailCheckout({
    apiBaseUrl: 'https://store.example/api',
    merchantAddress: merchant,
    fetcher: async () => {
      requested = true;
      return Response.json(checkout());
    },
  });

  await assert.rejects(
    sdk.createPayment({ amountAtomic: '12.50', orderReference: 'order_1042' }),
    CheckoutInvariantError,
  );
  assert.equal(requested, false);
});

test('waits until the independently loaded checkout is finalized', async () => {
  let calls = 0;
  const sdk = new PayrailCheckout({
    apiBaseUrl: 'https://store.example/api',
    merchantAddress: merchant,
    fetcher: async () => {
      calls += 1;
      return Response.json(
        checkout(
          calls === 1 ? { status: 'processing' } : { status: 'finalized' },
        ),
      );
    },
  });

  const result = await sdk.waitForFinalization(checkoutId, {
    intervalMs: 1,
    timeoutMs: 100,
  });
  assert.equal(result.checkout.status, 'finalized');
  assert.equal(calls, 2);
});

function checkout(overrides = {}) {
  return {
    id: checkoutId,
    merchantLabel: 'Aurora Market · Devnet',
    merchantAddress: merchant,
    amount: '12500000',
    fee: '0',
    asset: { id: '11'.repeat(32), symbol: 'TEST', decimals: 6 },
    status: 'open',
    expiresAtMs: '1791043200000',
    validUntilHeight: '100',
    paymentPath: `/pay/${checkoutId}`,
    smsText: 'Pay Aurora Market',
    transaction: null,
    ...overrides,
  };
}
