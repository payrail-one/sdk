export declare const MAX_CONTRACT_CODE_BYTES: number;
export declare const MAX_CONTRACT_ARGS_BYTES: number;
export declare const MAX_CONTRACT_EXECUTION_UNITS = 100000n;
export interface ContractDeployInput {
    readonly networkId: string;
    readonly assetId: string;
    readonly idempotencyKey: Uint8Array;
    readonly salt: Uint8Array;
    readonly code: Uint8Array;
    readonly fee: bigint;
    readonly nonce: bigint;
    readonly validUntilHeight: bigint;
}
export interface ContractCallInput {
    readonly networkId: string;
    readonly assetId: string;
    readonly idempotencyKey: Uint8Array;
    readonly contractId: string;
    readonly entrypoint: string;
    readonly args?: Uint8Array;
    readonly attachedAmount?: bigint;
    readonly fee: bigint;
    readonly executionLimit: bigint;
    readonly nonce: bigint;
    readonly validUntilHeight: bigint;
}
export declare function encodeContractDeploy(owner: Uint8Array, input: ContractDeployInput): Uint8Array<ArrayBuffer>;
export declare function encodeContractCall(caller: Uint8Array, input: ContractCallInput): Uint8Array<ArrayBuffer>;
