const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { rewriteStartBlocks } = require("./pin-start-block");

const SCRIPT = path.join(__dirname, "pin-start-block.js");
const MANIFEST = `specVersion: 0.0.7
dataSources:
  - kind: ethereum
    name: SocietyProtocolBadges
    network: sepolia
    source:
      address: "0x12406bB6d11Cb641e100F1d8595c0C5e63F0bD47"
      startBlock: 10845618
  - kind: ethereum
    name: EasyAuction
    source:
      startBlock: 9860928
  - kind: ethereum
    name: SocietyVipManager
    source:
      startBlock: 10748728
  - kind: ethereum
    name: CommunityRegistry
    source:
      startBlock: 10845623
`;

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function runScript(env, manifest = MANIFEST) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pin-start-block-"));
  const manifestPath = path.join(dir, "subgraph.yaml");
  fs.writeFileSync(manifestPath, manifest);
  const child = spawn(process.execPath, [SCRIPT], {
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      SUBGRAPH_MANIFEST_PATH: manifestPath,
      ...env,
    },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      const updated = fs.readFileSync(manifestPath, "utf8");
      fs.rmSync(dir, { recursive: true, force: true });
      resolve({ code, stdout, stderr, updated });
    });
  });
}

test("build:staging prepares sepolia, pins the head block, then builds", () => {
  const pkg = require("../package.json");
  assert.equal(
    pkg.scripts["build:staging"],
    "yarn run prepare:sepolia && SUBGRAPH_START_BLOCK=head node scripts/pin-start-block.js && graph codegen && graph build",
  );
});

test("rewrites every startBlock and leaves the other manifest lines", () => {
  const updated = rewriteStartBlocks(MANIFEST, "10601539");
  const blocks = [...updated.matchAll(/^ +startBlock: (\d+)$/gm)].map((match) => match[1]);
  assert.deepEqual(blocks, ["10601539", "10601539", "10601539", "10601539"]);
  assert.equal(updated.includes("10845618"), false);
  assert.equal(updated.includes("9860928"), false);
  assert.equal(updated.includes("10748728"), false);
  assert.equal(updated.includes("10845623"), false);
  assert.match(updated, /address: "0x12406bB6d11Cb641e100F1d8595c0C5e63F0bD47"/);
  assert.match(updated, /network: sepolia/);
});

test("rejects a manifest that has no decimal startBlock", () => {
  assert.throws(() => rewriteStartBlocks("network: sepolia\n", "10"), /no startBlock values/);
  assert.throws(
    () => rewriteStartBlocks("startBlock: \"10845618\"\n", "10"),
    /not a decimal integer/,
  );
});

test("pins every startBlock to the eth_blockNumber result", async () => {
  let body;
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000a" }));
  });
  const port = await listen(server);
  try {
    const rpcUrl = `http://127.0.0.1:${port}/rpc-secret`;
    const result = await runScript({
      SUBGRAPH_START_BLOCK: "head",
      SEPOLIA_RPC_URL: rpcUrl,
    });
    assert.equal(result.code, 0);
    assert.equal(body.method, "eth_blockNumber");
    assert.deepEqual(body.params, []);
    const blocks = [...result.updated.matchAll(/^ +startBlock: (\d+)$/gm)].map((match) => match[1]);
    assert.deepEqual(blocks, ["10", "10", "10", "10"]);
    assert.equal(result.stdout.includes("rpc-secret"), false);
    assert.equal(result.stderr.includes("rpc-secret"), false);
    assert.match(result.stdout, /Pinned subgraph.yaml startBlock values to 10/);
  } finally {
    await close(server);
  }
});

test("exits non-zero and keeps historical start blocks when the RPC call fails", async () => {
  const cases = [
    {
      name: "http error",
      handler: (_request, response) => {
        response.writeHead(500);
        response.end("no");
      },
    },
    {
      name: "rpc error",
      handler: (_request, response) => {
        response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "boom" } }));
      },
    },
    {
      name: "decimal result",
      handler: (_request, response) => {
        response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "10" }));
      },
    },
    {
      name: "missing result",
      handler: (_request, response) => {
        response.end(JSON.stringify({ jsonrpc: "2.0", id: 1 }));
      },
    },
  ];

  for (const item of cases) {
    const server = http.createServer(item.handler);
    const port = await listen(server);
    try {
      const result = await runScript({
        SUBGRAPH_START_BLOCK: "head",
        SEPOLIA_RPC_URL: `http://127.0.0.1:${port}/rpc-secret`,
      });
      assert.equal(result.code, 1, item.name);
      assert.equal(result.updated, MANIFEST, item.name);
      assert.match(result.stderr, /Error: eth_blockNumber/, item.name);
      assert.equal(result.stderr.includes("rpc-secret"), false, item.name);
      assert.equal(result.stdout, "", item.name);
    } finally {
      await close(server);
    }
  }

  const refused = await runScript({
    SUBGRAPH_START_BLOCK: "head",
    SEPOLIA_RPC_URL: "http://127.0.0.1:1",
  });
  assert.equal(refused.code, 1);
  assert.equal(refused.updated, MANIFEST);
  assert.match(refused.stderr, /Error: eth_blockNumber request failed/);
});

test("does not fall back when SUBGRAPH_START_BLOCK is not head", async () => {
  let calls = 0;
  const server = http.createServer((_request, response) => {
    calls += 1;
    response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x10" }));
  });
  const port = await listen(server);
  try {
    for (const value of [undefined, "", "10845618", "HEAD"]) {
      const env = { SEPOLIA_RPC_URL: `http://127.0.0.1:${port}` };
      if (value !== undefined) env.SUBGRAPH_START_BLOCK = value;
      const result = await runScript(env);
      assert.equal(result.code, 1, String(value));
      assert.equal(result.updated, MANIFEST, String(value));
      assert.match(result.stderr, /SUBGRAPH_START_BLOCK must be head/);
    }
    assert.equal(calls, 0);
  } finally {
    await close(server);
  }
});
