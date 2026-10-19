import { type FinalizedGameRandomness, type GameProtocolCapabilities, type GameSigner, type GameTransactionIntent, type GameTransactionStatus, type PreparedGameTransaction, type R1GameClientOptions, type SubmittedGameTransaction, type UnsignedGameTransactionIntent, type WaitForGameFinalizationOptions } from './types.js';
export declare class R1GameClient {
    #private;
    constructor(options?: R1GameClientOptions);
    protocol(signal?: AbortSignal): Promise<GameProtocolCapabilities>;
    openApi(signal?: AbortSignal): Promise<Record<string, unknown>>;
    prepare(intent: GameTransactionIntent, signal?: AbortSignal): Promise<PreparedGameTransaction>;
    submit(intent: GameTransactionIntent, signature: Uint8Array | string, signal?: AbortSignal): Promise<SubmittedGameTransaction>;
    signAndSubmit(intent: UnsignedGameTransactionIntent, signer: GameSigner, signal?: AbortSignal): Promise<SubmittedGameTransaction>;
    transactionStatus(transactionHash: string, signal?: AbortSignal): Promise<GameTransactionStatus>;
    randomness(height: number, signal?: AbortSignal): Promise<FinalizedGameRandomness>;
    waitForFinalization(transactionHash: string, options?: WaitForGameFinalizationOptions): Promise<GameTransactionStatus>;
}
export declare class R1GameApiError extends Error {
    readonly status: number;
    readonly code?: string | undefined;
    constructor(message: string, status: number, code?: string | undefined);
}
export declare class R1GameTimeoutError extends Error {
    readonly transactionHash: string;
    readonly timeoutMs: number;
    constructor(transactionHash: string, timeoutMs: number);
}
