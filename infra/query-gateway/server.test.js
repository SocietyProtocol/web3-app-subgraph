const assert = require("node:assert/strict");
const http = require("node:http");
const { test, afterEach } = require("node:test");

const { PERSISTED_DOCUMENTS } = require("./generated/registry");
const {
  HEADER_TIMEOUT_MS,
  KEEP_ALIVE_TIMEOUT_MS,
  MAX_QUERY_BYTES,
  MAX_REQUEST_BYTES,
  REQUEST_TIMEOUT_MS,
  createGatewayServer,
  getOperationName,
  readConfig,
  shutdownGatewayServer,
} = require("./server");

const TEST_TOKEN = "test-gateway-token-with-at-least-32-bytes";
const NEXT_TOKEN = "next-gateway-token-with-at-least-32-bytes";
const gatewayServers = [];
const upstreamServers = [];

afterEach(async () => {
  await Promise.all(
    [...gatewayServers, ...upstreamServers].map(
      (server) =>
        new Promise((resolve) => {
          if (!server.listening) return resolve();
          server.close(() => resolve());
        }),
    ),
  );
  gatewayServers.length = 0;
  upstreamServers.length = 0;
});

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function makeGateway(upstreamHandler, overrides = {}) {
  const upstream = http.createServer(upstreamHandler);
  upstreamServers.push(upstream);
  const upstreamPort = await listen(upstream);
  const gateway = createGatewayServer({
    config: {
      upstreamUrl: `http://127.0.0.1:${upstreamPort}/subgraphs/name/society-mainnet`,
      token: TEST_TOKEN,
      ...overrides,
    },
  });
  gatewayServers.push(gateway);
  const gatewayPort = await listen(gateway);
  return `http://127.0.0.1:${gatewayPort}`;
}

function query(name) {
  return PERSISTED_DOCUMENTS[name].query;
}

async function request(baseUrl, options = {}) {
  const headers = { authorization: `Bearer ${TEST_TOKEN}`, ...options.headers };
  return fetch(`${baseUrl}${options.path || "/graphql"}`, {
    method: options.method || "POST",
    headers,
    body: options.body,
  });
}

function graphBody(name, variables) {
  const body = { query: query(name) };
  if (variables !== undefined) body.variables = variables;
  return JSON.stringify(body);
}

test("health is public and GraphQL requires the bearer token", async () => {
  const baseUrl = await makeGateway((_request, response) => response.end("should not be called"));

  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 200);
  assert.equal(await health.text(), "ok\n");

  const unauthorized = await request(baseUrl, {
    headers: { authorization: "Bearer wrong-token", "content-type": "application/json" },
    body: graphBody("Status"),
  });
  assert.equal(unauthorized.status, 401);
});

test("forwards the canonical persisted query without credentials and sanitizes errors", async () => {
  let received;
  const baseUrl = await makeGateway(async (upstreamRequest, response) => {
    received = {
      authorization: upstreamRequest.headers.authorization,
      clientSecret: upstreamRequest.headers["x-client-secret"],
      body: await new Promise((resolve) => {
        let body = "";
        upstreamRequest.on("data", (chunk) => (body += chunk));
        upstreamRequest.on("end", () => resolve(JSON.parse(body)));
      }),
    };
    response.setHeader("set-cookie", "should-not-forward");
    response.end(JSON.stringify({
      data: { status: { block: { number: 1 } } },
      errors: [{ message: "database secret", extensions: { trace: "private" } }],
    }));
  });

  const result = await request(baseUrl, {
    headers: { "content-type": "application/json; charset=utf-8", "x-client-secret": "do-not-forward" },
    body: graphBody("Status", {}),
  });
  const body = await result.json();
  assert.equal(result.status, 200);
  assert.equal(received.authorization, undefined);
  assert.equal(received.clientSecret, undefined);
  assert.deepEqual(received.body, { query: query("Status"), operationName: "Status", variables: {} });
  assert.deepEqual(body.errors, [{ message: "Upstream GraphQL error" }]);
  assert.equal(result.headers.get("set-cookie"), null);
});

