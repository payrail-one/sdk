import assert from 'node:assert/strict';
import test from 'node:test';
import {
  R1GameClient,
  R1GameInvariantError,
  R1GameTimeoutError,
  cryptoKeyGameSigner,
  utf8GamePayload,
} from '../dist/packages/game-sdk/src/index.js';

const publicKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const publicKeyHex = Buffer.from(publicKey).toString('hex');
const contractAddress = 'ab'.repeat(40);
const signingHash = 'cd'.repeat(32);
const operationCommitment = 'ef'.repeat(32);
const transactionHash = '12'.repeat(32);

test('prepares, signs and submits without exposing private key material', async () => {
  const requests = [];
  let signedHash;
  const client = new R1GameClient({
    baseUrl: 'https://r1.example',
    fetcher: async (input, init) => {
      requests.push({ input: String(input), init });
      const body = JSON.parse(init.body);
      if (String(input).endsWith('/prepare')) {
        return Response.json(prepared(body));
      }
      assert.equal(body.signature, '34'.repeat(64));
      assert.deepEqual(
        body.intent,
        requests[0] && JSON.parse(requests[0].init.body),
      );
      return Response.json({
        api_version: 'r1.game.v1',
        tx_hash: transactionHash,
        operation_commitment: operationCommitment,
        status: 'admitted',
        status_url: `/v1/games/transactions/${transactionHash}`,
      });
    },
  });

  const result = await client.signAndSubmit(intent(), {
    publicKey,
    async sign(hash) {
      signedHash = new Uint8Array(hash);
      return Uint8Array.from({ length: 64 }, () => 0x34);
    },
  });

  assert.equal(result.transactionHash, transactionHash);
  assert.equal(Buffer.from(signedHash).toString('hex'), signingHash);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].input, 'https://r1.example/v1/games/prepare');
  assert.equal(requests[1].input, 'https://r1.example/v1/games/submit');
  assert.equal(JSON.stringify(requests).includes('private'), false);
});

test('rejects a server-mutated intent before invoking the signer', async () => {
  let signed = false;
  const client = new R1GameClient({
    fetcher: async (_input, init) => {
      const body = JSON.parse(init.body);
      return Response.json(prepared({ ...body, amount: '2' }));
    },
  });

  await assert.rejects(
    client.signAndSubmit(intent(), {
      publicKey,
      async sign() {
        signed = true;
        return new Uint8Array(64);
      },
    }),
    R1GameInvariantError,
  );
  assert.equal(signed, false);
});

test('rejects non-canonical money without issuing a request', async () => {
  let requested = false;
  const client = new R1GameClient({
    fetcher: async () => {
      requested = true;
      return Response.json({});
    },
  });
  await assert.rejects(
    client.prepare({
      ...intent(),
      publicKeyHex,
      amountAtomic: '01',
    }),
    R1GameInvariantError,
  );
  assert.equal(requested, false);
});

test('waits for independently reported successful finality', async () => {
  let calls = 0;
  const client = new R1GameClient({
    fetcher: async () => {
      calls += 1;
      return Response.json(
        calls === 1
          ? {
              api_version: 'r1.game.v1',
              tx_hash: transactionHash,
              status: 'included',
              finalized: false,
            }
          : {
              api_version: 'r1.game.v1',
              tx_hash: transactionHash,
              status: 'finalized',
              finalized: true,
              execution: 'successful',
              error: null,
              block_height: 42,
              block_hash: '56'.repeat(32),
            },
      );
    },
  });

  const status = await client.waitForFinalization(transactionHash, {
    intervalMs: 1,
    timeoutMs: 100,
  });
  assert.equal(status.execution, 'successful');
  assert.equal(status.blockHeight, 42);
  assert.equal(calls, 2);
});

test('times out when a transaction never finalizes', async () => {
  const client = new R1GameClient({
    fetcher: async () =>
      Response.json({
        api_version: 'r1.game.v1',
        tx_hash: transactionHash,
        status: 'missing',
        finalized: false,
      }),
  });
  await assert.rejects(
    client.waitForFinalization(transactionHash, {
      intervalMs: 1,
      timeoutMs: 1,
    }),
    R1GameTimeoutError,
  );
});

test('CryptoKey signer produces an independently verifiable Ed25519 signature', async () => {
  const pair = await crypto.subtle.generateKey('Ed25519', false, [
    'sign',
    'verify',
  ]);
  const rawPublicKey = new Uint8Array(
    await crypto.subtle.exportKey('raw', pair.publicKey),
  );
  const signer = cryptoKeyGameSigner(pair.privateKey, rawPublicKey);
  const hash = Uint8Array.from({ length: 32 }, (_, index) => index);
  const signature = await signer.sign(hash);
  assert.equal(signature.length, 64);
  assert.equal(
    await crypto.subtle.verify('Ed25519', pair.publicKey, signature, hash),
    true,
  );
});

test('encodes UTF-8 payloads as canonical lowercase hex', () => {
  assert.equal(utf8GamePayload('R1 🎮'), '523120f09f8eae');
});

function intent() {
  return {
    operation: {
      gameId: 'studio.roulette',
      roundId: 'round-42',
      operationId: 'operation-0001',
      action: 'place_bet',
      payloadHex: '010203',
    },
    contractAddress,
    amountAtomic: '1',
    feeAtomic: '1',
    nonce: 7,
    timestamp: 1_792_425_600_000,
    expiresAt: 1_518_000,
    gasLimit: 1_000_000,
  };
}

function prepared(wireIntent) {
  return {
    api_version: 'r1.game.v1',
    intent: wireIntent,
    sender: '78'.repeat(40),
    receiver: contractAddress,
    chain_id: 2,
    tx_type: 'contract_call',
    function: 'r1_game_v1',
    data: '523147414d450001',
    signing_hash: signingHash,
    operation_commitment: operationCommitment,
  };
}
