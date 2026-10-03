const MAGIC = Uint8Array.of(0x50, 0x52, 0x43, 0x31);
const MAX_ENTRYPOINTS = 16;
const MAX_NAME_BYTES = 32;
const MAX_KEY_BYTES = 32;
const MAX_BODY_BYTES = 0xffff;
const MAX_CODE_BYTES = 16 * 1024;
const encoder = new TextEncoder();

export class ContractBodyBuilder {
  readonly #parts: Uint8Array[] = [];
  #halted = false;

  constant(value: bigint): this {
    return this.instruction(0x01, unsigned(value, 16));
  }

  argumentU128(offset: number): this {
    return this.instruction(0x02, u16(offset, 'argument offset'));
  }

  state(key: string): this {
    return this.instruction(0x03, sizedText(key, 'state key', MAX_KEY_BYTES));
  }

  attachedAmount(): this {
    return this.instruction(0x04);
  }

  add(): this {
    return this.instruction(0x05);
  }

  subtract(): this {
    return this.instruction(0x06);
  }

  equals(): this {
    return this.instruction(0x07);
  }

  lessThanOrEqual(): this {
    return this.instruction(0x08);
  }

  greaterThanOrEqual(): this {
    return this.instruction(0x09);
  }

  require(reason: number): this {
    return this.instruction(0x0a, u16(reason, 'rejection reason'));
  }

  store(key: string): this {
    return this.instruction(0x0b, sizedText(key, 'state key', MAX_KEY_BYTES));
  }

  emit(topic: string): this {
    return this.instruction(
      0x0c,
      sizedText(topic, 'event topic', MAX_KEY_BYTES),
    );
  }

  duplicate(): this {
    return this.instruction(0x0d);
  }

  drop(): this {
    return this.instruction(0x0e);
  }

  transferToCaller(): this {
    return this.instruction(0x0f);
  }

  transferToArgumentAccount(offset: number): this {
    return this.instruction(0x10, u16(offset, 'account argument offset'));
  }

  halt(): this {
    this.instruction(0x00);
    this.#halted = true;
    return this;
  }

  build(): Uint8Array<ArrayBuffer> {
    if (!this.#halted)
      throw new Error('Contract entrypoint must end with halt().');
    return concat(...this.#parts);
  }

  private instruction(opcode: number, operand?: Uint8Array): this {
    if (this.#halted)
      throw new Error('Cannot append instructions after halt().');
    this.#parts.push(Uint8Array.of(opcode));
    if (operand) this.#parts.push(operand);
    return this;
  }
}

export class ContractProgramBuilder {
  readonly #entries = new Map<string, Uint8Array>();

  entrypoint(name: string, body: ContractBodyBuilder): this {
    const encodedName = canonicalName(name);
    if (this.#entries.has(name))
      throw new Error(`Duplicate entrypoint: ${name}.`);
    if (this.#entries.size >= MAX_ENTRYPOINTS) {
      throw new Error(
        `A contract supports at most ${MAX_ENTRYPOINTS} entrypoints.`,
      );
    }
    const bytes = body.build();
    if (bytes.length > MAX_BODY_BYTES)
      throw new Error('Entrypoint body is too large.');
    this.#entries.set(new TextDecoder().decode(encodedName), bytes);
    return this;
  }

  build(): Uint8Array<ArrayBuffer> {
    if (this.#entries.size === 0)
      throw new Error('Contract has no entrypoints.');
    const entries: Uint8Array[] = [];
    for (const [name, body] of this.#entries) {
      const encodedName = encoder.encode(name);
      entries.push(
        Uint8Array.of(encodedName.length),
        encodedName,
        u16(body.length, 'entrypoint body length'),
        body,
      );
    }
    const code = concat(MAGIC, Uint8Array.of(this.#entries.size), ...entries);
    if (code.length > MAX_CODE_BYTES)
      throw new Error('Contract code exceeds 16384 bytes.');
    return code;
  }
}

export function contractProgram(): ContractProgramBuilder {
  return new ContractProgramBuilder();
}

export function contractBody(): ContractBodyBuilder {
  return new ContractBodyBuilder();
}

function canonicalName(value: string): Uint8Array<ArrayBuffer> {
  const bytes = encoder.encode(value);
  if (
    bytes.length === 0 ||
    bytes.length > MAX_NAME_BYTES ||
    !/^[a-z][a-z0-9_]{0,31}$/.test(value)
  ) {
    throw new TypeError('Entrypoint must be a canonical lowercase name.');
  }
  return bytes;
}

function sizedText(
  value: string,
  field: string,
  maximum: number,
): Uint8Array<ArrayBuffer> {
  const bytes = encoder.encode(value);
  if (bytes.length === 0 || bytes.length > maximum) {
    throw new TypeError(`${field} must contain 1–${maximum} UTF-8 bytes.`);
  }
  return concat(Uint8Array.of(bytes.length), bytes);
}

function u16(value: number, field: string): Uint8Array<ArrayBuffer> {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError(`${field} must fit in an unsigned 16-bit integer.`);
  }
  return Uint8Array.of(value >>> 8, value & 0xff);
}

function unsigned(value: bigint, length: number): Uint8Array<ArrayBuffer> {
  if (value < 0n) throw new RangeError('Contract values cannot be negative.');
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

function concat(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
