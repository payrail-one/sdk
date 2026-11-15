import { type PayrailWallet, type TransferInput } from '@platform/wallet-core';
export type R1FundingStatus = 'quote_issued' | 'source_prepared' | 'source_finalized' | 'release_prepared' | 'completed';
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
    readonly asset: {
        readonly id: string;
    };
}
export interface R1FundingClientOptions {
    readonly settlementBaseUrl?: string;
    readonly fetcher?: typeof fetch;
}
export declare class R1FundingApiError extends Error {
    readonly status: number;
    constructor(message: string, status: number);
}
export declare class R1FundingInvariantError extends Error {
    constructor(message: string);
}
export declare class R1FundingClient {
    #private;
    constructor(options?: R1FundingClientOptions);
    quote(input: CreateR1FundingQuoteInput): Promise<R1FundingOperation>;
    status(id: string): Promise<R1FundingOperation>;
    submit(quote: R1FundingOperation, payrailEnvelope: Uint8Array): Promise<R1FundingOperation>;
    signAndSubmit(quote: R1FundingOperation, wallet: PayrailWallet, account: R1FundingAccount, network: R1FundingNetwork): Promise<R1FundingOperation>;
}
export declare function fundingTransferInput(quote: R1FundingOperation, account: R1FundingAccount, network: R1FundingNetwork): TransferInput;
