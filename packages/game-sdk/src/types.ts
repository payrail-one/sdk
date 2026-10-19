export const R1_GAME_API_VERSION = 'r1.game.v1' as const;
export const R1_GAME_CONTRACT_ENTRYPOINT = 'r1_game_v1' as const;

export interface GameOperation {
  readonly gameId: string;
  readonly roundId: string;
  readonly operationId: string;
  readonly action: string;
  readonly payloadHex?: string;
}

export interface GameTransactionIntent {
  readonly operation: GameOperation;
  readonly contractAddress: string;
  readonly amountAtomic: string;
  readonly feeAtomic: string;
  readonly nonce: number;
  readonly timestamp: number;
  readonly expiresAt: number;
  readonly publicKeyHex: string;
  readonly gasLimit?: number;
}

export type UnsignedGameTransactionIntent = Omit<
  GameTransactionIntent,
  'publicKeyHex'
>;

export interface PreparedGameTransaction {
  readonly apiVersion: typeof R1_GAME_API_VERSION;
  readonly intent: GameTransactionIntent;
  readonly sender: string;
  readonly receiver: string;
  readonly chainId: number;
  readonly transactionType: 'contract_call';
  readonly function: typeof R1_GAME_CONTRACT_ENTRYPOINT;
  readonly dataHex: string;
  readonly signingHash: string;
  readonly operationCommitment: string;
}

export interface SubmittedGameTransaction {
  readonly apiVersion: typeof R1_GAME_API_VERSION;
  readonly transactionHash: string;
  readonly operationCommitment: string;
  readonly status: 'admitted';
  readonly statusUrl: string;
}

export type GameExecution =
  | 'successful'
  | 'failed'
  | 'indeterminate'
  | 'pending';

export type GameTransactionState =
  | 'missing'
  | 'included'
  | 'executed'
  | 'finalized'
  | 'failed';

export interface GameTransactionStatus {
  readonly apiVersion: typeof R1_GAME_API_VERSION;
  readonly transactionHash: string;
  readonly status: GameTransactionState;
  readonly finalized: boolean;
  readonly execution?: GameExecution;
  readonly error?: string | null;
  readonly blockHeight?: number;
  readonly blockHash?: string;
  readonly inclusionProofUrl?: string;
  readonly executionProofUrl?: string;
}

export interface FinalizedGameRandomness {
  readonly apiVersion: typeof R1_GAME_API_VERSION;
  readonly height: number;
  readonly blockHash: string;
  readonly randomness: string;
  readonly domain: 'r1-game-finalized-randomness-v1';
  readonly finalized: true;
  readonly finalityProofUrl: string;
  readonly usage: string;
}

export interface GameProtocolLimits {
  readonly payloadBytes: number;
  readonly gasLimit: number;
  readonly expiryBlocks: number;
}

export interface GameProtocolEndpoints {
  readonly prepare: string;
  readonly submit: string;
  readonly transactionStatus: string;
  readonly randomness: string;
  readonly openApi: string;
}

export interface LegacyGameAdapter {
  readonly id: string;
  readonly state: string;
}

export interface GameProtocolCapabilities {
  readonly apiVersion: typeof R1_GAME_API_VERSION;
  readonly chainId: number;
  readonly contractEntrypoint: typeof R1_GAME_CONTRACT_ENTRYPOINT;
  readonly moneyEncoding: string;
  readonly signing: string;
  readonly settlement: string;
  readonly randomness: string;
  readonly limits: GameProtocolLimits;
  readonly endpoints: GameProtocolEndpoints;
  readonly legacyAdapters: readonly LegacyGameAdapter[];
}

export interface GameSigner {
  readonly publicKey: Uint8Array<ArrayBuffer>;
  sign(signingHash: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>>;
}

export interface WaitForGameFinalizationOptions {
  readonly intervalMs?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly onUpdate?: (status: GameTransactionStatus) => void;
}

export interface R1GameClientOptions {
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly fetcher?: typeof fetch;
}

export interface WireGameOperation {
  readonly game_id: string;
  readonly round_id: string;
  readonly operation_id: string;
  readonly action: string;
  readonly payload_hex: string;
}

export interface WireGameTransactionIntent {
  readonly operation: WireGameOperation;
  readonly contract_address: string;
  readonly amount: string;
  readonly fee: string;
  readonly nonce: number;
  readonly timestamp: number;
  readonly expires_at: number;
  readonly public_key: string;
  readonly gas_limit: number;
}
