import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PayrailCodeInvariantError,
  PayrailCodeMerchantClient,
  PayrailCodeWalletClient,
  checkoutSmsMessage,
  smsComposerUrl,
} from '../dist/src/index.js';

const checkoutId = 'ab'.repeat(32);
const sessionToken = 'cd'.repeat(72);

test('issues and waits for a BLIK-style Payrail Code challenge', async () => {
  const requests = [];
  let polls = 0;
  const client = new PayrailCodeWalletClient({
    apiBaseUrl: 'https://payrail.example/api',
    fetcher: async (input, init) => {
      requests.push({ input: String(input), init });
      if (String(input).endsWith('/approval-codes')) {
        return Response.json({
          code: '004219',
          sessionToken,
          expiresAtMs: '1791043320000',
        });
      }
      polls += 1;
      return Response.json(
        polls === 1
          ? { status: 'waiting', checkout: null }
          : { status: 'claimed', checkout: checkout() },
      );
    },
  });
  const wallet = {
    async createApprovalCodeIssue(input) {
      assert.equal(input.networkId, '11'.repeat(32));
      assert.equal(input.deviceId.length, 32);
      return {
        accountAddress: checkout().merchantAddress,
        deviceId: '22'.repeat(32),
        issuedAtMs: '1791043200000',
        nonce: '33'.repeat(32),
        signature: '44'.repeat(64),
      };
    },
  };
  const issued = await client.issue({
    wallet,
    networkId: '11'.repeat(32),
    deviceId: new Uint8Array(32),
  });
  assert.equal(issued.code, '004219');
  const challenge = await client.waitForChallenge(sessionToken, {
    intervalMs: 1,
    timeoutMs: 100,
  });
  assert.equal(challenge.status, 'claimed');
  assert.equal(challenge.checkout.id, checkoutId);
  assert.equal(requests.length, 3);
});

test('merchant claim keeps the credential in a server-side header', async () => {
  let request;
  const client = new PayrailCodeMerchantClient({
    apiBaseUrl: 'https://payrail.example/api',
    merchantToken: 'merchant-secret-token-with-32-characters',
    fetcher: async (input, init) => {
      request = { input: String(input), init };
      return Response.json({ status: 'claimed', checkoutId });
    },
  });
  const claimed = await client.claim(checkoutId, '004219');
  assert.equal(claimed.checkoutId, checkoutId);
  assert.equal(request.init.headers.authorization.startsWith('Bearer '), true);
  assert.deepEqual(JSON.parse(request.init.body), { code: '004219' });
});

test('builds an authoritative SMS link without making it authorization', () => {
  const message = checkoutSmsMessage(checkout());
  assert.match(message, /https:\/\/wallet\.payrail\.one\/pay\/ab/);
  assert.match(message, /never authorizes payment/i);
  assert.equal(
    smsComposerUrl({ body: message, recipient: '+375291234567' }),
    `sms:+375291234567?body=${encodeURIComponent(message)}`,
  );
});

test('rejects malformed codes before a network request', () => {
  let requested = false;
  const client = new PayrailCodeMerchantClient({
    apiBaseUrl: 'https://payrail.example/api',
    merchantToken: 'merchant-secret-token-with-32-characters',
    fetcher: async () => {
      requested = true;
      return Response.json({});
    },
  });
  assert.throws(
    () => client.claim(checkoutId, '12 456'),
    PayrailCodeInvariantError,
  );
  assert.equal(requested, false);
});

function checkout() {
  return {
    id: checkoutId,
    merchantLabel: 'Aurora Market · Devnet',
    merchantAddress:
      'paydev1qzn5sxzyfr7zs37hlh2vk8zmc76qsvhk42z9duygfyhm9zz8kaqpqut57pl',
    amount: '12500000',
    fee: '0',
    asset: { id: '11'.repeat(32), symbol: 'TEST', decimals: 6 },
    status: 'open',
    expiresAtMs: '1791044100000',
    validUntilHeight: '100',
    paymentPath: `/pay/${checkoutId}`,
    smsText:
      `Payment request: 12.5 TEST. Open {origin}/pay/${checkoutId}. ` +
      'A link never authorizes payment.',
    transaction: null,
  };
}
