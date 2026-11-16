const assert = require("node:assert/strict");
const http = require("node:http");
const { test, afterEach } = require("node:test");

const { PERSISTED_DOCUMENTS } = require("./generated/registry");
const {
  HEADER_TIMEOUT_MS,
  KEEP_ALIVE_TIMEOUT_MS,
  MAX_IN_FLIGHT_UPSTREAM,
  MAX_QUERY_BYTES,
  MAX_QUEUED_UPSTREAM,
  MAX_REQUEST_BYTES,
  QUEUE_WAIT_MS,
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
      log: () => {},
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

test("accepts Users protocol role filters", async () => {
  let received;
  const baseUrl = await makeGateway(async (upstreamRequest, response) => {
    received = await new Promise((resolve) => {
      let body = "";
      upstreamRequest.on("data", (chunk) => (body += chunk));
      upstreamRequest.on("end", () => resolve(JSON.parse(body)));
    });
    response.end(JSON.stringify({ data: { users: [] } }));
  });

  const result = await request(baseUrl, {
    headers: { "content-type": "application/json" },
    body: graphBody("Users", {
      first: 5,
      skip: 0,
      orderBy: "profile__createdAt",
      orderDirection: "desc",
      where: {
        and: [
          { profile_not: null },
          { protocolRoles_contains: ["GOVERNOR"] },
        ],
      },
    }),
  });
  assert.equal(result.status, 200);
  assert.deepEqual(received.variables.where.and[1], {
    protocolRoles_contains: ["GOVERNOR"],
  });
});

const address = (i) => `0x${i.toString(16).padStart(40, "0")}`;

test("accepts the smart-account legacy filters the app sends", async () => {
  const baseUrl = await makeGateway(async (_upstreamRequest, response) => {
    response.end(JSON.stringify({ data: { users: [], badges: [], communities: [] } }));
  });
  const page = { first: 5, skip: 0, orderDirection: "desc" };
  const legacy = Array.from({ length: 35 }, (_, i) => address(i + 1));
  const owners = [address(100), address(101)];
  const bodies = [
    graphBody("Users", {
      ...page,
      first: 1000,
      orderBy: "profile__createdAt",
      where: { id_in: legacy, profile_not: null },
    }),
    graphBody("Users", {
      ...page,
      orderBy: "profile__createdAt",
      where: { and: [{ profile_not: null }, { id_not_in: legacy }] },
    }),
    graphBody("Badges", {
      ...page,
      orderBy: "createdAt",
      where: { and: [{ managers_: { id_in: owners } }] },
    }),
    graphBody("Communities", {
      ...page,
      orderBy: "createdAt",
      where: { and: [{ manager_: { id_in: owners } }] },
    }),
  ];
  for (const body of bodies) {
    const result = await request(baseUrl, { headers: { "content-type": "application/json" }, body });
    assert.equal(result.status, 200, body.slice(0, 80));
  }
});

test("strips data-URI photos from upstream GraphQL data", async () => {
  const { stripDataUriImages } = require("./server");
  const stripped = stripDataUriImages({
    users: [{ imageUrl: "data:image/jpeg;base64,abc", name: "Ada" }],
  });
  assert.equal(stripped.users[0].imageUrl, null);
  assert.equal(stripped.users[0].name, "Ada");
});

test("fills null photos from the entity id map", async () => {
  const { stripDataUriImages } = require("./server");
  const entityCids = require("./generated/image-entity-cids.json");
  const entityId = Object.keys(entityCids).find((key) => key.startsWith("0x"));
  assert.ok(entityId);
  const stripped = stripDataUriImages({
    users: [
      {
        id: entityId,
        name: "Ada",
        imageUrl: null,
        metadata: { name: "Ada", imageUrl: null },
        profile: { id: "48" },
      },
    ],
  });
  assert.equal(stripped.users[0].imageUrl, entityCids[entityId]);
  assert.equal(stripped.users[0].metadata.imageUrl, entityCids[entityId]);
  assert.deepEqual(stripped.users[0].profile, { id: "48" });
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
  }, { maxInFlightUpstream: 1, maxQueuedUpstream: 0 });
  const first = request(concurrent, { headers: { "content-type": "application/json" }, body: graphBody("Status") });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const rejected = await request(concurrent, { headers: { "content-type": "application/json" }, body: graphBody("Status") });
  assert.equal(rejected.status, 503);
  assert.equal(rejected.headers.get("retry-after"), "1");
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
  assert.doesNotThrow(() =>
    readConfig({
      ...base,
      NODE_ENV: "production",
      GRAPH_NODE_SUBGRAPH_URL:
        "http://prod-graph-node:8000/subgraphs/name/society-mainnet-v2",
    }),
  );
  assert.doesNotThrow(() =>
    readConfig({
      ...base,
      NODE_ENV: "production",
      GRAPH_NODE_SUBGRAPH_URL:
        "http://staging-graph-node:8000/subgraphs/name/society-sepolia",
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

test("accepts the staging graph-node URL and rejects an unknown host", () => {
  const base = {
    GRAPH_NODE_SUBGRAPH_URL: "http://graph-node.railway.internal:8000/subgraphs/name/society-mainnet",
    GRAPH_QUERY_GATEWAY_TOKEN: TEST_TOKEN,
    PORT: "8080",
    NODE_ENV: "production",
  };
  const staging = readConfig({
    ...base,
    GRAPH_NODE_SUBGRAPH_URL:
      "http://graph-node-staging.railway.internal:8000/subgraphs/name/society-sepolia",
  });
  assert.equal(
    staging.upstreamUrl.href,
    "http://graph-node-staging.railway.internal:8000/subgraphs/name/society-sepolia",
  );
  assert.throws(
    () =>
      readConfig({
        ...base,
        GRAPH_NODE_SUBGRAPH_URL: "http://unknown.example:8000/subgraphs/name/society-sepolia",
      }),
    /private graph-node query URL/,
  );
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

function heldUpstream() {
  let calls = 0;
  const releases = [];
  const handler = (_request, response) => {
    calls += 1;
    releases.push(() => response.end(JSON.stringify({ data: {} })));
  };
  return {
    handler,
    calls: () => calls,
    releaseOne: () => releases.shift()(),
    releaseAll: () => {
      while (releases.length) releases.shift()();
    },
  };
}

async function until(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition was not met in time");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const statusRequest = (baseUrl) =>
  request(baseUrl, { headers: { "content-type": "application/json" }, body: graphBody("Status") });

test("a request over the in-flight cap waits in the queue and then succeeds", async () => {
  const upstream = heldUpstream();
  const baseUrl = await makeGateway(upstream.handler, { maxInFlightUpstream: 2, queueWaitMs: 2_000 });
  const gateway = gatewayServers[gatewayServers.length - 1];

  const pending = Array.from({ length: 5 }, () => statusRequest(baseUrl));
  await until(() => upstream.calls() === 2 && gateway.gatewayState.waiters.length === 3);
  assert.equal(gateway.gatewayState.inFlight, 2);

  // Each finished request hands its slot to the oldest waiter.
  upstream.releaseOne();
  await until(() => upstream.calls() === 3);
  assert.equal(gateway.gatewayState.inFlight, 2);
  assert.equal(gateway.gatewayState.waiters.length, 2);

  const drain = setInterval(() => upstream.releaseAll(), 5);
  try {
    const statuses = (await Promise.all(pending)).map((result) => result.status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 200]);
  } finally {
    clearInterval(drain);
  }
  assert.equal(upstream.calls(), 5);
  assert.equal(gateway.gatewayState.inFlight, 0);
  assert.equal(gateway.gatewayState.waiters.length, 0);
});

test("a queued request that waits too long gets 503 with Retry-After and is logged", async () => {
  const upstream = heldUpstream();
  const lines = [];
  const baseUrl = await makeGateway(upstream.handler, {
    maxInFlightUpstream: 1,
    queueWaitMs: 30,
    log: (line) => lines.push(line),
  });
  const gateway = gatewayServers[gatewayServers.length - 1];

  const first = statusRequest(baseUrl);
  await until(() => upstream.calls() === 1);
  const waited = await request(baseUrl, {
    headers: { "content-type": "application/json" },
    body: graphBody("Users", { first: 5, skip: 0, orderBy: "profile__createdAt", orderDirection: "desc", where: { name_contains_nocase: "secret-search-term" } }),
  });
  assert.equal(waited.status, 503);
  assert.equal(waited.headers.get("retry-after"), "1");
  assert.deepEqual(await waited.json(), { errors: [{ message: "Query gateway is busy" }] });
  assert.equal(gateway.gatewayState.waiters.length, 0);

  upstream.releaseAll();
  assert.equal((await first).status, 200);
  assert.equal(upstream.calls(), 1);

  assert.equal(lines.length, 1);
  assert.match(lines[0], /^query-gateway error op=Users status=503 reason="Query gateway is busy" inFlight=1 queued=0 waitedMs=\d+$/);
  assert.doesNotMatch(lines[0], /secret-search-term|Bearer|token/);
});

test("a full queue answers 503 at once", async () => {
  const upstream = heldUpstream();
  const baseUrl = await makeGateway(upstream.handler, {
    maxInFlightUpstream: 1,
    maxQueuedUpstream: 1,
    queueWaitMs: 5_000,
  });
  const gateway = gatewayServers[gatewayServers.length - 1];

  const first = statusRequest(baseUrl);
  await until(() => upstream.calls() === 1);
  const queued = statusRequest(baseUrl);
  await until(() => gateway.gatewayState.waiters.length === 1);

  const startedAt = Date.now();
  const overflow = await statusRequest(baseUrl);
  assert.equal(overflow.status, 503);
  assert.ok(Date.now() - startedAt < 1_000);

  const drain = setInterval(() => upstream.releaseAll(), 5);
  try {
    assert.equal((await first).status, 200);
    assert.equal((await queued).status, 200);
  } finally {
    clearInterval(drain);
  }
});

test("a client that disconnects while queued leaves the queue without reaching upstream", async () => {
  const upstream = heldUpstream();
  const lines = [];
  const baseUrl = await makeGateway(upstream.handler, {
    maxInFlightUpstream: 1,
    queueWaitMs: 5_000,
    log: (line) => lines.push(line),
  });
  const gateway = gatewayServers[gatewayServers.length - 1];

  const first = statusRequest(baseUrl);
  await until(() => upstream.calls() === 1);
  const body = graphBody("Status");
  const abandoned = http.request({
    host: "127.0.0.1",
    port: gateway.address().port,
    method: "POST",
    path: "/graphql",
    agent: false,
    headers: {
      authorization: `Bearer ${TEST_TOKEN}`,
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    },
  });
  abandoned.on("error", () => {});
  abandoned.end(body);
  await until(() => gateway.gatewayState.waiters.length === 1);
  abandoned.destroy();
  await until(() => gateway.gatewayState.waiters.length === 0);

  upstream.releaseAll();
  assert.equal((await first).status, 200);
  assert.equal(upstream.calls(), 1);
  assert.equal(gateway.gatewayState.inFlight, 0);
  assert.deepEqual(lines, []);
});

test("shutdown answers queued requests with 503", async () => {
  const upstream = heldUpstream();
  const baseUrl = await makeGateway(upstream.handler, { maxInFlightUpstream: 1, queueWaitMs: 5_000 });
  const gateway = gatewayServers[gatewayServers.length - 1];

  const first = statusRequest(baseUrl);
  await until(() => upstream.calls() === 1);
  const queued = statusRequest(baseUrl);
  await until(() => gateway.gatewayState.waiters.length === 1);

  const shutdown = shutdownGatewayServer(gateway, 1_000);
  const queuedResult = await queued;
  assert.equal(queuedResult.status, 503);
  assert.deepEqual(await queuedResult.json(), { errors: [{ message: "Query gateway is shutting down" }] });
  upstream.releaseAll();
  assert.equal((await first).status, 200);
  await shutdown;
});

test("logs upstream failures and refusals in one line without variables", async () => {
  const lines = [];
  const failing = await makeGateway((_request, response) => {
    response.statusCode = 500;
    response.end(JSON.stringify({ errors: [{ message: "store error" }] }));
  }, { log: (line) => lines.push(line) });
  const failed = await request(failing, {
    headers: { "content-type": "application/json" },
    body: graphBody("Users", { first: 5, skip: 0, orderBy: "profile__createdAt", orderDirection: "desc", where: { name_contains_nocase: "private-name" } }),
  });
  assert.equal(failed.status, 500);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^query-gateway error op=Users status=500 reason="upstream answered with an error status" inFlight=1 queued=0 upstreamMs=\d+$/);

  const unreachable = await makeGateway((_request, response) => response.destroy(), { log: (line) => lines.push(line) });
  const broken = await statusRequest(unreachable);
  assert.equal(broken.status, 502);
  assert.match(lines[1], /^query-gateway error op=Status status=502 reason="Upstream GraphQL request failed" inFlight=\d+ queued=0 upstreamMs=\d+$/);

  const refused = await request(unreachable, {
    headers: { "content-type": "application/json" },
    body: graphBody("Badges", { first: 1_001, skip: 0, orderBy: "id", orderDirection: "desc", where: { name_contains_nocase: "private-name" } }),
  });
  assert.equal(refused.status, 400);
  assert.match(lines[2], /^query-gateway refused op=- status=400 reason="GraphQL variables exceed operation limits" inFlight=0 queued=0$/);

  for (const line of lines) {
    assert.equal(line.includes("\n"), false);
    assert.doesNotMatch(line, /private-name|Bearer|test-gateway-token/);
  }
});

test("reads the in-flight cap and queue limits from the environment", () => {
  const base = {
    GRAPH_NODE_SUBGRAPH_URL: "http://127.0.0.1:8000/subgraphs/name/society-mainnet",
    GRAPH_QUERY_GATEWAY_TOKEN: TEST_TOKEN,
  };
  const defaults = readConfig(base);
  assert.equal(defaults.maxInFlightUpstream, MAX_IN_FLIGHT_UPSTREAM);
  assert.equal(MAX_IN_FLIGHT_UPSTREAM, 32);
  assert.equal(defaults.maxQueuedUpstream, MAX_QUEUED_UPSTREAM);
  assert.equal(defaults.queueWaitMs, QUEUE_WAIT_MS);

  const tuned = readConfig({
    ...base,
    GRAPH_QUERY_GATEWAY_MAX_IN_FLIGHT: "48",
    GRAPH_QUERY_GATEWAY_MAX_QUEUED: "0",
    GRAPH_QUERY_GATEWAY_QUEUE_WAIT_MS: "2500",
  });
  assert.equal(tuned.maxInFlightUpstream, 48);
  assert.equal(tuned.maxQueuedUpstream, 0);
  assert.equal(tuned.queueWaitMs, 2500);
  assert.equal(readConfig({ ...base, GRAPH_QUERY_GATEWAY_MAX_IN_FLIGHT: "" }).maxInFlightUpstream, 32);

  for (const [name, value] of [
    ["GRAPH_QUERY_GATEWAY_MAX_IN_FLIGHT", "0"],
    ["GRAPH_QUERY_GATEWAY_MAX_IN_FLIGHT", "abc"],
    ["GRAPH_QUERY_GATEWAY_MAX_IN_FLIGHT", "1.5"],
    ["GRAPH_QUERY_GATEWAY_MAX_QUEUED", "-1"],
    ["GRAPH_QUERY_GATEWAY_QUEUE_WAIT_MS", "60000"],
  ]) {
    assert.throws(() => readConfig({ ...base, [name]: value }), new RegExp(`${name} must be an integer`));
  }
});
