import { bech32m } from '@scure/base';
import { fromHex } from '../../api-client/src/index.js';

const AUTHORIZATION_DOMAIN = new TextEncoder().encode('ledger.authorization\0');
const ENVELOPE_DOMAIN = new TextEncoder().encode('ledger.envelope\0');
const VAULT_DOMAIN = 'payrail.wallet.v1';
const VAULT_ITERATIONS = 600_000;
const ACCOUNT_ADDRESS_TYPE = 0;

export interface PayrailWallet {
  readonly address: string;
  readonly accountId: string;
  readonly publicKey: Uint8Array<ArrayBuffer>;
  signTransfer(input: TransferInput): Promise<Uint8Array<ArrayBuffer>>;
}

export type EphemeralWallet = PayrailWallet;

export interface EncryptedWalletVault {
  readonly version: 1;
  readonly address: string;
  readonly publicKey: string;
  readonly salt: string;
  readonly iv: string;
  readonly ciphertext: string;
}

export interface CreatedWalletVault {
  readonly wallet: PayrailWallet;
  readonly vault: EncryptedWalletVault;
}

export function parseEncryptedWalletVault(
  value: unknown,
): EncryptedWalletVault {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error('Unsupported wallet backup.');
  }
  const address = vaultField(value, 'address');
  const publicKeyEncoded = vaultField(value, 'publicKey');
  const saltEncoded = vaultField(value, 'salt');
  const ivEncoded = vaultField(value, 'iv');
  const ciphertextEncoded = vaultField(value, 'ciphertext');
  const publicKey = fromBase64(publicKeyEncoded);
  const salt = fromBase64(saltEncoded);
  const iv = fromBase64(ivEncoded);
  const ciphertext = fromBase64(ciphertextEncoded);
  if (
    publicKey.length !== 32 ||
    salt.length !== 16 ||
    iv.length !== 12 ||
    ciphertext.length === 0
  ) {
    throw new Error('Wallet backup is malformed.');
  }
  return {
    version: 1,
    address,
    publicKey: publicKeyEncoded,
    salt: saltEncoded,
    iv: ivEncoded,
    ciphertext: ciphertextEncoded,
  };
}

export interface TransferInput {
  readonly networkId: string;
  readonly assetId: string;
  readonly idempotencyKey: Uint8Array;
  readonly recipientAccountId: string;
  readonly amount: bigint;
  readonly fee: bigint;
  readonly nonce: bigint;
  readonly validUntilHeight: bigint;
}

