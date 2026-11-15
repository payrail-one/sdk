/**
 * Compatibility facade over the canonical private asset-connectors client.
 *
 * Consumers of this subpath must have authorized access to the pinned private
 * package. The Payrail SDK does not carry an independent connector workflow.
 */
export * from '@payrail-one/asset-connectors-client';
