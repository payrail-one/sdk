import { type Checkout } from '../../api-client/src/index.js';
export interface PayrailCheckoutOptions {
    readonly apiBaseUrl: string;
    readonly merchantAddress: string;
    readonly walletOrigin?: string;
    readonly fetcher?: typeof fetch;
}
export interface CreatePaymentInput {
    readonly amountAtomic: string;
    readonly orderReference: string;
}
export interface PayrailPaymentSession {
    readonly checkout: Checkout;
    readonly paymentUrl: string;
    readonly qrPayload: string;
}
export interface WaitForFinalizationOptions {
    readonly intervalMs?: number;
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
    readonly onUpdate?: (checkout: Checkout) => void;
}
export declare class CheckoutInvariantError extends Error {
    constructor(message: string);
}
export declare class CheckoutExpiredError extends Error {
    readonly checkout: Checkout;
    constructor(checkout: Checkout);
}
export declare class CheckoutTimeoutError extends Error {
    readonly checkoutId: string;
    constructor(checkoutId: string);
}
export declare class PayrailCheckout {
    #private;
    constructor(options: PayrailCheckoutOptions);
    createPayment(input: CreatePaymentInput): Promise<PayrailPaymentSession>;
    payment(checkoutId: string): Promise<PayrailPaymentSession>;
    waitForFinalization(checkoutId: string, options?: WaitForFinalizationOptions): Promise<PayrailPaymentSession>;
}
