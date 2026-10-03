import { type IssueApprovalCodeRequest } from '../../api-client/src/index.js';
export interface PayrailWallet {
    readonly address: string;
    readonly accountId: string;
    readonly publicKey: Uint8Array<ArrayBuffer>;
    createApprovalCodeIssue(input: ApprovalCodeIssueInput): Promise<IssueApprovalCodeRequest>;
    signTransfer(input: TransferInput): Promise<Uint8Array<ArrayBuffer>>;
}
export type EphemeralWallet = PayrailWallet;
export interface EncryptedWalletVault {
    readonly version: 1;
    readonly address: string;
    readonly publicKey: string;
    readonly salt: string;
    readonly iv: string;
    readonly ciphertext: string;
}
export interface CreatedWalletVault {
    readonly wallet: PayrailWallet;
    readonly vault: EncryptedWalletVault;
}
export declare function parseEncryptedWalletVault(value: unknown): EncryptedWalletVault;
export interface TransferInput {
    readonly networkId: string;
    readonly assetId: string;
    readonly idempotencyKey: Uint8Array;
    readonly recipientAccountId: string;
    readonly amount: bigint;
    readonly fee: bigint;
    readonly nonce: bigint;
    readonly validUntilHeight: bigint;
}
export interface ApprovalCodeIssueInput {
    readonly networkId: string;
    readonly deviceId: Uint8Array;
    readonly issuedAtMs?: number;
}
export declare function createEphemeralWallet(prefix: string): Promise<EphemeralWallet>;
export declare function createEncryptedWallet(prefix: string, password: string): Promise<CreatedWalletVault>;
export declare function unlockEncryptedWallet(prefix: string, password: string, vault: EncryptedWalletVault): Promise<PayrailWallet>;
export declare function accountIdFromAddress(address: string, prefix: string): string;
