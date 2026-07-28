import {
  ipfs,
  json,
  JSONValue,
  JSONValueKind,
  log,
  TypedMap,
} from "@graphprotocol/graph-ts";

/** Returns the IPFS CID/hash from an ipfs:// or /ipfs/ URI, or empty string. */
export function ipfsHashFromUri(uri: string | null): string {
  if (uri === null) return "";
  if (uri.startsWith("ipfs://")) return uri.slice(7);
  if (uri.includes("/ipfs/")) {
    const parts = uri.split("/ipfs/");
    if (parts.length > 1) return parts[parts.length - 1];
  }
  return "";
}

/** Fetches and parses IPFS JSON metadata, or returns null on any failure. */
export function fetchIpfsMetadata(
  uri: string | null,
): TypedMap<string, JSONValue> | null {
  const hash = ipfsHashFromUri(uri);
  if (hash.length === 0) return null;
  const bytes = ipfs.cat(hash);
  if (bytes === null) {
    log.info("No IPFS metadata found for hash: {}", [hash]);
    return null;
  }
  const parsed = json.fromBytes(bytes);
  if (parsed.kind !== JSONValueKind.OBJECT) return null;
  return parsed.toObject();
}

/**
 *  Helper to read a string field from parsed IPFS metadata, returning null if the field is absent or not a string.
 * @param typedMap The parsed IPFS metadata as a TypedMap.
 * @param key The key to look up in the metadata.
 * @returns The string value associated with the key, or null if absent or not a string.
 */
export function getStringFromTypedMap(
  typedMap: TypedMap<string, JSONValue>,
  key: string,
): string | null {
  const value = typedMap.get(key);
  if (value !== null && value.kind === JSONValueKind.STRING) {
    return value.toString();
  }
  return null;
}
