import { fromHex, toHex } from '@platform/api-client';
import {
  accountIdFromAddress,
  type PayrailWallet,
  type TransferInput,
} from '@platform/wallet-core';

const DEFAULT_SETTLEMENT_URL = 'https://r1.verita.tech/api/payrail/settlement';

export type R1FundingStatus =
  | 'quote_issued'
  | 'source_prepared'
  | 'source_finalized'
  | 'release_prepared'
  | 'completed';

export interface R1FundingOperation {
  readonly id: string;
  readonly status: R1FundingStatus;
  readonly payrailNetworkId: string;
  readonly sourceAssetId: string;
  readonly inputAmount: string;
  readonly feeAmount: string;
  readonly outputR1Amount: string;
  readonly createdAtHeight: string;
  readonly expiresAtHeight: string;
  readonly payrailLiquidityAccount: string;
  readonly payrailTransactionId: string | null;
  readonly payrailBlockHeight: string | null;
  readonly r1Destination: string;
  readonly r1TransactionHash: string | null;
  readonly r1BlockHeight: string | null;
}

export interface CreateR1FundingQuoteInput {
  readonly inputAmountAtomic: string;
  readonly r1Destination: string;
}

export interface R1FundingAccount {
  readonly address: string;
  readonly nonce: string;
  readonly balance: string;
}

export interface R1FundingNetwork {
  readonly networkId: string;
  readonly addressPrefix: string;
  readonly finalizedHeight: string;
  readonly asset: { readonly id: string };
}

export interface R1FundingClientOptions {
  readonly settlementBaseUrl?: string;
  readonly fetcher?: typeof fetch;
}

export class R1FundingApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'R1FundingApiError';
  }
}

export class R1FundingInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'R1FundingInvariantError';
  }
}

export class R1FundingClient {
  readonly #baseUrl: string;
  readonly #fetcher: typeof fetch;

  constructor(options: R1FundingClientOptions = {}) {
    this.#baseUrl = (
      options.settlementBaseUrl ?? DEFAULT_SETTLEMENT_URL
    ).replace(/\/$/, '');
    this.#fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  }

  async quote(input: CreateR1FundingQuoteInput): Promise<R1FundingOperation> {
    const inputAmount = canonicalUnsigned(
      input.inputAmountAtomic,
      'input amount',
    );
    const r1Destination = canonicalHex(
      input.r1Destination,
      40,
      'R1 destination',
    );
    const quote = await this.#request<R1FundingOperation>('/funding-quotes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputAmount, r1Destination }),
    });
    const validated = validateOperation(quote);
    if (
      validated.inputAmount !== inputAmount ||
      validated.r1Destination !== r1Destination
    ) {
      throw new R1FundingInvariantError(
        'Funding quote does not match the requested amount and R1 destination.',
      );
    }
    if (validated.status !== 'quote_issued') {
      throw new R1FundingInvariantError(
        'Funding quote is not open for payment.',
      );
    }
    return validated;
  }

  status(id: string): Promise<R1FundingOperation> {
    const quoteId = canonicalHex(id, 32, 'funding quote ID');
    return this.#request<R1FundingOperation>(
      `/fundings/${encodeURIComponent(quoteId)}`,
    ).then(validateOperation);
  }

  async submit(
    quote: R1FundingOperation,
    payrailEnvelope: Uint8Array,
  ): Promise<R1FundingOperation> {
    const validated = validateOperation(quote);
    if (payrailEnvelope.length === 0) {
      throw new R1FundingInvariantError('Funding envelope is empty.');
    }
    const operation = await this.#request<R1FundingOperation>('/fundings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        quoteId: validated.id,
        payrailEnvelope: toHex(payrailEnvelope),
      }),
    });
    const result = validateOperation(operation);
    assertSameQuote(validated, result);
    return result;
  }

  async signAndSubmit(
    quote: R1FundingOperation,
    wallet: PayrailWallet,
    account: R1FundingAccount,
    network: R1FundingNetwork,
  ): Promise<R1FundingOperation> {
    if (wallet.address !== account.address) {
      throw new R1FundingInvariantError(
        'Funding account does not belong to the active wallet.',
      );
    }
    const envelope = await wallet.signTransfer(
      fundingTransferInput(quote, account, network),
    );
    return this.submit(quote, envelope);
  }

  async #request<Value>(path: string, init?: RequestInit): Promise<Value> {
    const response = await this.#fetcher(`${this.#baseUrl}${path}`, init);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: unknown;
      } | null;
      const message =
        typeof body?.error === 'string' ? body.error : response.statusText;
      throw new R1FundingApiError(
        message || 'R1 funding request failed.',
        response.status,
      );
    }
    return (await response.json()) as Value;
  }
}