test("accepts only the public health route and JSON POST GraphQL requests", async () => {
  let upstreamCalls = 0;
  const baseUrl = await makeGateway((_request, response) => {
    upstreamCalls += 1;
    response.end(JSON.stringify({ data: {} }));
  });

  const wrongMethod = await request(baseUrl, { method: "GET" });
  assert.equal(wrongMethod.status, 404);

  const wrongContentType = await request(baseUrl, {
    headers: { "content-type": "application/graphql", "x-client-secret": "do-not-forward" },
    body: graphBody("Status"),
  });
  assert.equal(wrongContentType.status, 415);
  assert.equal(upstreamCalls, 0);
});

test("requires an exact canonical persisted document, not only an allowed name", async () => {
  const baseUrl = await makeGateway((_request, response) => response.end(JSON.stringify({ data: {} })));
  const altered = query("Status").replace("number", "hash");
  const result = await request(baseUrl, {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: altered, operationName: "Status" }),
  });
  assert.equal(result.status, 400);
  assert.match(await result.text(), /approved persisted query/);
});

test("rejects oversized query strings and excess-token/deep documents before persistence lookup", async () => {
  const baseUrl = await makeGateway((_request, response) => response.end(JSON.stringify({ data: {} })));
  const oversized = await request(baseUrl, {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "x".repeat(MAX_QUERY_BYTES + 1) }),
  });
  assert.equal(oversized.status, 413);

  const excessTokens = `query Status { ${"field ".repeat(600)} }`;
  const deep = `query Status { ${"field { ".repeat(180)}leaf${" }".repeat(180)} }`;
  for (const queryText of [excessTokens, deep]) {
    assert.ok(Buffer.byteLength(queryText, "utf8") < MAX_QUERY_BYTES);
    const parsed = await request(baseUrl, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: queryText }),
    });
    assert.equal(parsed.status, 400);
  }
});

test("rejects mutations, subscriptions, introspection, and non-persisted names", async () => {
  let upstreamCalls = 0;
  const baseUrl = await makeGateway((_request, response) => {
    upstreamCalls += 1;
    response.end(JSON.stringify({ data: {} }));
  });
  const queries = [
    "mutation Badges { updateBadge { id } }",
    "subscription Status { status { id } }",
    "query Status { __schema { types { name } } }",
    "query Status { __type(name: \"Status\") { name } }",
    "query NotAllowed { status { block { number } } }",
  ];
  for (const queryText of queries) {
    const result = await request(baseUrl, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: queryText }),
    });
    assert.equal(result.status, 400, queryText);
  }
  assert.equal(upstreamCalls, 0);
});

