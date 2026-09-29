const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MANIFEST = path.join(__dirname, "..", "subgraph.yaml");
const RPC_TIMEOUT_MS = 30_000;

class PinError extends Error {
  constructor(message) {
    super(message);
    this.name = "PinError";
  }
}

function manifestPath(env) {
  if (typeof env.SUBGRAPH_MANIFEST_PATH === "string" && env.SUBGRAPH_MANIFEST_PATH.length > 0) {
    return env.SUBGRAPH_MANIFEST_PATH;
  }
  return DEFAULT_MANIFEST;
}

function decimalHeadBlock(result) {
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]+$/.test(result)) {
    throw new PinError("eth_blockNumber response is invalid");
  }
  const block = BigInt(result);
  if (block < 0n || block > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new PinError("eth_blockNumber response is invalid");
  }
  return block.toString(10);
}

async function fetchHeadBlock(rpcUrl, fetchImpl) {
  if (typeof rpcUrl !== "string" || rpcUrl.length === 0) {
    throw new PinError("SEPOLIA_RPC_URL is required");
  }
  let parsed;
  try {
    parsed = new URL(rpcUrl);
  } catch {
    throw new PinError("SEPOLIA_RPC_URL must be an HTTP(S) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new PinError("SEPOLIA_RPC_URL must be an HTTP(S) URL");
  }
  if (typeof fetchImpl !== "function") {
    throw new PinError("eth_blockNumber request failed");
  }

  let response;
  try {
    response = await fetchImpl(rpcUrl, {
      method: "POST",
      redirect: "error",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_blockNumber",
        params: [],
      }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
  } catch {
    // Do not print the fetch error. SEPOLIA_RPC_URL can contain a secret.
    throw new PinError("eth_blockNumber request failed");
  }
  if (!response || response.ok !== true) {
    throw new PinError("eth_blockNumber request failed");
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new PinError("eth_blockNumber response is invalid");
  }
  if (!body || typeof body !== "object" || body.error) {
    throw new PinError("eth_blockNumber request failed");
  }
  return decimalHeadBlock(body.result);
}

function rewriteStartBlocks(manifest, blockNumber) {
  if (typeof blockNumber !== "string" || !/^[0-9]+$/.test(blockNumber)) {
    throw new PinError("head block is not a decimal integer");
  }
  if (typeof manifest !== "string") {
    throw new PinError("subgraph.yaml has no startBlock values");
  }

  let count = 0;
  const updated = manifest.split("\n").map((line) => {
    const carriage = line.endsWith("\r");
    const text = carriage ? line.slice(0, -1) : line;
    if (!text.includes("startBlock")) return line;
    const match = /^([ \t]*startBlock:[ \t]*)[0-9]+[ \t]*$/.exec(text);
    if (!match) {
      throw new PinError("subgraph.yaml has a startBlock value that is not a decimal integer");
    }
    count += 1;
    return `${match[1]}${blockNumber}${carriage ? "\r" : ""}`;
  });
  if (count === 0) {
    throw new PinError("subgraph.yaml has no startBlock values");
  }
  return updated.join("\n");
}

async function pinHeadStartBlock(env = process.env, dependencies = {}) {
  if (env.SUBGRAPH_START_BLOCK !== "head") {
    throw new PinError("SUBGRAPH_START_BLOCK must be head");
  }
  const blockNumber = await fetchHeadBlock(env.SEPOLIA_RPC_URL, dependencies.fetchImpl || globalThis.fetch);
  const target = dependencies.manifestPath || manifestPath(env);
  let manifest;
  try {
    manifest = fs.readFileSync(target, "utf8");
  } catch {
    throw new PinError("Could not read subgraph.yaml");
  }
  const updated = rewriteStartBlocks(manifest, blockNumber);
  try {
    fs.writeFileSync(target, updated);
  } catch {
    throw new PinError("Could not write subgraph.yaml");
  }
  return { blockNumber, manifestPath: target };
}

function publicMessage(error) {
  if (error instanceof PinError) return error.message;
  return "pin start block failed";
}

async function main(env = process.env, dependencies = {}) {
  const result = await pinHeadStartBlock(env, dependencies);
  process.stdout.write(`Pinned subgraph.yaml startBlock values to ${result.blockNumber}\n`);
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`Error: ${publicMessage(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  PinError,
  decimalHeadBlock,
  fetchHeadBlock,
  manifestPath,
  pinHeadStartBlock,
  publicMessage,
  rewriteStartBlocks,
};
