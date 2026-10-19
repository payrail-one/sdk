import {
  R1_GAME_API_VERSION,
  R1_GAME_CONTRACT_ENTRYPOINT,
  type FinalizedGameRandomness,
  type GameProtocolCapabilities,
  type GameSigner,
  type GameTransactionIntent,
  type GameTransactionStatus,
  type PreparedGameTransaction,
  type R1GameClientOptions,
  type SubmittedGameTransaction,
  type UnsignedGameTransactionIntent,
  type WaitForGameFinalizationOptions,
  type WireGameTransactionIntent,
} from './types.js';
import {
  assertCanonicalSignature,
  publicKeyHex,
  signingHashBytes,
} from './signer.js';
import {
  canonicalHex,
  fromWireIntent,
  intentsEqual,
  R1GameInvariantError,
  validateGameIntent,
} from './validation.js';

const DEFAULT_BASE_URL = 'https://r1.verita.tech';
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 60_000;

export class R1GameClient {
  readonly #baseUrl: string;
  readonly #apiKey?: string;
  readonly #fetcher: typeof fetch;

  constructor(options: R1GameClientOptions = {}) {
    this.#baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    if (options.apiKey !== undefined && options.apiKey.trim().length === 0) {
      throw new R1GameInvariantError('apiKey must not be empty.');
    }
    this.#apiKey = options.apiKey;
    this.#fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  }

  async protocol(signal?: AbortSignal): Promise<GameProtocolCapabilities> {
    return parseProtocol(
      await this.#request('/v1/games', { method: 'GET', signal }),
    );
  }

  async openApi(signal?: AbortSignal): Promise<Record<string, unknown>> {
    const value = await this.#request('/v1/games/openapi.json', {
      method: 'GET',
      signal,
    });
    if (!isRecord(value) || value.openapi !== '3.0.3') {
      throw new R1GameInvariantError(
        'R1 Game API returned an invalid OpenAPI document.',
      );
    }
    return value;
  }

  async prepare(
    intent: GameTransactionIntent,
    signal?: AbortSignal,
  ): Promise<PreparedGameTransaction> {
    const expected = validateGameIntent(intent);
    const value = await this.#request('/v1/games/prepare', {
      method: 'POST',
      signal,
      body: JSON.stringify(expected),
    });
    return parsePrepared(value, expected);
  }

  async submit(
    intent: GameTransactionIntent,
    signature: Uint8Array | string,
    signal?: AbortSignal,
  ): Promise<SubmittedGameTransaction> {
    const wireIntent = validateGameIntent(intent);
    const signatureHex =
      typeof signature === 'string'
        ? canonicalHex('signature', signature, 64)
        : assertCanonicalSignature(signature);
    return parseSubmitted(
      await this.#request('/v1/games/submit', {
        method: 'POST',
        signal,
        body: JSON.stringify({ intent: wireIntent, signature: signatureHex }),
      }),
    );
  }

  async signAndSubmit(
    intent: UnsignedGameTransactionIntent,
    signer: GameSigner,
    signal?: AbortSignal,
  ): Promise<SubmittedGameTransaction> {
    const signedIntent: GameTransactionIntent = {
      ...intent,
      publicKeyHex: publicKeyHex(signer),
    };
    const prepared = await this.prepare(signedIntent, signal);
    const signature = await signer.sign(signingHashBytes(prepared.signingHash));
    const submitted = await this.submit(signedIntent, signature, signal);
    if (submitted.operationCommitment !== prepared.operationCommitment) {
      throw new R1GameInvariantError(
        'R1 Game API changed the operation between prepare and submit.',
      );
    }
    return submitted;
  }

  async transactionStatus(
    transactionHash: string,
    signal?: AbortSignal,
  ): Promise<GameTransactionStatus> {
    const hash = canonicalHex('transactionHash', transactionHash, 32);
    return parseTransactionStatus(
      await this.#request(`/v1/games/transactions/${hash}`, {
        method: 'GET',
        signal,
      }),
      hash,
    );
  }

  async randomness(
    height: number,
    signal?: AbortSignal,
  ): Promise<FinalizedGameRandomness> {
    assertSafeHeight(height);
    return parseRandomness(
      await this.#request(`/v1/games/randomness/${height}`, {
        method: 'GET',
        signal,
      }),
      height,
    );
  }

  async waitForFinalization(
    transactionHash: string,
    options: WaitForGameFinalizationOptions = {},
  ): Promise<GameTransactionStatus> {
    const intervalMs = positiveDelay(
      'intervalMs',
      options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    );
    const timeoutMs = positiveDelay(
      'timeoutMs',
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    const startedAt = Date.now();
    for (;;) {
      options.signal?.throwIfAborted();
      const status = await this.transactionStatus(
        transactionHash,
        options.signal,
      );
      options.onUpdate?.(status);
      if (status.finalized || status.status === 'failed') {
        return status;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        throw new R1GameTimeoutError(transactionHash, timeoutMs);
      }
      await delay(intervalMs, options.signal);
    }
  }

  async #request(path: string, init: RequestInit): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    if (init.body !== undefined) {
      headers.set('content-type', 'application/json');
    }
    if (this.#apiKey !== undefined) {
      headers.set('x-api-key', this.#apiKey);
    }
    const response = await this.#fetcher(`${this.#baseUrl}${path}`, {
      ...init,
      headers,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = isRecord(body) ? body : {};
      throw new R1GameApiError(
        stringValue(error, 'error') ?? response.statusText ?? 'Request failed.',
        response.status,
        stringValue(error, 'code'),
      );
    }
    if (body === null) {
      throw new R1GameInvariantError(
        'R1 Game API returned a non-JSON response.',
      );
    }
    return body;
  }
}

