import type { ContractDescriptor, ContractIntent, ContractIntentInput, ContractProvider, ContractSimulation, ContractSubmission } from './types';
export declare class PayrailContractKit {
    readonly provider: ContractProvider;
    constructor(provider: ContractProvider);
    describe(contractId: string): Promise<ContractDescriptor>;
    intent(input: ContractIntentInput): ContractIntent;
    simulate(input: ContractIntentInput): Promise<ContractSimulation>;
    submit(signedEnvelope: Uint8Array): Promise<ContractSubmission>;
}
