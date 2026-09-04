const assert = require("node:assert/strict");
const test = require("node:test");
const { Interface } = require("ethers");
const {
  buildInventory,
  classifyUri,
  formatJsonl,
  readConfig,
  replayEvents,
} = require("./inventory-metadata-uris");

const badges = new Interface(
  require("../abis/SocietyProtocolBadges.json"),
);
const registry = new Interface(require("../abis/CommunityRegistry.json"));
const BADGE_ADDRESS = "0x2313C0cDdc233c92d16c2cfE17DF5fDCcE556763";
const REGISTRY_ADDRESS = "0xEa008f15E1454C79D6AA7B95Dd3E1d39Ba32EB76";
const USER = "0x00000000000000000000000000000000000000a1";
const CREATOR = "0x00000000000000000000000000000000000000b2";
const HASHES = [
  "0x" + "11".repeat(32),
  "0x" + "22".repeat(32),
  "0x" + "33".repeat(32),
  "0x" + "44".repeat(32),
];

function eventLog(iface, name, args, blockNumber, transactionIndex, logIndex, transactionHash) {
  const encoded = iface.encodeEventLog(iface.getEvent(name), args);
  return {
    address: iface === badges ? BADGE_ADDRESS : REGISTRY_ADDRESS,
    topics: encoded.topics,
    data: encoded.data,
    blockNumber,
    transactionIndex,
    index: logIndex,
    transactionHash,
  };
}

function config() {
  return {
    fromBlock: 100,
    toBlock: 110,
    starts: { SocietyProtocolBadges: 25128949, CommunityRegistry: 25102724 },
    addresses: { SocietyProtocolBadges: BADGE_ADDRESS, CommunityRegistry: REGISTRY_ADDRESS },
    providerLabel: "test-archive",
  };
}

function fixtureProvider() {
  const badgeCreated = eventLog(
    badges,
    "BadgeCreated",
    [1n, "Community Manager", false, true, CREATOR],
    100,
    3,
    1,
    HASHES[0],
  );
  const profileCreated = eventLog(
    badges,
    "ProfileCreated",
    [USER, 1n],
    101,
    0,
    0,
    HASHES[1],
  );
  const linked = eventLog(
    registry,
    "CommunityBadgeCreated",
    [1n, 1n],
    102,
    0,
    0,
    HASHES[2],
  );
  const communityCreated = eventLog(
    registry,
    "CommunityCreated",
    [1n, CREATOR, 2n, 3n],
    103,
    0,
    0,
    HASHES[3],
  );
  const logs = [badgeCreated, profileCreated, linked, communityCreated];
  const topics = new Map();
  for (const log of logs) topics.set(log.topics[0], [log]);
  const calls = [];
  const ranges = [];
  return {
    calls,
    ranges,
    provider: {
      async getLogs(filter) {
        ranges.push({ topic: filter.topics[0], fromBlock: filter.fromBlock, toBlock: filter.toBlock });
        return (topics.get(filter.topics[0]) || []).filter(
          (log) => log.blockNumber >= filter.fromBlock && log.blockNumber <= filter.toBlock,
        );
      },
      async call(_request, blockTag) {
        calls.push(blockTag);
        return badges.encodeFunctionResult("uri", ["ipfs://Qm" + "a".repeat(44)]);
      },
    },
  };
}

test("replays in block/transaction/log order and reads uri at the creation block", async () => {
  const fixture = fixtureProvider();
  const inventory = await buildInventory(fixture.provider, config());
  assert.deepEqual(fixture.calls, [100]);
  assert.deepEqual(
    inventory.records.map((record) => [record.blockNumber, record.transactionIndex, record.logIndex]),
    [[100, 3, 1], [101, 0, 0], [103, 0, 0]],
  );
  assert.equal(inventory.records[1].associationKind, "profile-badge");
  assert.equal(inventory.records[2].associationKind, "community-manager-badge");
  assert.equal(inventory.records[2].managerBadgeId, "1");
});

test("merges multi-chunk event results into global order", async () => {
  const fixture = fixtureProvider();
  const scan = { ...config(), logChunkSize: 1 };
  const inventory = await buildInventory(fixture.provider, scan);
  assert.deepEqual(
    inventory.records.map((record) => record.blockNumber),
    [100, 101, 103],
  );
  assert.ok(fixture.ranges.length > 6, "fixture should require multiple chunks");
  assert.ok(fixture.ranges.every((range) => range.fromBlock === range.toBlock));
});

test("covers chunk boundaries exactly once", async () => {
  const fixture = fixtureProvider();
  await buildInventory(fixture.provider, { ...config(), logChunkSize: 2 });
  const byTopic = new Map();
  for (const range of fixture.ranges) {
    const ranges = byTopic.get(range.topic) || [];
    ranges.push([range.fromBlock, range.toBlock]);
    byTopic.set(range.topic, ranges);
  }
  for (const ranges of byTopic.values()) {
    assert.deepEqual(ranges, [[100, 101], [102, 103], [104, 105], [106, 107], [108, 109], [110, 110]]);
  }
});

