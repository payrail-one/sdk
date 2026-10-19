export const DEFAULT_GAME_GAS_LIMIT = 1_000_000;
export const MAX_GAME_GAS_LIMIT = 10_000_000;
export const MAX_GAME_PAYLOAD_BYTES = 16 * 1024;
const MAX_U64 = 18446744073709551615n;
export function validateGameIntent(intent) {
    const gasLimit = intent.gasLimit ?? DEFAULT_GAME_GAS_LIMIT;
    return {
        operation: validateGameOperation(intent.operation),
        contract_address: canonicalHex('contractAddress', intent.contractAddress, 40),
        amount: canonicalAtomicUnits('amountAtomic', intent.amountAtomic),
        fee: canonicalAtomicUnits('feeAtomic', intent.feeAtomic),
        nonce: safeUnsignedInteger('nonce', intent.nonce, true),
        timestamp: safeUnsignedInteger('timestamp', intent.timestamp, false),
        expires_at: safeUnsignedInteger('expiresAt', intent.expiresAt, false),
        public_key: canonicalHex('publicKeyHex', intent.publicKeyHex, 32),
        gas_limit: boundedInteger('gasLimit', gasLimit, 1, MAX_GAME_GAS_LIMIT),
    };
}
export function validateGameOperation(operation) {
    const payloadHex = operation.payloadHex ?? '';
    const canonicalPayload = canonicalHex('payloadHex', payloadHex);
    if (canonicalPayload.length / 2 > MAX_GAME_PAYLOAD_BYTES) {
        throw new R1GameInvariantError(`payloadHex must not exceed ${MAX_GAME_PAYLOAD_BYTES} bytes.`);
    }
    return {
        game_id: identifier('gameId', operation.gameId, 3, 64, /^[a-z0-9_.-]+$/),
        round_id: identifier('roundId', operation.roundId, 1, 128, /^[A-Za-z0-9_.:-]+$/),
        operation_id: identifier('operationId', operation.operationId, 8, 128, /^[A-Za-z0-9_.:-]+$/),
        action: identifier('action', operation.action, 1, 32, /^[a-z0-9_]+$/),
        payload_hex: canonicalPayload,
    };
}
export function canonicalAtomicUnits(field, value) {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) {
        throw new R1GameInvariantError(`${field} must be a canonical unsigned decimal string.`);
    }
    if (BigInt(value) > MAX_U64) {
        throw new R1GameInvariantError(`${field} exceeds the R1 u64 limit.`);
    }
    return value;
}
export function canonicalHex(field, value, expectedBytes) {
    const unprefixed = value.startsWith('0x') ? value.slice(2) : value;
    if (unprefixed.length % 2 !== 0 ||
        (unprefixed.length > 0 && !/^[0-9a-fA-F]+$/.test(unprefixed))) {
        throw new R1GameInvariantError(`${field} must contain even-length hexadecimal data.`);
    }
    if (expectedBytes !== undefined && unprefixed.length !== expectedBytes * 2) {
        throw new R1GameInvariantError(`${field} must contain exactly ${expectedBytes} bytes.`);
    }
    return unprefixed.toLowerCase();
}
export function bytesToHex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function hexToBytes(field, value, expectedBytes) {
    const canonical = canonicalHex(field, value, expectedBytes);
    return Uint8Array.from(canonical.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
}
export function utf8GamePayload(value) {
    return bytesToHex(new TextEncoder().encode(value));
}
export function createGameOperationId() {
    return crypto.randomUUID();
}
export function intentsEqual(expected, actual) {
    return (expected.contract_address === actual.contract_address &&
        expected.amount === actual.amount &&
        expected.fee === actual.fee &&
        expected.nonce === actual.nonce &&
        expected.timestamp === actual.timestamp &&
        expected.expires_at === actual.expires_at &&
        expected.public_key === actual.public_key &&
        expected.gas_limit === actual.gas_limit &&
        expected.operation.game_id === actual.operation.game_id &&
        expected.operation.round_id === actual.operation.round_id &&
        expected.operation.operation_id === actual.operation.operation_id &&
        expected.operation.action === actual.operation.action &&
        expected.operation.payload_hex === actual.operation.payload_hex);
}
export function fromWireIntent(wire) {
    return {
        operation: {
            gameId: wire.operation.game_id,
            roundId: wire.operation.round_id,
            operationId: wire.operation.operation_id,
            action: wire.operation.action,
            payloadHex: wire.operation.payload_hex,
        },
        contractAddress: wire.contract_address,
        amountAtomic: wire.amount,
        feeAtomic: wire.fee,
        nonce: wire.nonce,
        timestamp: wire.timestamp,
        expiresAt: wire.expires_at,
        publicKeyHex: wire.public_key,
        gasLimit: wire.gas_limit,
    };
}
function identifier(field, value, minimum, maximum, pattern) {
    if (value.length < minimum ||
        value.length > maximum ||
        !pattern.test(value)) {
        throw new R1GameInvariantError(`${field} does not satisfy the R1 Game API identifier rules.`);
    }
    return value;
}
function safeUnsignedInteger(field, value, allowZero) {
    const minimum = allowZero ? 0 : 1;
    if (!Number.isSafeInteger(value) || value < minimum) {
        throw new R1GameInvariantError(`${field} must be a safe integer greater than or equal to ${minimum}.`);
    }
    return value;
}
function boundedInteger(field, value, minimum, maximum) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new R1GameInvariantError(`${field} must be a safe integer between ${minimum} and ${maximum}.`);
    }
    return value;
}
export class R1GameInvariantError extends Error {
    constructor(message) {
        super(message);
        this.name = 'R1GameInvariantError';
    }
}
//# sourceMappingURL=validation.js.map