export function fundingTransferInput(
  quote: R1FundingOperation,
  account: R1FundingAccount,
  network: R1FundingNetwork,
): TransferInput {
  const validated = validateOperation(quote);
  const networkId = canonicalHex(network.networkId, 32, 'Payrail network ID');
  const sourceAssetId = canonicalHex(
    network.asset.id,
    32,
    'Payrail source asset ID',
  );
  if (validated.payrailNetworkId !== networkId) {
    throw new R1FundingInvariantError(
      'Funding quote belongs to another Payrail network.',
    );
  }
  if (validated.sourceAssetId !== sourceAssetId) {
    throw new R1FundingInvariantError(
      'Funding quote requires another Payrail asset.',
    );
  }
  const finalizedHeight = unsignedBigInt(
    network.finalizedHeight,
    'Payrail finalized height',
  );
  const expiresAtHeight = unsignedBigInt(
    validated.expiresAtHeight,
    'funding quote expiry',
  );
  if (finalizedHeight > expiresAtHeight) {
    throw new R1FundingInvariantError('Funding quote has expired.');
  }
  const amount = unsignedBigInt(validated.inputAmount, 'funding input amount');
  const balance = unsignedBigInt(account.balance, 'Payrail account balance');
  if (amount > balance) {
    throw new R1FundingInvariantError(
      'Payrail account has insufficient finalized balance.',
    );
  }
  return {
    networkId,
    assetId: sourceAssetId,
    idempotencyKey: fromHex(validated.id, 32),
    recipientAccountId: accountIdFromAddress(
      validated.payrailLiquidityAccount,
      network.addressPrefix,
    ),
    amount,
    fee: 0n,
    nonce: unsignedBigInt(account.nonce, 'Payrail account nonce'),
    validUntilHeight: expiresAtHeight,
  };
}

function validateOperation(value: unknown): R1FundingOperation {
  if (!isRecord(value)) {
    throw new R1FundingInvariantError('Funding response is malformed.');
  }
  const status = stringField(value, 'status');
  if (!isFundingStatus(status)) {
    throw new R1FundingInvariantError('Funding status is unsupported.');
  }
  const operation: R1FundingOperation = {
    id: canonicalHex(stringField(value, 'id'), 32, 'funding quote ID'),
    status,
    payrailNetworkId: canonicalHex(
      stringField(value, 'payrailNetworkId'),
      32,
      'Payrail network ID',
    ),
    sourceAssetId: canonicalHex(
      stringField(value, 'sourceAssetId'),
      32,
      'Payrail source asset ID',
    ),
    inputAmount: canonicalUnsigned(
      stringField(value, 'inputAmount'),
      'funding input amount',
    ),
    feeAmount: canonicalUnsigned(
      stringField(value, 'feeAmount'),
      'funding fee amount',
    ),
    outputR1Amount: canonicalUnsigned(
      stringField(value, 'outputR1Amount'),
      'native R1 output amount',
    ),
    createdAtHeight: canonicalUnsigned(
      stringField(value, 'createdAtHeight'),
      'funding quote height',
    ),
    expiresAtHeight: canonicalUnsigned(
      stringField(value, 'expiresAtHeight'),
      'funding quote expiry',
    ),
    payrailLiquidityAccount: stringField(value, 'payrailLiquidityAccount'),
    payrailTransactionId: optionalString(value, 'payrailTransactionId'),
    payrailBlockHeight: optionalUnsigned(value, 'payrailBlockHeight'),
    r1Destination: canonicalHex(
      stringField(value, 'r1Destination'),
      40,
      'R1 destination',
    ),
    r1TransactionHash: optionalHex(value, 'r1TransactionHash', 32),
    r1BlockHeight: optionalUnsigned(value, 'r1BlockHeight'),
  };
  if (
    unsignedBigInt(operation.inputAmount, 'funding input amount') === 0n ||
    unsignedBigInt(operation.outputR1Amount, 'native R1 output amount') ===
      0n ||
    unsignedBigInt(operation.expiresAtHeight, 'funding quote expiry') <=
      unsignedBigInt(operation.createdAtHeight, 'funding quote height')
  ) {
    throw new R1FundingInvariantError('Funding quote bounds are invalid.');
  }
  return operation;
}

function assertSameQuote(
  expected: R1FundingOperation,
  actual: R1FundingOperation,
): void {
  for (const field of [
    'id',
    'payrailNetworkId',
    'sourceAssetId',
    'inputAmount',
    'feeAmount',
    'outputR1Amount',
    'createdAtHeight',
    'expiresAtHeight',
    'payrailLiquidityAccount',
    'r1Destination',
  ] as const) {
    if (expected[field] !== actual[field]) {
      throw new R1FundingInvariantError(
        `Funding operation changed immutable field ${field}.`,
      );
    }
  }
}

function isFundingStatus(value: string): value is R1FundingStatus {
  return [
    'quote_issued',
    'source_prepared',
    'source_finalized',
    'release_prepared',
    'completed',
  ].includes(value);
}

function canonicalHex(value: string, bytes: number, label: string): string {
  try {
    fromHex(value, bytes);
  } catch {
    throw new R1FundingInvariantError(`${label} is not canonical hexadecimal.`);
  }
  return value;
}

function canonicalUnsigned(value: string, label: string): string {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new R1FundingInvariantError(`${label} is not a canonical integer.`);
  }
  return value;
}

function unsignedBigInt(value: string, label: string): bigint {
  return BigInt(canonicalUnsigned(value, label));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, field: string): string {
  const candidate = value[field];
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new R1FundingInvariantError(
      `Funding response field ${field} is invalid.`,
    );
  }
  return candidate;
}

function optionalString(
  value: Record<string, unknown>,
  field: string,
): string | null {
  const candidate = value[field];
  if (candidate === null) return null;
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new R1FundingInvariantError(
      `Funding response field ${field} is invalid.`,
    );
  }
  return candidate;
}

function optionalUnsigned(
  value: Record<string, unknown>,
  field: string,
): string | null {
  const candidate = optionalString(value, field);
  return candidate === null ? null : canonicalUnsigned(candidate, field);
}

function optionalHex(
  value: Record<string, unknown>,
  field: string,
  bytes: number,
): string | null {
  const candidate = optionalString(value, field);
  return candidate === null ? null : canonicalHex(candidate, bytes, field);
}
