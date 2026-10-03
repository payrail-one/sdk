export interface ContractDescriptor {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly entrypoints: readonly string[];
  readonly stateVersion: bigint;
}

export interface ContractIntent {
  readonly contractId: string;
  readonly caller: string;
  readonly entrypoint: string;
  readonly args: Uint8Array<ArrayBuffer>;
  readonly attachedAmount: bigint;
  readonly executionBudget: bigint;
  readonly nonce: bigint;
  readonly validUntilHeight: bigint;
}

export interface ContractSimulation {
  readonly accepted: boolean;
  readonly estimatedUnits: bigint;
  readonly stateVersion: bigint;
  readonly returnValue: Uint8Array<ArrayBuffer>;
  readonly events: readonly string[];
  readonly reason: string | null;
}

export interface ContractSubmission {
  readonly operationId: string;
  readonly acceptedAtHeight: bigint;
  readonly status: 'pending';
}

export interface ContractProvider {
  describe(contractId: string): Promise<ContractDescriptor>;
  simulate(intent: ContractIntent): Promise<ContractSimulation>;
  submit(signedEnvelope: Uint8Array): Promise<ContractSubmission>;
}

export interface ContractIntentInput {
  readonly contractId: string;
  readonly caller: string;
  readonly entrypoint: string;
  readonly args?: Uint8Array;
  readonly attachedAmount?: bigint;
  readonly executionBudget: bigint;
  readonly nonce: bigint;
  readonly validUntilHeight: bigint;
}