export async function createEphemeralWallet(
  prefix: string,
): Promise<EphemeralWallet> {
  const pair = (await crypto.subtle.generateKey('Ed25519', false, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const publicKey = new Uint8Array(
    await crypto.subtle.exportKey('raw', pair.publicKey),
  );
  return walletFromKey(prefix, pair.privateKey, publicKey);
}

export async function createEncryptedWallet(
  prefix: string,
  password: string,
): Promise<CreatedWalletVault> {
  validatePassword(password);
  const pair = (await crypto.subtle.generateKey('Ed25519', true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const publicKey = new Uint8Array(
    await crypto.subtle.exportKey('raw', pair.publicKey),
  );
  const privateKey = new Uint8Array(
    await crypto.subtle.exportKey('pkcs8', pair.privateKey),
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const address = addressFromPublicKey(prefix, publicKey);
  const encryptionKey = await deriveEncryptionKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: vaultAdditionalData(prefix, publicKey),
    },
    encryptionKey,
    privateKey,
  );
  return {
    wallet: walletFromKey(prefix, pair.privateKey, publicKey),
    vault: {
      version: 1,
      address,
      publicKey: toBase64(publicKey),
      salt: toBase64(salt),
      iv: toBase64(iv),
      ciphertext: toBase64(new Uint8Array(ciphertext)),
    },
  };
}

export async function unlockEncryptedWallet(
  prefix: string,
  password: string,
  vault: EncryptedWalletVault,
): Promise<PayrailWallet> {
  validatePassword(password);
  const parsed = parseEncryptedWalletVault(vault);
  const publicKey = fromBase64(parsed.publicKey);
  const salt = fromBase64(parsed.salt);
  const iv = fromBase64(parsed.iv);
  const ciphertext = fromBase64(parsed.ciphertext);
  if (addressFromPublicKey(prefix, publicKey) !== parsed.address) {
    throw new Error('Wallet vault belongs to another network or is corrupted.');
  }
  try {
    const encryptionKey = await deriveEncryptionKey(password, salt);
    const privateKeyBytes = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: vaultAdditionalData(prefix, publicKey),
      },
      encryptionKey,
      ciphertext,
    );
    const privateKey = await crypto.subtle.importKey(
      'pkcs8',
      privateKeyBytes,
      'Ed25519',
      false,
      ['sign'],
    );
    return walletFromKey(prefix, privateKey, publicKey);
  } catch {
    throw new Error('Incorrect password or corrupted wallet vault.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function vaultField(value: Record<string, unknown>, field: string): string {
  const candidate = value[field];
  if (
    typeof candidate !== 'string' ||
    candidate.length === 0 ||
    candidate.length > 1_024
  ) {
    throw new Error('Wallet backup is malformed.');
  }
  return candidate;
}

function walletFromKey(
  prefix: string,
  privateKey: CryptoKey,
  publicKey: Uint8Array<ArrayBuffer>,
): PayrailWallet {
  const accountId = toHex(publicKey);
  const address = addressFromPublicKey(prefix, publicKey);
  return {
    address,
    accountId,
    publicKey,
    async signTransfer(input: TransferInput): Promise<Uint8Array<ArrayBuffer>> {
      const operation = encodeTransfer(publicKey, input);
      const message = concat(AUTHORIZATION_DOMAIN, Uint8Array.of(0), operation);
      const signature = new Uint8Array(
        await crypto.subtle.sign('Ed25519', privateKey, message),
      );
      return concat(
        ENVELOPE_DOMAIN,
        operation,
        publicKey,
        signature,
        Uint8Array.of(0),
      );
    },
  };
}

function addressFromPublicKey(prefix: string, publicKey: Uint8Array): string {
  return bech32m.encode(
    prefix,
    bech32m.toWords(concat(Uint8Array.of(0), publicKey)),
  );
}

async function deriveEncryptionKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations: VAULT_ITERATIONS,
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function vaultAdditionalData(
  prefix: string,
  publicKey: Uint8Array,
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    `${VAULT_DOMAIN}\0${prefix}\0${toHex(publicKey)}`,
  );
}

function validatePassword(password: string): void {
  if (password.length < 10 || password.length > 256) {
    throw new Error('Password must contain between 10 and 256 characters.');
  }
}

function toBase64(bytes: Uint8Array): string {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error('Wallet vault contains invalid encoded data.');
  }
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export function accountIdFromAddress(address: string, prefix: string): string {
  let decoded: { readonly prefix: string; readonly bytes: Uint8Array };
  try {
    decoded = bech32m.decodeToBytes(address);
  } catch {
    throw new Error('Enter a valid payment address.');
  }
  if (decoded.prefix !== prefix) {
    throw new Error(`This address is not for the ${prefix} network.`);
  }
  if (
    decoded.bytes.length !== 33 ||
    decoded.bytes[0] !== ACCOUNT_ADDRESS_TYPE
  ) {
    throw new Error('This address is not a supported account address.');
  }
  return toHex(decoded.bytes.slice(1));
}

function encodeTransfer(
  sender: Uint8Array,
  input: TransferInput,
): Uint8Array<ArrayBuffer> {
  if (input.idempotencyKey.length !== 32)
    throw new Error('Idempotency key must be 32 bytes.');
  return concat(
    Uint8Array.of(0),
    fromHex(input.networkId, 32),
    input.idempotencyKey,
    fromHex(input.assetId, 32),
    sender,
    fromHex(input.recipientAccountId, 32),
    encodeUnsigned(input.amount, 16),
    encodeUnsigned(input.fee, 16),
    encodeUnsigned(input.nonce, 8),
    encodeUnsigned(input.validUntilHeight, 8),
  );
}

function encodeUnsigned(
  value: bigint,
  length: number,
): Uint8Array<ArrayBuffer> {
  if (value < 0n) throw new Error('Unsigned values cannot be negative.');
  const output = new Uint8Array(length);
  let remaining = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    output[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  if (remaining !== 0n)
    throw new Error(`Value does not fit in ${length} bytes.`);
  return output;
}

function concat(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}