export class R1GameApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'R1GameApiError';
  }
}

export class R1GameTimeoutError extends Error {
  constructor(
    readonly transactionHash: string,
    readonly timeoutMs: number,
  ) {
    super(
      `R1 transaction ${transactionHash} was not finalized in ${timeoutMs}ms.`,
    );
    this.name = 'R1GameTimeoutError';
  }
}

function parsePrepared(
  value: unknown,
  expected: WireGameTransactionIntent,
): PreparedGameTransaction {
  const record = recordValue(value, 'prepared transaction');
  assertApiVersion(record);
  const actual = parseWireIntent(record.intent);
  if (!intentsEqual(expected, actual)) {
    throw new R1GameInvariantError(
      'R1 Game API changed the transaction intent during preparation.',
    );
  }
  const receiver = hexValue(record, 'receiver', 40);
  if (receiver !== expected.contract_address) {
    throw new R1GameInvariantError(
      'Prepared transaction receiver does not match the requested contract.',
    );
  }
  if (
    record.tx_type !== 'contract_call' ||
    record.function !== R1_GAME_CONTRACT_ENTRYPOINT
  ) {
    throw new R1GameInvariantError(
      'Prepared transaction is not an R1 game contract call.',
    );
  }
  return {
    apiVersion: R1_GAME_API_VERSION,
    intent: fromWireIntent(actual),
    sender: hexValue(record, 'sender', 40),
    receiver,
    chainId: integerValue(record, 'chain_id', 0, 65_535),
    transactionType: 'contract_call',
    function: R1_GAME_CONTRACT_ENTRYPOINT,
    dataHex: hexValue(record, 'data'),
    signingHash: hexValue(record, 'signing_hash', 32),
    operationCommitment: hexValue(record, 'operation_commitment', 32),
  };
}

function parseSubmitted(value: unknown): SubmittedGameTransaction {
  const record = recordValue(value, 'submitted transaction');
  assertApiVersion(record);
  if (record.status !== 'admitted') {
    throw new R1GameInvariantError(
      'R1 Game API did not acknowledge transaction admission.',
    );
  }
  return {
    apiVersion: R1_GAME_API_VERSION,
    transactionHash: hexValue(record, 'tx_hash', 32),
    operationCommitment: hexValue(record, 'operation_commitment', 32),
    status: 'admitted',
    statusUrl: requiredString(record, 'status_url'),
  };
}

