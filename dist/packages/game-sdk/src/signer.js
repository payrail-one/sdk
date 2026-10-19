import { bytesToHex, hexToBytes, R1GameInvariantError } from './validation.js';
export function cryptoKeyGameSigner(privateKey, publicKey) {
    if (privateKey.type !== 'private' ||
        privateKey.algorithm.name !== 'Ed25519' ||
        !privateKey.usages.includes('sign')) {
        throw new R1GameInvariantError('privateKey must be an Ed25519 CryptoKey authorized for signing.');
    }
    if (publicKey.length !== 32) {
        throw new R1GameInvariantError('publicKey must contain exactly 32 bytes.');
    }
    const stablePublicKey = new Uint8Array(publicKey);
    return {
        publicKey: stablePublicKey,
        async sign(signingHash) {
            if (signingHash.length !== 32) {
                throw new R1GameInvariantError('R1 signing hash must contain exactly 32 bytes.');
            }
            const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', privateKey, signingHash));
            if (signature.length !== 64) {
                throw new R1GameInvariantError('Ed25519 signer returned a non-canonical signature.');
            }
            return signature;
        },
    };
}
export function publicKeyHex(signer) {
    if (signer.publicKey.length !== 32) {
        throw new R1GameInvariantError('Game signer public key must contain exactly 32 bytes.');
    }
    return bytesToHex(signer.publicKey);
}
export function assertCanonicalSignature(signature) {
    if (signature.length !== 64) {
        throw new R1GameInvariantError('Game signer must return a 64-byte Ed25519 signature.');
    }
    return bytesToHex(signature);
}
export function signingHashBytes(signingHash) {
    return hexToBytes('signingHash', signingHash, 32);
}
//# sourceMappingURL=signer.js.map