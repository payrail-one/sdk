export interface NetworkAsset {
    readonly id: string;
    readonly symbol: string;
    readonly decimals: number;
}
export interface NetworkStatus {
    readonly networkId: string;
    readonly addressPrefix: string;
    readonly finalizedHeight: string;
    readonly finalityMode: 'single-node-devnet' | 'bft-devnet';
    readonly asset: NetworkAsset;
}
export interface AccountState {
    readonly address: string;
    readonly accountId: string;
    readonly nonce: string;
    readonly balance: string;
    readonly finalizedHeight: string;
}
export interface FinalizedTransaction {
    readonly id: string;
    readonly blockHeight: string;
    readonly operationIndex: string;
    readonly from: string;
    readonly to: string;
    readonly amount: string;
    readonly fee: string;
    readonly outcome: 'applied' | 'expired';
}
export interface FinalizedBlock {
    readonly height: string;
    readonly hash: string;
    readonly stateRoot: string;
    readonly transactionCount: number;
}
export interface ExplorerOverview {
    readonly status: NetworkStatus;
    readonly blocks: readonly FinalizedBlock[];
    readonly transactions: readonly FinalizedTransaction[];
}
export interface SubmissionResult {
    readonly transaction: FinalizedTransaction;
    readonly checkpoint: FinalizedBlock;
}
export interface Checkout {
    readonly id: string;
    readonly merchantLabel: string;
    readonly merchantAddress: string;
    readonly amount: string;
    readonly fee: string;
    readonly asset: NetworkAsset;
    readonly status: 'open' | 'processing' | 'finalized' | 'expired';
    readonly expiresAtMs: string;
    readonly validUntilHeight: string;
    readonly paymentPath: string;
    readonly smsText: string;
    readonly transaction: FinalizedTransaction | null;
}
export interface CreateCheckoutRequest {
    readonly merchantAddress: string;
    readonly amount: string;
    readonly orderReference: string;
}
export interface IssueApprovalCodeRequest {
    readonly accountAddress: string;
    readonly deviceId: string;
    readonly issuedAtMs: string;
    readonly nonce: string;
    readonly signature: string;
}
export interface IssuedApprovalCode {
    readonly code: string;
    readonly sessionToken: string;
    readonly expiresAtMs: string;
}
export interface ApprovalCodeChallenge {
    readonly status: 'waiting' | 'claimed' | 'finalized';
    readonly checkout: Checkout | null;
}
export interface ApprovalCodeClaim {
    readonly status: 'claimed';
    readonly checkoutId: string;
}
export declare class PlatformApiError extends Error {
    readonly status: number;
    constructor(message: string, status: number);
}
export declare class PlatformApiClient {
    #private;
    constructor(baseUrl: string, fetcher?: typeof fetch);
    status(): Promise<NetworkStatus>;
    account(address: string): Promise<AccountState>;
    overview(): Promise<ExplorerOverview>;
    faucet(address: string): Promise<SubmissionResult>;
    submit(envelope: Uint8Array): Promise<SubmissionResult>;
    createCheckout(request: CreateCheckoutRequest): Promise<Checkout>;
    checkout(id: string): Promise<Checkout>;
    issueApprovalCode(request: IssueApprovalCodeRequest): Promise<IssuedApprovalCode>;
    approvalCodeChallenge(sessionToken: string): Promise<ApprovalCodeChallenge>;
    claimApprovalCode(checkoutId: string, code: string, merchantToken: string): Promise<ApprovalCodeClaim>;
    submitCheckout(id: string, envelope: Uint8Array): Promise<Checkout>;
}
export declare function toHex(bytes: Uint8Array): string;
export declare function fromHex(value: string, expectedBytes?: number): Uint8Array;