function parseTransactionStatus(
  value: unknown,
  expectedHash: string,
): GameTransactionStatus {
  const record = recordValue(value, 'transaction status');
  assertApiVersion(record);
  const transactionHash = hexValue(record, 'tx_hash', 32);
  if (transactionHash !== expectedHash) {
    throw new R1GameInvariantError(
      'R1 Game API returned status for another transaction.',
    );
  }
  const status = requiredString(record, 'status');
  if (
    !['missing', 'included', 'executed', 'finalized', 'failed'].includes(status)
  ) {
    throw new R1GameInvariantError('R1 Game API returned an unknown status.');
  }
  if (typeof record.finalized !== 'boolean') {
    throw new R1GameInvariantError('Transaction finality flag is invalid.');
  }
  const result: GameTransactionStatus = {
    apiVersion: R1_GAME_API_VERSION,
    transactionHash,
    status: status as GameTransactionStatus['status'],
    finalized: record.finalized,
  };
  return {
    ...result,
    ...(optionalExecution(record.execution) === undefined
      ? {}
      : { execution: optionalExecution(record.execution) }),
    ...(record.error === undefined
      ? {}
      : { error: nullableString(record.error) }),
    ...(record.block_height === undefined
      ? {}
      : { blockHeight: integerUnknown(record.block_height, 'block_height') }),
    ...(record.block_hash === undefined
      ? {}
      : {
          blockHash: canonicalHex(
            'block_hash',
            requiredString(record, 'block_hash'),
            32,
          ),
        }),
    ...(record.inclusion_proof_url === undefined ||
    record.inclusion_proof_url === null
      ? {}
      : { inclusionProofUrl: requiredString(record, 'inclusion_proof_url') }),
    ...(record.execution_proof_url === undefined ||
    record.execution_proof_url === null
      ? {}
      : { executionProofUrl: requiredString(record, 'execution_proof_url') }),
  };
}

function parseRandomness(
  value: unknown,
  expectedHeight: number,
): FinalizedGameRandomness {
  const record = recordValue(value, 'finalized randomness');
  assertApiVersion(record);
  const height = integerValue(record, 'height', 0, Number.MAX_SAFE_INTEGER);
  if (height !== expectedHeight || record.finalized !== true) {
    throw new R1GameInvariantError(
      'R1 Game API returned randomness for an unexpected or unfinalized block.',
    );
  }
  if (record.domain !== 'r1-game-finalized-randomness-v1') {
    throw new R1GameInvariantError('R1 randomness domain is invalid.');
  }
  return {
    apiVersion: R1_GAME_API_VERSION,
    height,
    blockHash: hexValue(record, 'block_hash', 32),
    randomness: hexValue(record, 'randomness', 32),
    domain: 'r1-game-finalized-randomness-v1',
    finalized: true,
    finalityProofUrl: requiredString(record, 'finality_proof_url'),
    usage: requiredString(record, 'usage'),
  };
}

function parseProtocol(value: unknown): GameProtocolCapabilities {
  const record = recordValue(value, 'protocol capabilities');
  assertApiVersion(record);
  if (record.contract_entrypoint !== R1_GAME_CONTRACT_ENTRYPOINT) {
    throw new R1GameInvariantError('R1 game contract entrypoint is invalid.');
  }
  const limits = recordValue(record.limits, 'protocol limits');
  const endpoints = recordValue(record.endpoints, 'protocol endpoints');
  if (!Array.isArray(record.legacy_adapters)) {
    throw new R1GameInvariantError('Legacy adapter list is invalid.');
  }
  return {
    apiVersion: R1_GAME_API_VERSION,
    chainId: integerValue(record, 'chain_id', 0, 65_535),
    contractEntrypoint: R1_GAME_CONTRACT_ENTRYPOINT,
    moneyEncoding: requiredString(record, 'money_encoding'),
    signing: requiredString(record, 'signing'),
    settlement: requiredString(record, 'settlement'),
    randomness: requiredString(record, 'randomness'),
    limits: {
      payloadBytes: integerValue(
        limits,
        'payload_bytes',
        1,
        Number.MAX_SAFE_INTEGER,
      ),
      gasLimit: integerValue(limits, 'gas_limit', 1, Number.MAX_SAFE_INTEGER),
      expiryBlocks: integerValue(
        limits,
        'expiry_blocks',
        1,
        Number.MAX_SAFE_INTEGER,
      ),
    },
    endpoints: {
      prepare: requiredString(endpoints, 'prepare'),
      submit: requiredString(endpoints, 'submit'),
      transactionStatus: requiredString(endpoints, 'transaction_status'),
      randomness: requiredString(endpoints, 'randomness'),
      openApi: requiredString(endpoints, 'openapi'),
    },
    legacyAdapters: record.legacy_adapters.map((entry) => {
      const adapter = recordValue(entry, 'legacy adapter');
      return {
        id: requiredString(adapter, 'id'),
        state: requiredString(adapter, 'state'),
      };
    }),
  };
}

