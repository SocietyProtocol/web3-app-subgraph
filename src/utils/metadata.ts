import {
  ipfs,
  json,
  JSONValue,
  JSONValueKind,
  log,
  TypedMap,
} from "@graphprotocol/graph-ts";
import { User } from "../../generated/schema";

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

/** Fetches IPFS metadata for the URI and returns the `imageUrl` field, or null. */
export function getImageUrlFromIpfsUri(uri: string | null): string | null {
  const metadata = fetchIpfsMetadata(uri);
  if (metadata !== null) {
    log.info("IPFS metadata found for uri: {}", [uri ? uri : "null"]);
    return getStringFromTypedMap(metadata, "imageUrl");
  } else {
    log.info("No IPFS metadata found for uri: {}", [uri ? uri : "null"]);
  }
  return null;
}

/** Returns the `tier` string from parsed IPFS metadata, or null if absent. */
export function tierFromMetadata(
  metadata: TypedMap<string, JSONValue> | null,
): string | null {
  if (metadata === null) return null;
  const entry = metadata.get("tier");
  if (entry !== null && entry.kind === JSONValueKind.STRING) {
    return entry.toString();
  }
  return null;
}

/** Applies IPFS profile metadata fields (name, bio, imageUrl) to a User entity. */
export function applyIpfsMetadataToUser(
  user: User,
  metadata: TypedMap<string, JSONValue>,
): void {
  const name = metadata.get("name");
  if (name !== null && name.kind === JSONValueKind.STRING) {
    user.name = name.toString();
  }

  const bio = metadata.get("bio");
  if (bio !== null && bio.kind === JSONValueKind.STRING) {
    user.bio = bio.toString();
  }

  const imageUrl = metadata.get("imageUrl");
  if (imageUrl !== null && imageUrl.kind === JSONValueKind.STRING) {
    user.imageUrl = imageUrl.toString();
  }
}
