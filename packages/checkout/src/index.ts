import {
  PlatformApiClient,
  type Checkout,
} from '../../api-client/src/index.js';

const ATOMIC_AMOUNT = /^[1-9][0-9]*$/;
const CHECKOUT_ID = /^[0-9a-f]{64}$/;
const ORDER_REFERENCE = /^[A-Za-z0-9_-]{1,64}$/;

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

export class CheckoutInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckoutInvariantError';
  }
}

export class CheckoutExpiredError extends Error {
  constructor(readonly checkout: Checkout) {
    super(`Checkout ${checkout.id} expired before finalization.`);
    this.name = 'CheckoutExpiredError';
  }
}

export class CheckoutTimeoutError extends Error {
  constructor(readonly checkoutId: string) {
    super(`Checkout ${checkoutId} did not finalize before the timeout.`);
    this.name = 'CheckoutTimeoutError';
  }
}

export class PayrailCheckout {
  readonly #api: PlatformApiClient;
  readonly #merchantAddress: string;
  readonly #walletOrigin: string;

  constructor(options: PayrailCheckoutOptions) {
    this.#merchantAddress = validateMerchantAddress(options.merchantAddress);
    this.#walletOrigin = normalizeOrigin(
      options.walletOrigin ?? 'https://wallet.payrail.one',
    );
    this.#api = new PlatformApiClient(options.apiBaseUrl, options.fetcher);
  }

  async createPayment(
    input: CreatePaymentInput,
  ): Promise<PayrailPaymentSession> {
    validateAmount(input.amountAtomic);
    validateOrderReference(input.orderReference);
    const checkout = await this.#api.createCheckout({
      merchantAddress: this.#merchantAddress,
      amount: input.amountAtomic,
      orderReference: input.orderReference,
    });
    if (checkout.merchantAddress !== this.#merchantAddress) {
      throw new CheckoutInvariantError(
        'Checkout recipient differs from the configured merchant.',
      );
    }
    if (checkout.amount !== input.amountAtomic) {
      throw new CheckoutInvariantError(
        'Checkout amount differs from the requested atomic amount.',
      );
    }
    if (checkout.status !== 'open') {
      throw new CheckoutInvariantError('A new checkout must be open.');
    }
    return this.#session(checkout);
  }

  async payment(checkoutId: string): Promise<PayrailPaymentSession> {
    validateCheckoutId(checkoutId);
    return this.#session(await this.#api.checkout(checkoutId));
  }

  async waitForFinalization(
    checkoutId: string,
    options: WaitForFinalizationOptions = {},
  ): Promise<PayrailPaymentSession> {
    validateCheckoutId(checkoutId);
    const intervalMs = boundedDelay(options.intervalMs ?? 2_000, 'intervalMs');
    const timeoutMs = boundedDelay(
      options.timeoutMs ?? 15 * 60_000,
      'timeoutMs',
    );
    const deadline = Date.now() + timeoutMs;
    while (true) {
      options.signal?.throwIfAborted();
      const checkout = await this.#api.checkout(checkoutId);
      options.onUpdate?.(checkout);
      if (checkout.status === 'finalized') return this.#session(checkout);
      if (checkout.status === 'expired')
        throw new CheckoutExpiredError(checkout);
      if (Date.now() >= deadline) throw new CheckoutTimeoutError(checkoutId);
      await delay(
        Math.min(intervalMs, Math.max(1, deadline - Date.now())),
        options.signal,
      );
    }
  }

  #session(checkout: Checkout): PayrailPaymentSession {
    validateCheckoutId(checkout.id);
    if (checkout.merchantAddress !== this.#merchantAddress) {
      throw new CheckoutInvariantError(
        'Checkout recipient differs from the configured merchant.',
      );
    }
    if (checkout.paymentPath !== `/pay/${checkout.id}`) {
      throw new CheckoutInvariantError(
        'Checkout payment path is not canonical.',
      );
    }
    const paymentUrl = new URL(
      checkout.paymentPath,
      this.#walletOrigin,
    ).toString();
    return { checkout, paymentUrl, qrPayload: paymentUrl };
  }
}

function validateMerchantAddress(value: string): string {
  const normalized = value.trim();
  if (!/^pay[a-z0-9]{2,15}1[02-9ac-hj-np-z]{20,120}$/.test(normalized)) {
    throw new CheckoutInvariantError(
      'A canonical Payrail merchant address is required.',
    );
  }
  return normalized;
}

function validateAmount(value: string): void {
  if (!ATOMIC_AMOUNT.test(value)) {
    throw new CheckoutInvariantError(
      'amountAtomic must be a positive canonical integer string.',
    );
  }
}

function validateOrderReference(value: string): void {
  if (!ORDER_REFERENCE.test(value)) {
    throw new CheckoutInvariantError(
      'orderReference must contain 1-64 ASCII letters, digits, underscores or hyphens.',
    );
  }
}

function validateCheckoutId(value: string): void {
  if (!CHECKOUT_ID.test(value)) {
    throw new CheckoutInvariantError(
      'Expected a canonical checkout identifier.',
    );
  }
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new CheckoutInvariantError('walletOrigin must use HTTPS.');
  }
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function boundedDelay(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 86_400_000) {
    throw new CheckoutInvariantError(`${name} is outside the supported range.`);
  }
  return value;
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
