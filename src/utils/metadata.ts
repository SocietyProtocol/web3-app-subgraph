import { DataSourceTemplate } from "@graphprotocol/graph-ts";

function isSafeGatewayHost(host: string): boolean {
  if (host.length == 0 || host.includes("@") || host.includes(":")) return false;
  for (let i = 0; i < host.length; i++) {
    const code = host.charCodeAt(i);
    if (
      !((code >= 97 && code <= 122) ||
        (code >= 65 && code <= 90) ||
        (code >= 48 && code <= 57) ||
        code == 45 || code == 46)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Return the inventory-backed Metadata identity for an observed URI.
 *
 * Phase 2 accepts the inventory's CIDv1 roots through ipfs:// and safe HTTPS
 * /ipfs/ transports. The returned value is the CID/path passed to the file
 * template. Only relative, unencoded paths below the CID are accepted.
 */
export function canonicalMetadataIdentifier(uri: string | null): string | null {
  if (uri === null || uri.length == 0) return null;

  let withoutQuery = uri.split("?", 1)[0];
  withoutQuery = withoutQuery.split("#", 1)[0];
  if (
    withoutQuery.includes("%") ||
    withoutQuery.includes("\\") ||
    withoutQuery.includes("\n") ||
    withoutQuery.includes("\r")
  ) return null;
  let identifier = "";
  if (withoutQuery.startsWith("ipfs://")) {
    identifier = withoutQuery.slice(7);
  } else if (withoutQuery.startsWith("/ipfs/")) {
    identifier = withoutQuery.slice(6);
  } else if (withoutQuery.startsWith("https://") || withoutQuery.startsWith("http://")) {
    const schemeLength = withoutQuery.startsWith("https://") ? 8 : 7;
    const authorityEnd = withoutQuery.indexOf("/", schemeLength);
    if (authorityEnd <= schemeLength) return null;
    const host = withoutQuery.slice(schemeLength, authorityEnd);
    if (!isSafeGatewayHost(host)) return null;
    const path = withoutQuery.slice(authorityEnd);
    const ipfsMarker = path.indexOf("/ipfs/");
    if (ipfsMarker < 0) return null;
    const gatewayPrefix = path.slice(0, ipfsMarker + 6);
    const gatewayParts = gatewayPrefix.split("/");
    for (let i = 1; i < gatewayParts.length - 1; i++) {
      if (gatewayParts[i].length == 0 || gatewayParts[i] == "." || gatewayParts[i] == "..") {
        return null;
      }
    }
    identifier = path.slice(ipfsMarker + 6);
  } else {
    return null;
  }

  if (identifier.length == 0 || identifier.includes("%")) return null;
  if (identifier.includes("\\") || identifier.includes("\n") || identifier.includes("\r")) {
    return null;
  }

  // CIDv1 base32 roots observed by the inventory are bafy*/bafk* values.
  const parts = identifier.split("/");
  const root = parts[0];
  if (root.length != 59 || (!root.startsWith("bafybei") && !root.startsWith("bafkrei"))) {
    return null;
  }
  for (let i = 4; i < root.length; i++) {
    const code = root.charCodeAt(i);
    const validBase32 = (code >= 97 && code <= 122) || (code >= 50 && code <= 55);
    if (!validBase32) return null;
  }
  const final = root.charCodeAt(root.length - 1);
  if (
    final != 97 && final != 101 && final != 105 && final != 109 &&
    final != 113 && final != 117 && final != 121 && final != 52
  ) return null;

  if (identifier.startsWith("/") || identifier.endsWith("/")) return null;
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].length == 0 || parts[i] == "." || parts[i] == "..") {
      return null;
    }
    for (let j = 0; j < parts[i].length; j++) {
      const code = parts[i].charCodeAt(j);
      if (code < 33 || code > 126) return null;
    }
  }

  return identifier;
}

/** Set a chain entity's v2 reference and queue its immutable file source. */
export function setMetadataReference(
  uri: string | null,
): string | null {
  const identifier = canonicalMetadataIdentifier(uri);
  if (identifier != null) DataSourceTemplate.create("MetadataFile", [identifier!]);
  return identifier;
}
