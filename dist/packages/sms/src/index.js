import { PlatformApiClient, } from '../../api-client/src/index.js';
const CHECKOUT_ID = /^[0-9a-f]{64}$/;
const APPROVAL_CODE = /^[0-9]{6}$/;
const SESSION_TOKEN = /^[0-9a-f]{144}$/;
const E164 = /^\+[1-9][0-9]{7,14}$/;
export class PayrailCodeWalletClient {
    #api;
    constructor(options) {
        this.#api = new PlatformApiClient(options.apiBaseUrl, options.fetcher);
    }
    async issue(input) {
        if (input.deviceId.length !== 32) {
            throw new PayrailCodeInvariantError('deviceId must contain 32 bytes.');
        }
        const request = await input.wallet.createApprovalCodeIssue({
            networkId: input.networkId,
            deviceId: input.deviceId,
            issuedAtMs: input.issuedAtMs,
        });
        const issued = await this.#api.issueApprovalCode(request);
        validateIssued(issued);
        return issued;
    }
    challenge(sessionToken) {
        validateSessionToken(sessionToken);
        return this.#api.approvalCodeChallenge(sessionToken);
    }
    async waitForChallenge(sessionToken, options = {}) {
        validateSessionToken(sessionToken);
        const intervalMs = boundedDelay(options.intervalMs ?? 1_500, 'intervalMs');
        const timeoutMs = boundedDelay(options.timeoutMs ?? 120_000, 'timeoutMs');
        const deadline = Date.now() + timeoutMs;
        while (true) {
            options.signal?.throwIfAborted();
            const challenge = await this.#api.approvalCodeChallenge(sessionToken);
            validateChallenge(challenge);
            options.onUpdate?.(challenge);
            if (challenge.status !== 'waiting')
                return challenge;
            if (Date.now() >= deadline) {
                throw new PayrailCodeTimeoutError();
            }
            await delay(Math.min(intervalMs, Math.max(1, deadline - Date.now())), options.signal);
        }
    }
}
export class PayrailCodeMerchantClient {
    #api;
    #merchantToken;
    constructor(options) {
        if (options.merchantToken.length < 32 ||
            options.merchantToken.length > 256) {
            throw new PayrailCodeInvariantError('merchantToken must contain 32-256 characters.');
        }
        this.#merchantToken = options.merchantToken;
        this.#api = new PlatformApiClient(options.apiBaseUrl, options.fetcher);
    }
    claim(checkoutId, code) {
        validateCheckoutId(checkoutId);
        validateCode(code);
        return this.#api.claimApprovalCode(checkoutId, code, this.#merchantToken);
    }
}
export function checkoutSmsMessage(checkout, walletOrigin = 'https://wallet.payrail.one') {
    validateCheckoutId(checkout.id);
    const origin = normalizedHttpsOrigin(walletOrigin);
    const message = checkout.smsText.replaceAll('{origin}', origin);
    if (message.length === 0 ||
        message.length > 480 ||
        !message.includes(`${origin}${checkout.paymentPath}`)) {
        throw new PayrailCodeInvariantError('Checkout SMS text does not contain its canonical payment URL.');
    }
    return message;
}
export function smsComposerUrl(input) {
    if (input.body.length === 0 || input.body.length > 480) {
        throw new PayrailCodeInvariantError('SMS body must contain 1-480 characters.');
    }
    const recipient = input.recipient ?? '';
    if (recipient && !E164.test(recipient)) {
        throw new PayrailCodeInvariantError('SMS recipient must use canonical E.164 format.');
    }
    return `sms:${recipient}?body=${encodeURIComponent(input.body)}`;
}
export function createPayrailDeviceId() {
    return crypto.getRandomValues(new Uint8Array(32));
}
export class PayrailCodeInvariantError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PayrailCodeInvariantError';
    }
}
export class PayrailCodeTimeoutError extends Error {
    constructor() {
        super('No Payrail Code payment request arrived before the code expired.');
        this.name = 'PayrailCodeTimeoutError';
    }
}
function validateIssued(value) {
    validateCode(value.code);
    validateSessionToken(value.sessionToken);
    if (!/^[1-9][0-9]*$/.test(value.expiresAtMs)) {
        throw new PayrailCodeInvariantError('Payrail Code expiry must be a canonical millisecond string.');
    }
}
function validateChallenge(value) {
    if (value.status === 'waiting' && value.checkout !== null) {
        throw new PayrailCodeInvariantError('A waiting Payrail Code cannot expose a checkout.');
    }
    if (value.status !== 'waiting' && value.checkout === null) {
        throw new PayrailCodeInvariantError('A claimed Payrail Code must contain its checkout.');
    }
    if (value.checkout)
        validateCheckoutId(value.checkout.id);
}
function validateCheckoutId(value) {
    if (!CHECKOUT_ID.test(value)) {
        throw new PayrailCodeInvariantError('Expected a canonical checkout identifier.');
    }
}
function validateCode(value) {
    if (!APPROVAL_CODE.test(value)) {
        throw new PayrailCodeInvariantError('Payrail Code must contain exactly six ASCII digits.');
    }
}
function validateSessionToken(value) {
    if (!SESSION_TOKEN.test(value)) {
        throw new PayrailCodeInvariantError('Payrail Code session token is malformed.');
    }
}
function normalizedHttpsOrigin(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
        throw new PayrailCodeInvariantError('walletOrigin must use HTTPS.');
    }
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.origin;
}
function boundedDelay(value, name) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 86_400_000) {
        throw new PayrailCodeInvariantError(`${name} is outside the supported range.`);
    }
    return value;
}
function delay(milliseconds, signal) {
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
//# sourceMappingURL=index.js.map