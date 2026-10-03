export declare class ContractBodyBuilder {
    #private;
    constant(value: bigint): this;
    argumentU128(offset: number): this;
    state(key: string): this;
    attachedAmount(): this;
    add(): this;
    subtract(): this;
    equals(): this;
    lessThanOrEqual(): this;
    greaterThanOrEqual(): this;
    require(reason: number): this;
    store(key: string): this;
    emit(topic: string): this;
    duplicate(): this;
    drop(): this;
    transferToCaller(): this;
    transferToArgumentAccount(offset: number): this;
    halt(): this;
    build(): Uint8Array<ArrayBuffer>;
    private instruction;
}
export declare class ContractProgramBuilder {
    #private;
    entrypoint(name: string, body: ContractBodyBuilder): this;
    build(): Uint8Array<ArrayBuffer>;
}
export declare function contractProgram(): ContractProgramBuilder;
export declare function contractBody(): ContractBodyBuilder;