test("enforces request, variable, upstream timeout, response, and concurrency limits", async () => {
  const oversized = await makeGateway((_request, response) => response.end(JSON.stringify({ data: {} })));
  const oversizedResult = await request(oversized, {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: query("Status"), padding: "x".repeat(MAX_REQUEST_BYTES) }),
  });
  assert.equal(oversizedResult.status, 413);

  const abuse = await makeGateway((_request, response) => response.end(JSON.stringify({ data: {} })));
  let nested = { id: "1" };
  for (let index = 0; index <= 3; index += 1) nested = { and: [nested] };
  const listVariables = { skip: 0, orderBy: "id", orderDirection: "desc" };
  for (const variables of [
    { ...listVariables, first: 1_001 },
    { ...listVariables, first: 100, where: { name_contains_nocase: "x".repeat(257) } },
    { ...listVariables, first: 100, where: { or: Array.from({ length: 33 }, () => ({ id: "1" })) } },
    { ...listVariables, first: 100, where: nested },
  ]) {
    const result = await request(abuse, {
      headers: { "content-type": "application/json" },
      body: graphBody("Badges", variables),
    });
    assert.equal(result.status, 400);
  }
  const undeclared = await request(abuse, {
    headers: { "content-type": "application/json" },
    body: graphBody("Status", { notDeclared: true }),
  });
  assert.equal(undeclared.status, 400);
  const wrongVariablesType = await request(abuse, {
    headers: { "content-type": "application/json" },
    body: graphBody("Status", []),
  });
  assert.equal(wrongVariablesType.status, 400);

  const slow = await makeGateway(async (_request, response) => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    response.end(JSON.stringify({ data: {} }));
  }, { upstreamTimeoutMs: 10 });
  const timedOut = await request(slow, {
    headers: { "content-type": "application/json" },
    body: graphBody("Status"),
  });
  assert.equal(timedOut.status, 504);

  const tooLarge = await makeGateway((_request, response) => {
    response.end(JSON.stringify({ data: "x".repeat(100) }));
  }, { upstreamResponseCap: 32 });
  const capped = await request(tooLarge, {
    headers: { "content-type": "application/json" },
    body: graphBody("Status"),
  });
  assert.equal(capped.status, 502);

  let release;
  let upstreamCalls = 0;
  const held = new Promise((resolve) => (release = resolve));
  const concurrent = await makeGateway(async (_request, response) => {
    upstreamCalls += 1;
    await held;
    response.end(JSON.stringify({ data: {} }));
  }, { maxInFlightUpstream: 1 });
  const first = request(concurrent, { headers: { "content-type": "application/json" }, body: graphBody("Status") });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const rejected = await request(concurrent, { headers: { "content-type": "application/json" }, body: graphBody("Status") });
  assert.equal(rejected.status, 503);
  release();
  assert.equal((await first).status, 200);
  assert.equal(upstreamCalls, 1);
});

test("accepts the client unaffiliated-tier Communities filter shape", async () => {
  const baseUrl = await makeGateway((_request, response) => response.end(JSON.stringify({ data: { communities: [] } })));
  const variables = {
    first: 100,
    skip: 0,
    orderBy: "tierId",
    orderDirection: "desc",
    where: {
      and: [
        {
          or: [
            { tierName_in: ["unaffiliated"], tierExpiresAt_gt: 1_700_000_000 },
            {
              or: [
                { tierName: "unaffiliated" },
                { tierExpiresAt_lt: 1_700_000_000 },
                { tierExpiresAt: null },
              ],
            },
          ],
        },
      ],
    },
  };
  const result = await request(baseUrl, {
    headers: { "content-type": "application/json" },
    body: graphBody("Communities", variables),
  });
  assert.equal(result.status, 200);

  let deepFilter = { id: "1" };
  for (let index = 0; index <= 3; index += 1) deepFilter = { and: [deepFilter] };
  const deep = await request(baseUrl, {
    headers: { "content-type": "application/json" },
    body: graphBody("Communities", { ...variables, where: deepFilter }),
  });
  assert.equal(deep.status, 400);
});

test("releases request capacity after a rejected parse", async () => {
  const baseUrl = await makeGateway((_request, response) => response.end(JSON.stringify({ data: {} })), {
    maxInFlightUpstream: 1,
  });
  const rejected = await request(baseUrl, {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: query("Status").replace("number", "hash") }),
  });
  assert.equal(rejected.status, 400);
  const accepted = await request(baseUrl, {
    headers: { "content-type": "application/json" },
    body: graphBody("Status"),
  });
  assert.equal(accepted.status, 200);
});

