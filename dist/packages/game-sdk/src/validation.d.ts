import type { GameOperation, GameTransactionIntent, WireGameOperation, WireGameTransactionIntent } from './types.js';
export declare const DEFAULT_GAME_GAS_LIMIT = 1000000;
export declare const MAX_GAME_GAS_LIMIT = 10000000;
export declare const MAX_GAME_PAYLOAD_BYTES: number;
export declare function validateGameIntent(intent: GameTransactionIntent): WireGameTransactionIntent;
export declare function validateGameOperation(operation: GameOperation): WireGameOperation;
export declare function canonicalAtomicUnits(field: string, value: string): string;
export declare function canonicalHex(field: string, value: string, expectedBytes?: number): string;
export declare function bytesToHex(bytes: Uint8Array): string;
export declare function hexToBytes(field: string, value: string, expectedBytes?: number): Uint8Array<ArrayBuffer>;
export declare function utf8GamePayload(value: string): string;
export declare function createGameOperationId(): string;
export declare function intentsEqual(expected: WireGameTransactionIntent, actual: WireGameTransactionIntent): boolean;
export declare function fromWireIntent(wire: WireGameTransactionIntent): GameTransactionIntent;
export declare class R1GameInvariantError extends Error {
    constructor(message: string);
}
