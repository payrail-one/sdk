import { type ApprovalCodeChallenge, type ApprovalCodeClaim, type Checkout, type IssuedApprovalCode } from '../../api-client/src/index.js';
import type { ApprovalCodeIssueInput, PayrailWallet } from '../../wallet-core/src/index.js';
export interface PayrailCodeClientOptions {
    readonly apiBaseUrl: string;
    readonly fetcher?: typeof fetch;
}
export interface IssuePayrailCodeInput extends ApprovalCodeIssueInput {
    readonly wallet: Pick<PayrailWallet, 'createApprovalCodeIssue'>;
}
export interface WaitForChallengeOptions {
    readonly intervalMs?: number;
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
    readonly onUpdate?: (challenge: ApprovalCodeChallenge) => void;
}
export declare class PayrailCodeWalletClient {
    #private;
    constructor(options: PayrailCodeClientOptions);
    issue(input: IssuePayrailCodeInput): Promise<IssuedApprovalCode>;
    challenge(sessionToken: string): Promise<ApprovalCodeChallenge>;
    waitForChallenge(sessionToken: string, options?: WaitForChallengeOptions): Promise<ApprovalCodeChallenge>;
}
export interface PayrailCodeMerchantOptions extends PayrailCodeClientOptions {
    readonly merchantToken: string;
}
export declare class PayrailCodeMerchantClient {
    #private;
    constructor(options: PayrailCodeMerchantOptions);
    claim(checkoutId: string, code: string): Promise<ApprovalCodeClaim>;
}
export interface SmsComposerInput {
    readonly body: string;
    readonly recipient?: string;
}
export declare function checkoutSmsMessage(checkout: Checkout, walletOrigin?: string): string;
export declare function smsComposerUrl(input: SmsComposerInput): string;
export declare function createPayrailDeviceId(): Uint8Array<ArrayBuffer>;
export declare class PayrailCodeInvariantError extends Error {
    constructor(message: string);
}
export declare class PayrailCodeTimeoutError extends Error {
    constructor();
}
