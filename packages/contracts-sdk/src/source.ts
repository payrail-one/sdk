import {
  contractBody,
  contractProgram,
  type ContractBodyBuilder,
} from './bytecode';

const COMMENT = /\s*(?:#.*)?$/;

/** Compiles the bounded, deterministic Payrail Contract Language v1. */
export function compileContractSource(source: string): Uint8Array<ArrayBuffer> {
  if (new TextEncoder().encode(source).length > 64 * 1024) {
    throw new Error('Contract source exceeds 65536 bytes.');
  }
  const program = contractProgram();
  let entrypoint: string | null = null;
  let body: ContractBodyBuilder | null = null;
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index]?.replace(COMMENT, '').trim() ?? '';
    if (line.length === 0 || line === 'payrail 1') continue;
    const [instruction, ...operands] = line.split(/\s+/);
    if (instruction === 'entry') {
      if (body || operands.length !== 1)
        fail(lineNumber, 'invalid entry declaration');
      entrypoint = operands[0] ?? null;
      body = contractBody();
      continue;
    }
    if (instruction === 'end') {
      if (!body || !entrypoint || operands.length !== 0)
        fail(lineNumber, 'unexpected end');
      body.halt();
      program.entrypoint(entrypoint, body);
      entrypoint = null;
      body = null;
      continue;
    }
    if (!body) fail(lineNumber, 'instruction must be inside an entry block');
    try {
      compileInstruction(body, instruction ?? '', operands);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'invalid instruction';
      fail(lineNumber, message);
    }
  }
  if (body || entrypoint) fail(lines.length, 'entry block is missing end');
  return program.build();
}

function compileInstruction(
  body: ContractBodyBuilder,
  instruction: string,
  operands: readonly string[],
): void {
  switch (instruction) {
    case 'const':
      body.constant(bigintOperand(operands, instruction));
      break;
    case 'arg_u128':
      body.argumentU128(numberOperand(operands, instruction));
      break;
    case 'state':
      body.state(textOperand(operands, instruction));
      break;
    case 'attached_amount':
      noOperands(operands, instruction);
      body.attachedAmount();
      break;
    case 'add':
      noOperands(operands, instruction);
      body.add();
      break;
    case 'sub':
      noOperands(operands, instruction);
      body.subtract();
      break;
    case 'eq':
      noOperands(operands, instruction);
      body.equals();
      break;
    case 'lte':
      noOperands(operands, instruction);
      body.lessThanOrEqual();
      break;
    case 'gte':
      noOperands(operands, instruction);
      body.greaterThanOrEqual();
      break;
    case 'require':
      body.require(numberOperand(operands, instruction));
      break;
    case 'store':
      body.store(textOperand(operands, instruction));
      break;
    case 'emit':
      body.emit(textOperand(operands, instruction));
      break;
    case 'dup':
      noOperands(operands, instruction);
      body.duplicate();
      break;
    case 'drop':
      noOperands(operands, instruction);
      body.drop();
      break;
    case 'transfer_caller':
      noOperands(operands, instruction);
      body.transferToCaller();
      break;
    case 'transfer_account':
      body.transferToArgumentAccount(numberOperand(operands, instruction));
      break;
    default:
      throw new Error(`unknown instruction: ${instruction}`);
  }
}

function textOperand(operands: readonly string[], instruction: string): string {
  if (operands.length !== 1 || !operands[0]) {
    throw new Error(`${instruction} expects one name`);
  }
  return operands[0];
}

function numberOperand(
  operands: readonly string[],
  instruction: string,
): number {
  const value = textOperand(operands, instruction);
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${instruction} expects an unsigned integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new Error(`${instruction} integer is too large`);
  return parsed;
}

function bigintOperand(
  operands: readonly string[],
  instruction: string,
): bigint {
  const value = textOperand(operands, instruction);
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${instruction} expects an unsigned integer`);
  }
  return BigInt(value);
}

function noOperands(operands: readonly string[], instruction: string): void {
  if (operands.length !== 0)
    throw new Error(`${instruction} takes no operands`);
}

function fail(line: number, message: string): never {
  throw new SyntaxError(`Line ${line}: ${message}.`);
}
