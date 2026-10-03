const MAX_ARGS_BYTES = 4 * 1024;
const MAX_EXECUTION_UNITS = 100000n;
const MAX_SIGNED_ENVELOPE_BYTES = 32 * 1024;
export class PayrailContractKit {
    provider;
    constructor(provider) {
        this.provider = provider;
        if (!provider)
            throw new TypeError('A contract provider is required.');
    }
    describe(contractId) {
        return this.provider.describe(identifier(contractId, 'contractId'));
    }
    intent(input) {
        const args = Uint8Array.from(input.args ?? []);
        if (args.byteLength > MAX_ARGS_BYTES) {
            throw new RangeError(`Contract arguments exceed ${MAX_ARGS_BYTES} bytes.`);
        }
        return Object.freeze({
            contractId: identifier(input.contractId, 'contractId'),
            caller: identifier(input.caller, 'caller'),
            entrypoint: entrypoint(input.entrypoint),
            args,
            attachedAmount: unsigned(input.attachedAmount ?? 0n, 'attachedAmount'),
            executionBudget: executionBudget(input.executionBudget),
            nonce: unsigned(input.nonce, 'nonce'),
            validUntilHeight: positive(input.validUntilHeight, 'validUntilHeight'),
        });
    }
    simulate(input) {
        return this.provider.simulate(this.intent(input));
    }
    submit(signedEnvelope) {
        if (signedEnvelope.byteLength === 0) {
            throw new TypeError('A signed contract envelope is required.');
        }
        if (signedEnvelope.byteLength > MAX_SIGNED_ENVELOPE_BYTES) {
            throw new RangeError(`Signed envelope exceeds ${MAX_SIGNED_ENVELOPE_BYTES} bytes.`);
        }
        return this.provider.submit(Uint8Array.from(signedEnvelope));
    }
}
function identifier(value, field) {
    const normalized = value.trim();
    if (field === 'contractId' && !/^[0-9a-f]{64}$/.test(normalized)) {
        throw new TypeError('contractId must be a canonical 32-byte hexadecimal identifier.');
    }
    if (field !== 'contractId' &&
        !/^[a-z0-9]{2,16}1[ac-hj-np-z02-9]{20,100}$/.test(normalized)) {
        throw new TypeError(`${field} is not a valid Payrail address.`);
    }
    return normalized;
}
function entrypoint(value) {
    const normalized = value.trim();
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(normalized)) {
        throw new TypeError('Invalid contract entrypoint.');
    }
    return normalized;
}
function unsigned(value, field) {
    if (value < 0n)
        throw new RangeError(`${field} cannot be negative.`);
    return value;
}
function positive(value, field) {
    if (value <= 0n)
        throw new RangeError(`${field} must be positive.`);
    return value;
}
function executionBudget(value) {
    const parsed = positive(value, 'executionBudget');
    if (parsed > MAX_EXECUTION_UNITS) {
        throw new RangeError(`executionBudget cannot exceed ${MAX_EXECUTION_UNITS}.`);
    }
    return parsed;
}
//# sourceMappingURL=kit.js.map