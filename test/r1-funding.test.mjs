import assert from 'node:assert/strict';
import test from 'node:test';
import {
  R1FundingClient,
  R1FundingInvariantError,
  fundingTransferInput,
} from '../dist/packages/r1-funding/src/index.js';

const ID = '11'.repeat(32);
const NETWORK = '22'.repeat(32);
const ASSET = '33'.repeat(32);
const R1_DESTINATION = '44'.repeat(40);
const LIQUIDITY =
  'paydev1qzn5sxzyfr7zs37hlh2vk8zmc76qsvhk42z9duygfyhm9zz8kaqpqut57pl';

function operation(overrides = {}) {
  return {
    id: ID,
    status: 'quote_issued',
    payrailNetworkId: NETWORK,
    sourceAssetId: ASSET,
    inputAmount: '10000000',
    feeAmount: '10000',
    outputR1Amount: '9990000',
    createdAtHeight: '40',
    expiresAtHeight: '60',
    payrailLiquidityAccount: LIQUIDITY,
    payrailTransactionId: null,
    payrailBlockHeight: null,
    r1Destination: R1_DESTINATION,
    r1TransactionHash: null,
    r1BlockHeight: null,
    ...overrides,
  };
}

const account = {
  address: LIQUIDITY,
  nonce: '7',
  balance: '20000000',
};

const network = {
  networkId: NETWORK,
  addressPrefix: 'paydev',
  finalizedHeight: '41',
  asset: { id: ASSET },
};

test('funding transfer is exactly bound to the quote', () => {
  const input = fundingTransferInput(operation(), account, network);
  assert.equal(input.networkId, NETWORK);
  assert.equal(input.assetId, ASSET);
  assert.deepEqual(
    input.idempotencyKey,
    Uint8Array.from({ length: 32 }, () => 0x11),
  );
  assert.equal(input.amount, 10_000_000n);
  assert.equal(input.fee, 0n);
  assert.equal(input.nonce, 7n);
  assert.equal(input.validUntilHeight, 60n);
  assert.equal(input.recipientAccountId.length, 64);
});

test('funding transfer rejects substituted network, asset, expiry and balance', () => {
  assert.throws(
    () =>
      fundingTransferInput(operation(), account, {
        ...network,
        networkId: '55'.repeat(32),
      }),
    R1FundingInvariantError,
  );
  assert.throws(
    () =>
      fundingTransferInput(operation(), account, {
        ...network,
        asset: { id: '55'.repeat(32) },
      }),
    R1FundingInvariantError,
  );
  assert.throws(
    () =>
      fundingTransferInput(operation(), account, {
        ...network,
        finalizedHeight: '61',
      }),
    R1FundingInvariantError,
  );
  assert.throws(
    () =>
      fundingTransferInput(operation(), { ...account, balance: '1' }, network),
    R1FundingInvariantError,
  );
});

test('client validates quote echo and submits the signed envelope', async () => {
  const requests = [];
  const fetcher = async (url, init = {}) => {
    requests.push({ url, init });
    const body =
      requests.length === 1 ? operation() : operation({ status: 'completed' });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const client = new R1FundingClient({
    settlementBaseUrl: 'https://settlement.example/api/payrail/settlement/',
    fetcher,
  });
  const quote = await client.quote({
    inputAmountAtomic: '10000000',
    r1Destination: R1_DESTINATION,
  });
  const result = await client.submit(quote, Uint8Array.of(1, 2, 3));
  assert.equal(result.status, 'completed');
  assert.equal(
    requests[0].url,
    'https://settlement.example/api/payrail/settlement/funding-quotes',
  );
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    inputAmount: '10000000',
    r1Destination: R1_DESTINATION,
  });
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    quoteId: ID,
    payrailEnvelope: '010203',
  });
});

test('client rejects a quote whose immutable request fields were changed', async () => {
  const client = new R1FundingClient({
    fetcher: async () =>
      new Response(JSON.stringify(operation({ inputAmount: '999' })), {
        status: 200,
      }),
  });
  await assert.rejects(
    client.quote({
      inputAmountAtomic: '10000000',
      r1Destination: R1_DESTINATION,
    }),
    R1FundingInvariantError,
  );
});