test("rejects invalid log chunk configuration", () => {
  const base = {
    ETH_MAINNET_ARCHIVE_RPC_URL: "https://archive.example.invalid/",
    FROM_BLOCK: "100",
    TO_BLOCK: "110",
  };
  for (const value of ["0", "1.5", "10001", " 10"]) {
    assert.throws(() => readConfig({ ...base, LOG_CHUNK_SIZE: value }), /INVALID_LOG_CHUNK_SIZE/);
  }
  assert.equal(readConfig(base).logChunkSize, 5000);
});

test("classifies all URI/status classes without fetching content", () => {
  assert.deepEqual(classifyUri("ipfs://Qm" + "a".repeat(44)), { uriClass: "ipfs", status: "resolved" });
  assert.deepEqual(classifyUri("ipfs://"), { uriClass: "ipfs", status: "unsupported" });
  assert.deepEqual(classifyUri("https://gateway.example/ipfs/Qm" + "a".repeat(44) + "?x=1"), { uriClass: "ipfs", status: "resolved" });
  assert.deepEqual(classifyUri("ipns://name"), { uriClass: "ipns", status: "unsupported" });
  assert.deepEqual(classifyUri("data:application/json,{}"), { uriClass: "data", status: "unsupported" });
  assert.deepEqual(classifyUri("Qm" + "a".repeat(44)), { uriClass: "bare-cid", status: "unsupported" });
  assert.deepEqual(classifyUri(""), { uriClass: "empty", status: "empty" });
  assert.deepEqual(classifyUri(null), { uriClass: "unknown", status: "missing" });
});

test("fails closed when required badge state is not present in the replay", () => {
  const event = {
    sourceKind: "ProfileCreated",
    args: { user: USER, id: 404n },
    blockNumber: 2,
    transactionIndex: 0,
    logIndex: 0,
    transactionHash: HASHES[0],
  };
  assert.throws(() => replayEvents([event], new Map()), /PROFILE_BADGE_STATE_UNRESOLVED/);
});

test("fails closed when an event-block URI read is unavailable", async () => {
  const fixture = fixtureProvider();
  fixture.provider.call = async () => {
    throw new Error("provider response contains a secret");
  };
  await assert.rejects(buildInventory(fixture.provider, config()), /HISTORICAL_URI_READ_FAILED/);
});

test("sanitizes chunked log-fetch failures", async () => {
  const secret = "rpc-key-must-not-escape";
  const fixture = fixtureProvider();
  fixture.provider.getLogs = async () => {
    throw new Error(`request failed for ${secret}`);
  };
  await assert.rejects(
    buildInventory(fixture.provider, { ...config(), logChunkSize: 1 }),
    (error) => error.message === "RPC_LOG_FETCH_FAILED" && !error.message.includes(secret),
  );
});

test("marks a contradictory modify/URI pair as a conflict", () => {
  const first = {
    sourceKind: "BadgeCreated",
    args: { id: 1n },
    blockNumber: 1,
    transactionIndex: 0,
    logIndex: 0,
    transactionHash: HASHES[0],
  };
  const modified = {
    sourceKind: "BadgeModified",
    args: { id: 1n, metadataURI: "ipfs://one" },
    blockNumber: 2,
    transactionIndex: 0,
    logIndex: 0,
    transactionHash: HASHES[1],
  };
  const uri = {
    sourceKind: "URI",
    args: { id: 1n, value: "ipfs://two" },
    blockNumber: 2,
    transactionIndex: 0,
    logIndex: 1,
    transactionHash: HASHES[1],
  };
  const result = replayEvents([uri, modified, first], new Map([["1:0:0", "ipfs://created"]]));
  assert.equal(result.records[1].status, "conflict");
  assert.equal(result.records[2].status, "conflict");
});

test("JSONL and checksum input are deterministic", async () => {
  const first = await buildInventory(fixtureProvider().provider, config());
  const second = await buildInventory(fixtureProvider().provider, config());
  assert.equal(first.jsonl, second.jsonl);
  assert.deepEqual(first.summary, second.summary);
  assert.equal(formatJsonl(first.records), first.jsonl);
});

test("redaction path exposes only a stable error code", () => {
  const secret = "https://rpc.example.invalid/key-do-not-print";
  const child = require("node:child_process").spawnSync(
    process.execPath,
    [require("node:path").join(__dirname, "inventory-metadata-uris.js"), "--output", "/tmp/a", "--summary", "/tmp/b"],
    { encoding: "utf8", env: { ...process.env, ETH_MAINNET_ARCHIVE_RPC_URL: secret, FROM_BLOCK: "bad", TO_BLOCK: "1" } },
  );
  assert.equal(child.status, 1);
  assert.match(child.stderr, /inventory failed: INVALID_FROM_BLOCK/);
  assert.doesNotMatch(child.stderr, /rpc\.example|do-not-print/);
});
