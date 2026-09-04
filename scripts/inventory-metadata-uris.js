#!/usr/bin/env node

/*
 * Phase 1 only: reconstruct URI assertions from Ethereum mainnet.  This file
 * deliberately has no Graph, IPFS, signer, or transaction dependencies.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Interface, JsonRpcProvider } = require("ethers");

const ROOT = path.join(__dirname, "..");
const NETWORKS = JSON.parse(
  fs.readFileSync(path.join(ROOT, "networks.json"), "utf8"),
);
const BADGES_ABI = JSON.parse(
  fs.readFileSync(path.join(ROOT, "abis", "SocietyProtocolBadges.json"), "utf8"),
);
const REGISTRY_ABI = JSON.parse(
  fs.readFileSync(path.join(ROOT, "abis", "CommunityRegistry.json"), "utf8"),
);
const BADGES_INTERFACE = new Interface(BADGES_ABI);
const REGISTRY_INTERFACE = new Interface(REGISTRY_ABI);

const BADGE_EVENTS = ["BadgeCreated", "BadgeModified", "URI", "ProfileCreated"];
const REGISTRY_EVENTS = ["CommunityCreated", "CommunityBadgeCreated"];
const REQUIRED_ENV = [
  "ETH_MAINNET_ARCHIVE_RPC_URL",
  "FROM_BLOCK",
  "TO_BLOCK",
];

class InventoryError extends Error {
  constructor(code) {
    super(code);
    this.name = "InventoryError";
    this.code = code;
  }
}

function fail(code) {
  throw new InventoryError(code);
}

function parseBlock(value, name) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    fail(`INVALID_${name}`);
  }
  const block = Number(value);
  if (!Number.isSafeInteger(block) || block < 0) fail(`INVALID_${name}`);
  return block;
}

function readConfig(env = process.env) {
  for (const name of REQUIRED_ENV) {
    if (typeof env[name] !== "string" || env[name].length === 0) {
      fail(`MISSING_${name}`);
    }
  }

  let rpcUrl;
  try {
    rpcUrl = new URL(env.ETH_MAINNET_ARCHIVE_RPC_URL);
    if (rpcUrl.protocol !== "http:" && rpcUrl.protocol !== "https:") {
      fail("INVALID_ARCHIVE_RPC_URL");
    }
  } catch (_) {
    fail("INVALID_ARCHIVE_RPC_URL");
  }

  const fromBlock = parseBlock(env.FROM_BLOCK, "FROM_BLOCK");
  const toBlock = parseBlock(env.TO_BLOCK, "TO_BLOCK");
  if (fromBlock > toBlock) fail("INVALID_BLOCK_RANGE");

  const mainnet = NETWORKS.mainnet;
  if (!mainnet || mainnet.chainId !== 1) fail("INVALID_MAINNET_CONFIGURATION");
  const badges = mainnet.SocietyProtocolBadges;
  const registry = mainnet.CommunityRegistry;
  if (!badges || !registry || !badges.address || !registry.address) {
    fail("INVALID_MAINNET_ADDRESSES");
  }

  return {
    rpcUrl: rpcUrl.toString(),
    fromBlock,
    toBlock,
    starts: {
      SocietyProtocolBadges: badges.startBlock,
      CommunityRegistry: registry.startBlock,
    },
    addresses: {
      SocietyProtocolBadges: badges.address,
      CommunityRegistry: registry.address,
    },
    // Deliberately fixed: an arbitrary environment value must not become a
    // credential-bearing "provider label" in the evidence artifact.
    providerLabel: "mainnet-archive-rpc",
  };
}

function asDecimal(value, field) {
  try {
    const result = BigInt(value).toString();
    if (result.startsWith("-")) fail(`INVALID_${field}`);
    return result;
  } catch (_) {
    fail(`INVALID_${field}`);
  }
}

function asAddress(value, field) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    fail(`INVALID_${field}`);
  }
  return value.toLowerCase();
}

function asLogPosition(log) {
  const blockNumber = Number(log.blockNumber);
  const transactionIndex = Number(log.transactionIndex);
  const logIndex = Number(log.index ?? log.logIndex);
  if (
    log.removed === true ||
    !Number.isSafeInteger(blockNumber) || blockNumber < 0 ||
    !Number.isSafeInteger(transactionIndex) || transactionIndex < 0 ||
    !Number.isSafeInteger(logIndex) || logIndex < 0 ||
    typeof log.transactionHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(log.transactionHash)
  ) {
    fail("EVENT_ORDER_GAP");
  }
  return {
    blockNumber,
    transactionIndex,
    logIndex,
    transactionHash: log.transactionHash.toLowerCase(),
  };
}

function orderCompare(a, b) {
  return a.blockNumber - b.blockNumber ||
    a.transactionIndex - b.transactionIndex ||
    a.logIndex - b.logIndex ||
    String(a.sourceKind).localeCompare(String(b.sourceKind));
}

function classifyUri(rawEffectiveUri) {
  if (rawEffectiveUri === null || rawEffectiveUri === undefined) {
    return { uriClass: "unknown", status: "missing" };
  }
  if (typeof rawEffectiveUri !== "string") {
    return { uriClass: "unknown", status: "missing" };
  }
  const value = rawEffectiveUri.trim();
  if (value.length === 0) return { uriClass: "empty", status: "empty" };

  if (/^ipfs:\/\//i.test(value)) {
    const identifier = value.slice("ipfs://".length).split(/[?#]/, 1)[0];
    const valid = identifier.length > 0 && !identifier.split("/").includes("..");
    return { uriClass: "ipfs", status: valid ? "resolved" : "unsupported" };
  }
  if (/^\/ipfs(?:\/|$)/i.test(value)) {
    const identifier = value.replace(/^\/ipfs\/?/i, "").split(/[?#]/, 1)[0];
    const valid = identifier.length > 0 && !identifier.split("/").includes("..");
    return { uriClass: "ipfs", status: valid ? "resolved" : "unsupported" };
  }
  if (/^ipns:\/\//i.test(value) || /^\/ipns(?:\/|$)/i.test(value)) {
    return { uriClass: "ipns", status: "unsupported" };
  }
  if (/^https?:\/\//i.test(value)) {
    // A gateway URL is an accepted IPFS transport when its path contains the
    // IPFS wrapper. Ordinary HTTP remains unsupported.
    try {
      const url = new URL(value);
      if (/\/ipfs(?:\/|$)/i.test(url.pathname)) {
        const match = url.pathname.match(/\/ipfs\/?(.*)$/i);
        const identifier = match ? match[1] : "";
        const valid = identifier.length > 0 && !identifier.split("/").includes("..");
        return { uriClass: "ipfs", status: valid ? "resolved" : "unsupported" };
      }
      if (/\/ipns(?:\/|$)/i.test(url.pathname)) {
        return { uriClass: "ipns", status: "unsupported" };
      }
    } catch (_) {
      // Keep malformed HTTP in the HTTP/unsupported bucket.
    }
    return { uriClass: "http", status: "unsupported" };
  }
  if (/^data:/i.test(value)) {
    return { uriClass: "data", status: "unsupported" };
  }
  // Bare CIDs are retained as evidence but remain unsupported until Phase 1
  // evidence determines whether the v2 identity utility should accept them.
  if (
    /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(value) ||
    /^b[a-z2-7]{20,}$/i.test(value)
  ) {
    return { uriClass: "bare-cid", status: "unsupported" };
  }
  return { uriClass: "unsupported", status: "unsupported" };
}

function parseEvent(log, iface, sourceContract) {
  const position = asLogPosition(log);
  let parsed;
  try {
    parsed = iface.parseLog({ topics: log.topics, data: log.data });
  } catch (_) {
    fail("EVENT_DECODE_FAILED");
  }
  if (!parsed) fail("EVENT_DECODE_FAILED");
  return {
    sourceContract,
    sourceKind: parsed.name,
    args: parsed.args,
    ...position,
  };
}

function getEventTopic(iface, eventName) {
  const fragment = iface.getEvent(eventName);
  if (!fragment || !fragment.topicHash) fail("ABI_EVENT_MISSING");
  return fragment.topicHash;
}

async function fetchEvents(provider, config) {
  const requests = [
    ["SocietyProtocolBadges", config.addresses.SocietyProtocolBadges, BADGES_INTERFACE, BADGE_EVENTS],
    ["CommunityRegistry", config.addresses.CommunityRegistry, REGISTRY_INTERFACE, REGISTRY_EVENTS],
  ];
  const events = [];
  for (const [sourceContract, address, iface, names] of requests) {
    for (const eventName of names) {
      let logs;
      try {
        logs = await provider.getLogs({
          address,
          fromBlock: config.fromBlock,
          toBlock: config.toBlock,
          topics: [getEventTopic(iface, eventName)],
        });
      } catch (_) {
        fail("RPC_LOG_FETCH_FAILED");
      }
      if (!Array.isArray(logs)) fail("RPC_LOG_FETCH_FAILED");
      for (const log of logs) {
        const event = parseEvent(log, iface, sourceContract);
        if (event.sourceKind !== eventName) fail("EVENT_DECODE_FAILED");
        events.push(event);
      }
    }
  }
  events.sort(orderCompare);
  for (let i = 1; i < events.length; i += 1) {
    const a = events[i - 1];
    const b = events[i];
    if (orderCompare(a, b) === 0) fail("EVENT_ORDER_GAP");
  }
  return events;
}

async function readCreatedUris(provider, config, events) {
  const uriData = new Map();
  for (const event of events) {
    if (event.sourceKind !== "BadgeCreated") continue;
    const badgeId = asDecimal(event.args.id, "BADGE_ID");
    let encoded;
    try {
      encoded = BADGES_INTERFACE.encodeFunctionData("uri", [badgeId]);
    } catch (_) {
      fail("ABI_URI_MISSING");
    }
    let response;
    try {
      // The block tag is intentionally the BadgeCreated event block, never
      // latest. JsonRpcProvider performs an eth_call and no write operation.
      response = await provider.call(
        { to: config.addresses.SocietyProtocolBadges, data: encoded },
        event.blockNumber,
      );
    } catch (_) {
      fail("HISTORICAL_URI_READ_FAILED");
    }
    let uri;
    try {
      uri = BADGES_INTERFACE.decodeFunctionResult("uri", response)[0];
    } catch (_) {
      fail("HISTORICAL_URI_READ_FAILED");
    }
    if (typeof uri !== "string") fail("HISTORICAL_URI_READ_FAILED");
    uriData.set(`${event.blockNumber}:${event.transactionIndex}:${event.logIndex}`, uri);
  }
  return uriData;
}

function uriFields(rawEffectiveUri) {
  return { rawEffectiveUri, ...classifyUri(rawEffectiveUri) };
}

function makeRecord(type, event, fields) {
  return {
    recordType: type,
    sourceKind: event.sourceKind,
    blockNumber: event.blockNumber,
    transactionIndex: event.transactionIndex,
    logIndex: event.logIndex,
    transactionHash: event.transactionHash,
    ...fields,
  };
}

function replayEvents(events, createdUris) {
  const badges = new Map();
  const records = [];
  const unresolvedIds = new Set();
  let previousEvent;

  for (const event of [...events].sort(orderCompare)) {
    const args = event.args;
    if (event.sourceKind === "BadgeCreated") {
      const badgeId = asDecimal(args.id, "BADGE_ID");
      const key = `${event.blockNumber}:${event.transactionIndex}:${event.logIndex}`;
      if (!createdUris.has(key)) {
        unresolvedIds.add(badgeId);
        fail("HISTORICAL_URI_READ_FAILED");
      }
      const rawEffectiveUri = createdUris.get(key);
      badges.set(badgeId, rawEffectiveUri);
      records.push(makeRecord("assertion", event, {
        ...uriFields(rawEffectiveUri),
        badgeId,
      }));
      previousEvent = event;
      continue;
    }

    if (event.sourceKind === "BadgeModified" || event.sourceKind === "URI") {
      const badgeId = asDecimal(args.id, "BADGE_ID");
      if (!badges.has(badgeId)) {
        unresolvedIds.add(badgeId);
        fail("EVENT_ORDER_GAP");
      }
      const rawEffectiveUri = event.sourceKind === "BadgeModified" ? args.metadataURI : args.value;
      badges.set(badgeId, rawEffectiveUri);
      const record = makeRecord("assertion", event, {
        ...uriFields(rawEffectiveUri),
        badgeId,
      });
      // modifyBadge emits BadgeModified immediately followed by URI. Keep
      // both assertions, but expose a conflict if an ABI/event stream says
      // those two authoritative values disagree.
      if (
        event.sourceKind === "URI" && previousEvent &&
        previousEvent.sourceKind === "BadgeModified" &&
        previousEvent.badgeId === badgeId &&
        previousEvent.transactionHash === event.transactionHash &&
        previousEvent.logIndex + 1 === event.logIndex
      ) {
        const prior = records[records.length - 1];
        if (prior && prior.rawEffectiveUri !== rawEffectiveUri) {
          prior.status = "conflict";
          record.status = "conflict";
        }
      }
      records.push(record);
      previousEvent = { ...event, badgeId };
      continue;
    }

    if (event.sourceKind === "ProfileCreated") {
      const badgeId = asDecimal(args.id, "BADGE_ID");
      if (!badges.has(badgeId)) {
        unresolvedIds.add(badgeId);
        fail("PROFILE_BADGE_STATE_UNRESOLVED");
      }
      records.push(makeRecord("association", event, {
        associationKind: "profile-badge",
        userAddress: asAddress(args.user, "PROFILE_USER"),
        badgeId,
        ...uriFields(badges.get(badgeId)),
      }));
      previousEvent = event;
      continue;
    }

    if (event.sourceKind === "CommunityBadgeCreated") {
      const badgeId = asDecimal(args.badgeId, "BADGE_ID");
      if (!badges.has(badgeId)) {
        unresolvedIds.add(badgeId);
        fail("COMMUNITY_BADGE_STATE_UNRESOLVED");
      }
      // This is a linkage fact used to prove that all decoded registry events
      // have a known badge. The URI association emitted below is specifically
      // the manager badge association required by the phase contract.
      continue;
    }

    if (event.sourceKind === "CommunityCreated") {
      const communityId = asDecimal(args.communityId, "COMMUNITY_ID");
      const managerBadgeId = communityId;
      if (!badges.has(managerBadgeId)) {
        unresolvedIds.add(managerBadgeId);
        fail("COMMUNITY_MANAGER_STATE_UNRESOLVED");
      }
      records.push(makeRecord("association", event, {
        associationKind: "community-manager-badge",
        communityId,
        managerBadgeId,
        managerAddress: asAddress(args.creator, "COMMUNITY_CREATOR"),
        ...uriFields(badges.get(managerBadgeId)),
      }));
      previousEvent = event;
    }
  }

  records.sort((a, b) => orderCompare(a, b) ||
    String(a.recordType).localeCompare(String(b.recordType)) ||
    String(a.associationKind || "").localeCompare(String(b.associationKind || "")));
  return { records, unresolvedIds: [...unresolvedIds].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1) };
}

function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function formatJsonl(records) {
  const ordered = [...records].sort((a, b) => orderCompare(a, b) ||
    String(a.recordType).localeCompare(String(b.recordType)) ||
    String(a.associationKind || "").localeCompare(String(b.associationKind || "")));
  return ordered.length === 0 ? "" : `${ordered.map(stableValue).join("\n")}\n`;
}

function makeSummary(config, records, unresolvedIds, jsonl) {
  const counts = { recordType: {}, status: {}, uriClass: {} };
  for (const record of records) {
    counts.recordType[record.recordType] = (counts.recordType[record.recordType] || 0) + 1;
    counts.status[record.status] = (counts.status[record.status] || 0) + 1;
    counts.uriClass[record.uriClass] = (counts.uriClass[record.uriClass] || 0) + 1;
  }
  for (const group of Object.values(counts)) {
    for (const [key, value] of Object.entries(group)) group[key] = value;
  }
  return {
    formatVersion: 1,
    network: "mainnet",
    providerLabel: config.providerLabel,
    starts: config.starts,
    fromBlock: config.fromBlock,
    toBlock: config.toBlock,
    recordCount: records.length,
    counts,
    unresolvedIds,
    jsonlSha256: crypto.createHash("sha256").update(jsonl, "utf8").digest("hex"),
  };
}

async function buildInventory(provider, config) {
  const events = await fetchEvents(provider, config);
  const createdUris = await readCreatedUris(provider, config, events);
  const replayed = replayEvents(events, createdUris);
  const jsonl = formatJsonl(replayed.records);
  return {
    jsonl,
    summary: makeSummary(config, replayed.records, replayed.unresolvedIds, jsonl),
    records: replayed.records,
  };
}

function parseOutputArgs(argv) {
  let output;
  let summary;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--output") output = argv[++i];
    else if (argv[i] === "--summary") summary = argv[++i];
    else fail("INVALID_OUTPUT_ARGUMENTS");
  }
  if (!output || !summary || output.startsWith("-") || summary.startsWith("-")) {
    fail("OUTPUT_AND_SUMMARY_REQUIRED");
  }
  const resolved = { output: path.resolve(output), summary: path.resolve(summary) };
  if (resolved.output === resolved.summary) fail("OUTPUT_PATHS_MUST_DIFFER");
  return resolved;
}

async function main() {
  const config = readConfig();
  const outputs = parseOutputArgs(process.argv.slice(2));
  const provider = new JsonRpcProvider(config.rpcUrl, 1, { staticNetwork: true });
  try {
    const inventory = await buildInventory(provider, config);
    fs.mkdirSync(path.dirname(outputs.output), { recursive: true });
    fs.mkdirSync(path.dirname(outputs.summary), { recursive: true });
    fs.writeFileSync(outputs.output, inventory.jsonl, "utf8");
    fs.writeFileSync(outputs.summary, `${stableValue(inventory.summary)}\n`, "utf8");
  } finally {
    provider.destroy();
  }
}

if (require.main === module) {
  main().catch((error) => {
    // Never print provider/RPC error text: ethers errors can contain URLs,
    // request payloads, headers, or provider internals.
    const code = error instanceof InventoryError ? error.code : "INVENTORY_FAILED";
    process.stderr.write(`inventory failed: ${code}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  classifyUri,
  formatJsonl,
  makeSummary,
  replayEvents,
  readConfig,
  buildInventory,
  stableValue,
};
