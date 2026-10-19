import type { GameSigner } from './types.js';
export declare function cryptoKeyGameSigner(privateKey: CryptoKey, publicKey: Uint8Array<ArrayBuffer>): GameSigner;
export declare function publicKeyHex(signer: GameSigner): string;
export declare function assertCanonicalSignature(signature: Uint8Array): string;
export declare function signingHashBytes(signingHash: string): Uint8Array<ArrayBuffer>;
