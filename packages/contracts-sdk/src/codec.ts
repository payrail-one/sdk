export function bytesToHex(bytes: Uint8Array, prefix = false): string {
  const value = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return prefix ? `0x${value}` : value;
}

export function hexToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.startsWith('0x') ? value.slice(2) : value;
  if (!/^(?:[0-9a-f]{2})*$/.test(normalized)) {
    throw new TypeError('Expected canonical lowercase hexadecimal data.');
  }
  return Uint8Array.from(normalized.match(/.{2}/g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
}
