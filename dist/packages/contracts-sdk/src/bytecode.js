const MAGIC = Uint8Array.of(0x50, 0x52, 0x43, 0x31);
const MAX_ENTRYPOINTS = 16;
const MAX_NAME_BYTES = 32;
const MAX_KEY_BYTES = 32;
const MAX_BODY_BYTES = 0xffff;
const MAX_CODE_BYTES = 16 * 1024;
const encoder = new TextEncoder();
export class ContractBodyBuilder {
    #parts = [];
    #halted = false;
    constant(value) {
        return this.instruction(0x01, unsigned(value, 16));
    }
    argumentU128(offset) {
        return this.instruction(0x02, u16(offset, 'argument offset'));
    }
    state(key) {
        return this.instruction(0x03, sizedText(key, 'state key', MAX_KEY_BYTES));
    }
    attachedAmount() {
        return this.instruction(0x04);
    }
    add() {
        return this.instruction(0x05);
    }
    subtract() {
        return this.instruction(0x06);
    }
    equals() {
        return this.instruction(0x07);
    }
    lessThanOrEqual() {
        return this.instruction(0x08);
    }
    greaterThanOrEqual() {
        return this.instruction(0x09);
    }
    require(reason) {
        return this.instruction(0x0a, u16(reason, 'rejection reason'));
    }
    store(key) {
        return this.instruction(0x0b, sizedText(key, 'state key', MAX_KEY_BYTES));
    }
    emit(topic) {
        return this.instruction(0x0c, sizedText(topic, 'event topic', MAX_KEY_BYTES));
    }
    duplicate() {
        return this.instruction(0x0d);
    }
    drop() {
        return this.instruction(0x0e);
    }
    transferToCaller() {
        return this.instruction(0x0f);
    }
    transferToArgumentAccount(offset) {
        return this.instruction(0x10, u16(offset, 'account argument offset'));
    }
    halt() {
        this.instruction(0x00);
        this.#halted = true;
        return this;
    }
    build() {
        if (!this.#halted)
            throw new Error('Contract entrypoint must end with halt().');
        return concat(...this.#parts);
    }
    instruction(opcode, operand) {
        if (this.#halted)
            throw new Error('Cannot append instructions after halt().');
        this.#parts.push(Uint8Array.of(opcode));
        if (operand)
            this.#parts.push(operand);
        return this;
    }
}
export class ContractProgramBuilder {
    #entries = new Map();
    entrypoint(name, body) {
        const encodedName = canonicalName(name);
        if (this.#entries.has(name))
            throw new Error(`Duplicate entrypoint: ${name}.`);
        if (this.#entries.size >= MAX_ENTRYPOINTS) {
            throw new Error(`A contract supports at most ${MAX_ENTRYPOINTS} entrypoints.`);
        }
        const bytes = body.build();
        if (bytes.length > MAX_BODY_BYTES)
            throw new Error('Entrypoint body is too large.');
        this.#entries.set(new TextDecoder().decode(encodedName), bytes);
        return this;
    }
    build() {
        if (this.#entries.size === 0)
            throw new Error('Contract has no entrypoints.');
        const entries = [];
        for (const [name, body] of this.#entries) {
            const encodedName = encoder.encode(name);
            entries.push(Uint8Array.of(encodedName.length), encodedName, u16(body.length, 'entrypoint body length'), body);
        }
        const code = concat(MAGIC, Uint8Array.of(this.#entries.size), ...entries);
        if (code.length > MAX_CODE_BYTES)
            throw new Error('Contract code exceeds 16384 bytes.');
        return code;
    }
}
export function contractProgram() {
    return new ContractProgramBuilder();
}
export function contractBody() {
    return new ContractBodyBuilder();
}
function canonicalName(value) {
    const bytes = encoder.encode(value);
    if (bytes.length === 0 ||
        bytes.length > MAX_NAME_BYTES ||
        !/^[a-z][a-z0-9_]{0,31}$/.test(value)) {
        throw new TypeError('Entrypoint must be a canonical lowercase name.');
    }
    return bytes;
}
function sizedText(value, field, maximum) {
    const bytes = encoder.encode(value);
    if (bytes.length === 0 || bytes.length > maximum) {
        throw new TypeError(`${field} must contain 1–${maximum} UTF-8 bytes.`);
    }
    return concat(Uint8Array.of(bytes.length), bytes);
}
function u16(value, field) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) {
        throw new RangeError(`${field} must fit in an unsigned 16-bit integer.`);
    }
    return Uint8Array.of(value >>> 8, value & 0xff);
}
function unsigned(value, length) {
    if (value < 0n)
        throw new RangeError('Contract values cannot be negative.');
    const output = new Uint8Array(length);
    let remaining = value;
    for (let index = length - 1; index >= 0; index -= 1) {
        output[index] = Number(remaining & 0xffn);
        remaining >>= 8n;
    }
    if (remaining !== 0n)
        throw new RangeError(`Value does not fit in ${length} bytes.`);
    return output;
}
function concat(...parts) {
    const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        output.set(part, offset);
        offset += part.length;
    }
    return output;
}
//# sourceMappingURL=bytecode.js.map