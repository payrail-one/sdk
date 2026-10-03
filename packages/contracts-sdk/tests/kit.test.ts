import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PayrailContractKit,
  compileContractSource,
  contractBody,
  contractProgram,
  hexToBytes,
  type ContractProvider,
} from '../src/index';

function provider(): ContractProvider {
  return {
    async describe(contractId) {
      return {
        id: contractId,
        name: 'Test policy',
        version: 'preview',
        entrypoints: ['release'],
        stateVersion: 1n,
      };
    },
    async simulate(intent) {
      return {
        accepted: intent.attachedAmount <= 1_000n,
        estimatedUnits: BigInt(21_000 + intent.args.byteLength * 8),
        stateVersion: 1n,
        returnValue: new Uint8Array(),
        events: [],
        reason: null,
      };
    },
    async submit() {
      return {
        operationId: 'operation.preview',
        acceptedAtHeight: 1n,
        status: 'pending',
      };
    },
  };
}

test('canonical codecs reject ambiguous values', () => {
  assert.deepEqual([...hexToBytes('0x00ff')], [0, 255]);
  assert.throws(() => hexToBytes('0xFF'), /lowercase hexadecimal/);
});

test('intent construction preserves monetary values as bigint', () => {
  const kit = new PayrailContractKit(provider());
  const intent = kit.intent({
    contractId: '11'.repeat(32),
    caller: `paydev1${'q'.repeat(52)}`,
    entrypoint: 'release',
    args: Uint8Array.of(1, 2),
    attachedAmount: 9_007_199_254_740_993n,
    executionBudget: 50_000n,
    nonce: 0n,
    validUntilHeight: 100n,
  });
  assert.equal(intent.attachedAmount, 9_007_199_254_740_993n);
  assert.deepEqual([...intent.args], [1, 2]);
  assert.ok(Object.isFrozen(intent));
});

test('intent validation rejects unsafe execution boundaries', () => {
  const kit = new PayrailContractKit(provider());
  const input = {
    contractId: '11'.repeat(32),
    caller: `paydev1${'q'.repeat(52)}`,
    entrypoint: 'release',
    executionBudget: 1n,
    nonce: 0n,
    validUntilHeight: 1n,
  } as const;
  assert.throws(
    () => kit.intent({ ...input, executionBudget: 0n }),
    /positive/,
  );
  assert.throws(() => kit.intent({ ...input, nonce: -1n }), /negative/);
  assert.throws(
    () => kit.intent({ ...input, entrypoint: 'release()' }),
    /entrypoint/,
  );
});

test('simulation delegates a validated immutable intent', async () => {
  const kit = new PayrailContractKit(provider());
  const result = await kit.simulate({
    contractId: '11'.repeat(32),
    caller: `paydev1${'q'.repeat(52)}`,
    entrypoint: 'release',
    attachedAmount: 500n,
    executionBudget: 25_000n,
    nonce: 2n,
    validUntilHeight: 50n,
  });
  assert.equal(result.accepted, true);
  assert.equal(result.estimatedUnits, 21_000n);
});

test('bytecode builder emits a canonical executable PRC1 program', () => {
  const code = contractProgram()
    .entrypoint(
      'deposit',
      contractBody()
        .attachedAmount()
        .store('deposited')
        .emit('Deposited')
        .halt(),
    )
    .entrypoint(
      'refund',
      contractBody().state('deposited').transferToCaller().halt(),
    )
    .build();
  assert.deepEqual([...code.slice(0, 5)], [0x50, 0x52, 0x43, 0x31, 2]);
  assert.ok(code.byteLength < 16 * 1024);
});

test('runtime bounds are enforced before provider submission', () => {
  const kit = new PayrailContractKit(provider());
  const input = {
    contractId: '11'.repeat(32),
    caller: `paydev1${'q'.repeat(52)}`,
    entrypoint: 'release',
    executionBudget: 100_001n,
    nonce: 0n,
    validUntilHeight: 1n,
  } as const;
  assert.throws(() => kit.intent(input), /cannot exceed/);
  assert.throws(
    () =>
      kit.intent({ ...input, executionBudget: 1n, args: new Uint8Array(4097) }),
    /4096/,
  );
});

test('source compiler creates bytecode accepted by the PRC1 format', () => {
  const source = `payrail 1
entry deposit
  attached_amount
  store deposited
  emit Deposited
end

entry refund
  state deposited
  transfer_caller
  const 0
  store deposited
  emit Refunded
end`;
  const code = compileContractSource(source);
  assert.deepEqual([...code.slice(0, 5)], [0x50, 0x52, 0x43, 0x31, 2]);
  assert.throws(
    () => compileContractSource('entry broken\nunknown\nend'),
    /Line 2: unknown instruction/,
  );
});