test("uses the request body deadline and handles token overlap", async () => {
  const baseUrl = await makeGateway((_request, response) => response.end(JSON.stringify({ data: {} })), {
    nextToken: NEXT_TOKEN,
    requestBodyTimeoutMs: 20,
  });
  const rotated = await request(baseUrl, {
    headers: { authorization: `Bearer ${NEXT_TOKEN}`, "content-type": "application/json" },
    body: graphBody("Status"),
  });
  assert.equal(rotated.status, 200);

  const gateway = gatewayServers[gatewayServers.length - 1];
  const port = gateway.address().port;
  const body = graphBody("Status");
  const timedBody = await new Promise((resolve) => {
    const client = http.request({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: "/graphql",
      headers: {
        authorization: `Bearer ${TEST_TOKEN}`,
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
        connection: "close",
      },
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    client.write(body.slice(0, 1));
    setTimeout(() => client.end(body.slice(1)), 40);
  });
  assert.equal(timedBody, 408);
});

test("propagates a client abort to the upstream request", async () => {
  let upstreamStarted;
  let upstreamAborted;
  const started = new Promise((resolve) => (upstreamStarted = resolve));
  const aborted = new Promise((resolve) => (upstreamAborted = resolve));
  const baseUrl = await makeGateway((upstreamRequest) => {
    upstreamStarted();
    upstreamRequest.once("aborted", upstreamAborted);
  });
  const controller = new AbortController();
  const pending = fetch(`${baseUrl}/graphql`, {
    method: "POST",
    headers: { authorization: `Bearer ${TEST_TOKEN}`, "content-type": "application/json" },
    body: graphBody("Status"),
    signal: controller.signal,
  });
  await started;
  controller.abort();
  await assert.rejects(pending);
  await Promise.race([
    aborted,
    new Promise((_, reject) => setTimeout(() => reject(new Error("upstream was not aborted")), 500)),
  ]);
});

test("validates tokens, production upstream policy, and canonicalization", () => {
  const base = {
    GRAPH_NODE_SUBGRAPH_URL: "http://graph-node.railway.internal:8000/subgraphs/name/society-mainnet",
    GRAPH_QUERY_GATEWAY_TOKEN: TEST_TOKEN,
    PORT: "8080",
  };
  assert.throws(() => readConfig({ ...base, GRAPH_QUERY_GATEWAY_TOKEN: "weak" }), /at least 32 UTF-8 bytes/);
  assert.throws(() => readConfig({ ...base, GRAPH_QUERY_GATEWAY_NEXT_TOKEN: "weak" }), /at least 32 UTF-8 bytes/);
  assert.throws(() => readConfig({ ...base, NODE_ENV: "production", GRAPH_NODE_SUBGRAPH_URL: "http://localhost:8000/graphql" }), /private graph-node query URL/);
  assert.throws(() => readConfig({ ...base, NODE_ENV: "production", GRAPH_NODE_SUBGRAPH_URL: `${base.GRAPH_NODE_SUBGRAPH_URL}?x=1` }), /query or fragment/);
  assert.doesNotThrow(() =>
    readConfig({
      ...base,
      NODE_ENV: "production",
      GRAPH_NODE_SUBGRAPH_URL:
        "http://graph-node-v2.railway.internal:8000/subgraphs/name/society-mainnet-v2",
    }),
  );
  assert.throws(
    () =>
      readConfig({
        ...base,
        NODE_ENV: "production",
        GRAPH_NODE_SUBGRAPH_URL: "http://graph-node-v2.railway.internal:8000/subgraphs/name/other",
      }),
    /private graph-node query URL/,
  );

  assert.equal(getOperationName(query("Users").replaceAll("\n", " ")), "Users");
  assert.throws(() => getOperationName(query("Users").replace("    name\n", "    bio\n")), /approved persisted query/);
});

test("gracefully shuts down and stops accepting new requests", async () => {
  const baseUrl = await makeGateway((_request, response) => response.end(JSON.stringify({ data: {} })));
  const gateway = gatewayServers[gatewayServers.length - 1];
  assert.equal(gateway.headersTimeout, HEADER_TIMEOUT_MS);
  assert.equal(gateway.requestTimeout, REQUEST_TIMEOUT_MS);
  assert.equal(gateway.keepAliveTimeout, KEEP_ALIVE_TIMEOUT_MS);
  await shutdownGatewayServer(gateway, 100);
  await assert.rejects(fetch(`${baseUrl}/healthz`));
});