function parseWireIntent(value: unknown): WireGameTransactionIntent {
  const record = recordValue(value, 'transaction intent');
  const operation = recordValue(record.operation, 'game operation');
  return validateGameIntent({
    operation: {
      gameId: requiredString(operation, 'game_id'),
      roundId: requiredString(operation, 'round_id'),
      operationId: requiredString(operation, 'operation_id'),
      action: requiredString(operation, 'action'),
      payloadHex: requiredString(operation, 'payload_hex'),
    },
    contractAddress: requiredString(record, 'contract_address'),
    amountAtomic: requiredString(record, 'amount'),
    feeAtomic: requiredString(record, 'fee'),
    nonce: integerValue(record, 'nonce', 0, Number.MAX_SAFE_INTEGER),
    timestamp: integerValue(record, 'timestamp', 1, Number.MAX_SAFE_INTEGER),
    expiresAt: integerValue(record, 'expires_at', 1, Number.MAX_SAFE_INTEGER),
    publicKeyHex: requiredString(record, 'public_key'),
    gasLimit: integerValue(record, 'gas_limit', 1, Number.MAX_SAFE_INTEGER),
  });
}

function assertApiVersion(record: Record<string, unknown>): void {
  if (record.api_version !== R1_GAME_API_VERSION) {
    throw new R1GameInvariantError('Unsupported R1 Game API version.');
  }
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new R1GameInvariantError('baseUrl must be an absolute HTTP(S) URL.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new R1GameInvariantError(
      'baseUrl must be an HTTP(S) URL without embedded credentials.',
    );
  }
  return value.replace(/\/+$/, '');
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new R1GameInvariantError(`R1 Game API ${label} is invalid.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(
  record: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = record[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function requiredString(
  record: Record<string, unknown>,
  field: string,
): string {
  const value = stringValue(record, field);
  if (value === undefined) {
    throw new R1GameInvariantError(`R1 Game API field ${field} is invalid.`);
  }
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null || typeof value === 'string') {
    return value;
  }
  throw new R1GameInvariantError('R1 Game API error detail is invalid.');
}

function hexValue(
  record: Record<string, unknown>,
  field: string,
  expectedBytes?: number,
): string {
  return canonicalHex(field, requiredString(record, field), expectedBytes);
}

function integerValue(
  record: Record<string, unknown>,
  field: string,
  minimum: number,
  maximum: number,
): number {
  const value = integerUnknown(record[field], field);
  if (value < minimum || value > maximum) {
    throw new R1GameInvariantError(
      `R1 Game API field ${field} is out of range.`,
    );
  }
  return value;
}

function integerUnknown(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new R1GameInvariantError(`R1 Game API field ${field} is invalid.`);
  }
  return value;
}

function optionalExecution(
  value: unknown,
): GameTransactionStatus['execution'] | undefined {
  if (value === undefined) return undefined;
  if (
    value === 'successful' ||
    value === 'failed' ||
    value === 'indeterminate' ||
    value === 'pending'
  ) {
    return value;
  }
  throw new R1GameInvariantError('R1 Game API execution status is invalid.');
}

function assertSafeHeight(height: number): void {
  if (!Number.isSafeInteger(height) || height < 0) {
    throw new R1GameInvariantError(
      'height must be a non-negative safe integer.',
    );
  }
}

function positiveDelay(field: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new R1GameInvariantError(`${field} must be a positive safe integer.`);
  }
  return value;
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    if (signal?.aborted === true) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
