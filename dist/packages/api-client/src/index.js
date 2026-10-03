export class PlatformApiError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
        this.name = 'PlatformApiError';
    }
}
export class PlatformApiClient {
    #baseUrl;
    #fetcher;
    constructor(baseUrl, fetcher = globalThis.fetch.bind(globalThis)) {
        this.#baseUrl = baseUrl.replace(/\/$/, '');
        this.#fetcher = fetcher;
    }
    status() {
        return this.#request('/status');
    }
    account(address) {
        return this.#request(`/accounts/${encodeURIComponent(address)}`);
    }
    overview() {
        return this.#request('/explorer');
    }
    faucet(address) {
        return this.#request('/faucet', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ address }),
        });
    }
    submit(envelope) {
        return this.#request('/transactions', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ envelope: toHex(envelope) }),
        });
    }
    createCheckout(request) {
        return this.#request('/checkouts', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(request),
        });
    }
    checkout(id) {
        return this.#request(`/checkouts/${encodeURIComponent(id)}`);
    }
    submitCheckout(id, envelope) {
        return this.#request(`/checkouts/${encodeURIComponent(id)}/transactions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ envelope: toHex(envelope) }),
        });
    }
    async #request(path, init) {
        const response = await this.#fetcher(`${this.#baseUrl}${path}`, init);
        if (!response.ok) {
            const body = (await response.json().catch(() => null));
            const message = typeof body?.error === 'string' ? body.error : response.statusText;
            throw new PlatformApiError(message || 'Request failed.', response.status);
        }
        return (await response.json());
    }
}
export function toHex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function fromHex(value, expectedBytes) {
    if (!/^[0-9a-f]+$/.test(value) || value.length % 2 !== 0) {
        throw new Error('Expected canonical lowercase hexadecimal data.');
    }
    const bytes = Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
    if (expectedBytes !== undefined && bytes.length !== expectedBytes) {
        throw new Error(`Expected ${expectedBytes} bytes.`);
    }
    return bytes;
}
//# sourceMappingURL=index.js.map