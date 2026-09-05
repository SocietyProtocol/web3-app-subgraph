const http = require("node:http");
const { createHash, timingSafeEqual } = require("node:crypto");
const { Kind, parse, print, visit } = require("graphql");

const { PERSISTED_DOCUMENTS } = require("./generated/registry");

const MAX_REQUEST_BYTES = 128 * 1024;
const MAX_UPSTREAM_RESPONSE_BYTES = 2 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 8_000;
const HEADER_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;
const KEEP_ALIVE_TIMEOUT_MS = 5_000;
const REQUEST_BODY_TIMEOUT_MS = 10_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;
const MAX_IN_FLIGHT_UPSTREAM = 16;
const MAX_QUERY_BYTES = 8 * 1024;
const MAX_GRAPHQL_TOKENS = 512;

const ALLOWED_OPERATION_NAMES = new Set(Object.keys(PERSISTED_DOCUMENTS));

class GatewayError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.publicMessage = message;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function tokenDigest(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function validateToken(token, variableName) {
  if (typeof token !== "string" || Buffer.byteLength(token, "utf8") < 32) {
    throw new Error(`${variableName} must be at least 32 UTF-8 bytes`);
  }
  return tokenDigest(token);
}

function validateUpstreamUrl(value, nodeEnv) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("GRAPH_NODE_SUBGRAPH_URL is required");
  }

  let upstreamUrl;
  try {
    upstreamUrl = new URL(value);
  } catch {
    throw new Error("GRAPH_NODE_SUBGRAPH_URL must be an absolute HTTP(S) URL");
  }
  if (
    !["http:", "https:"].includes(upstreamUrl.protocol) ||
    upstreamUrl.username !== "" ||
    upstreamUrl.password !== ""
  ) {
    throw new Error("GRAPH_NODE_SUBGRAPH_URL must be an absolute HTTP(S) URL without credentials");
  }
  if (upstreamUrl.search !== "" || upstreamUrl.hash !== "") {
    throw new Error("GRAPH_NODE_SUBGRAPH_URL must not contain a query or fragment");
  }

  if (nodeEnv === "production") {
    const allowedHost =
      upstreamUrl.hostname === "graph-node.railway.internal" ||
      upstreamUrl.hostname === "graph-node-v2.railway.internal";
    const allowedPath =
      upstreamUrl.pathname === "/subgraphs/name/society-mainnet" ||
      upstreamUrl.pathname === "/subgraphs/name/society-mainnet-v2";
    if (
      upstreamUrl.protocol !== "http:" ||
      upstreamUrl.port !== "8000" ||
      !allowedHost ||
      !allowedPath
    ) {
      throw new Error("Production GRAPH_NODE_SUBGRAPH_URL must be the private graph-node query URL");
    }
  }
  return upstreamUrl;
}

function readConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || "development";
  const upstreamUrl = validateUpstreamUrl(env.GRAPH_NODE_SUBGRAPH_URL, nodeEnv);
  const tokenDigests = [validateToken(env.GRAPH_QUERY_GATEWAY_TOKEN, "GRAPH_QUERY_GATEWAY_TOKEN")];
  if (env.GRAPH_QUERY_GATEWAY_NEXT_TOKEN !== undefined) {
    tokenDigests.push(validateToken(env.GRAPH_QUERY_GATEWAY_NEXT_TOKEN, "GRAPH_QUERY_GATEWAY_NEXT_TOKEN"));
  }

  const portValue = env.PORT === undefined || env.PORT === "" ? "8080" : env.PORT;
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }

  return {
    nodeEnv,
    upstreamUrl,
    tokenDigests: Object.freeze(tokenDigests),
    port,
  };
}

function tokenMatches(providedToken, expectedDigest) {
  const providedDigest = Buffer.from(tokenDigest(providedToken), "hex");
  const expected = Buffer.from(expectedDigest, "hex");
  return providedDigest.length === expected.length && timingSafeEqual(providedDigest, expected);
}

function isAuthorized(request, tokenDigests) {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return false;
  const providedToken = authorization.slice("Bearer ".length);
  if (providedToken.length === 0) return false;

  let matched = false;
  for (const expectedDigest of tokenDigests) {
    // Evaluate every configured digest to avoid revealing which rotation slot matched.
    matched = tokenMatches(providedToken, expectedDigest) || matched;
  }
  return matched;
}

function rejectIntrospection(document) {
  let found = false;
  visit(document, {
    Field(node) {
      if (node.name.value === "__schema" || node.name.value === "__type") found = true;
    },
  });
  return found;
}

function canonicalizeApprovedDocument(query) {
  let document;
  try {
    document = parse(query, { maxTokens: MAX_GRAPHQL_TOKENS });
  } catch {
    throw new GatewayError(400, "Invalid GraphQL request");
  }

  if (rejectIntrospection(document)) throw new GatewayError(400, "Introspection is not allowed");
  const operations = document.definitions.filter((definition) => definition.kind === Kind.OPERATION_DEFINITION);
  if (operations.length !== 1) throw new GatewayError(400, "Only one named query is allowed");

  const operation = operations[0];
  if (operation.operation !== "query" || !operation.name) {
    throw new GatewayError(400, "Only named queries are allowed");
  }

  const operationName = operation.name.value;
  const persisted = Object.hasOwn(PERSISTED_DOCUMENTS, operationName)
    ? PERSISTED_DOCUMENTS[operationName]
    : undefined;
  const canonicalQuery = print(document);
  if (
    !persisted ||
    canonicalQuery !== persisted.query ||
    tokenDigest(canonicalQuery) !== persisted.sha256
  ) {
    throw new GatewayError(400, "GraphQL document is not an approved persisted query");
  }
  return { operationName, query: persisted.query };
}

function variableLimitError() {
  return new GatewayError(400, "GraphQL variables exceed operation limits");
}

function validateFilterValue(value, depth, policy, counters) {
  counters.nodes += 1;
  if (counters.nodes > policy.maxNodes || depth > policy.maxDepth) throw variableLimitError();
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") > policy.maxStringBytes) throw variableLimitError();
    return;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Math.abs(value) > policy.maxNumericValue) throw variableLimitError();
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > policy.maxArrayLength) throw variableLimitError();
    for (const item of value) validateFilterValue(item, depth + 1, policy, counters);
    return;
  }
  if (!isPlainObject(value) || Object.keys(value).length > policy.maxObjectKeys) throw variableLimitError();
  for (const [key, item] of Object.entries(value)) {
    if (Buffer.byteLength(key, "utf8") > 128 || !policy.allowedKeys.includes(key)) throw variableLimitError();
    validateFilterValue(item, depth + 1, policy, counters);
  }
}

function validateScalarValue(value, definition, limits) {
  if (value === null) {
    if (definition.required) throw variableLimitError();
    return;
  }
  if (definition.kind === "integer") {
    if (!Number.isSafeInteger(value) || value < definition.min || value > definition.max) throw variableLimitError();
    return;
  }
  if (definition.kind === "enum") {
    if (typeof value !== "string" || !definition.allowedValues.includes(value)) throw variableLimitError();
    return;
  }
  if (definition.kind === "id") {
    if (typeof value !== "string" && (!Number.isSafeInteger(value) || value < 0 || value > limits.maxNumericValue)) {
      throw variableLimitError();
    }
  } else if (definition.kind === "bigint") {
    if (typeof value === "string") {
      if (!/^[0-9]+$/.test(value) || value.length > definition.maxDigits) throw variableLimitError();
    } else if (!Number.isSafeInteger(value) || value < 0 || value > limits.maxNumericValue) {
      throw variableLimitError();
    }
  } else if (definition.kind === "bytes") {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) throw variableLimitError();
  } else if (definition.kind === "string") {
    if (typeof value !== "string") throw variableLimitError();
  } else if (definition.kind === "filter") {
    validateFilterValue(value, 0, { ...limits, ...definition }, { nodes: 0 });
    return;
  }
  if (typeof value === "string" && Buffer.byteLength(value, "utf8") > definition.maxStringBytes) {
    throw variableLimitError();
  }
}

function validateVariables(variables, persisted) {
  const policy = persisted.variablePolicy;
  if (variables === undefined) {
    if (Object.values(policy.variables).some((definition) => definition.required)) throw variableLimitError();
    return;
  }
  if (!isPlainObject(variables)) throw variableLimitError();
  const serialized = JSON.stringify(variables);
  if (Buffer.byteLength(serialized, "utf8") > policy.maxPayloadBytes) throw variableLimitError();
  for (const name of Object.keys(variables)) {
    if (!Object.hasOwn(policy.variables, name)) throw new GatewayError(400, "Undeclared GraphQL variable");
  }
  for (const [name, definition] of Object.entries(policy.variables)) {
    if (definition.required && !Object.hasOwn(variables, name)) throw variableLimitError();
    if (Object.hasOwn(variables, name)) validateScalarValue(variables[name], definition, policy);
  }
}

function readRequestBody(request, timeoutMs = REQUEST_BODY_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const chunks = [];
    const timer = setTimeout(() => fail(new GatewayError(408, "Request body timed out")), timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      request.removeListener("aborted", onAborted);
      request.removeListener("error", onError);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      request.resume();
      reject(error);
    };
    const onAborted = () => fail(new GatewayError(408, "Request body aborted"));
    const onError = () => fail(new GatewayError(400, "Request body could not be read"));

    request.on("aborted", onAborted);
    request.on("error", onError);
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        fail(new GatewayError(413, "Request body is too large"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

function consumeRequestBody(request) {
  if (!request.readableEnded && !request.destroyed) request.resume();
}

function parseGraphQLRequest(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new GatewayError(400, "Request body must be valid JSON");
  }
  if (!isPlainObject(parsed)) throw new GatewayError(400, "Request body must be a JSON object");

  const allowedKeys = new Set(["query", "variables", "operationName"]);
  if (Object.keys(parsed).some((key) => !allowedKeys.has(key))) {
    throw new GatewayError(400, "Unsupported GraphQL request field");
  }
  if (typeof parsed.query !== "string" || parsed.query.length === 0) {
    throw new GatewayError(400, "A GraphQL query is required");
  }
  if (Buffer.byteLength(parsed.query, "utf8") > MAX_QUERY_BYTES) {
    throw new GatewayError(413, "GraphQL query is too large");
  }

  const approved = canonicalizeApprovedDocument(parsed.query);
  if (parsed.operationName !== undefined && parsed.operationName !== approved.operationName) {
    throw new GatewayError(400, "Operation name does not match the query");
  }
  validateVariables(parsed.variables, PERSISTED_DOCUMENTS[approved.operationName]);

  const forward = { query: approved.query, operationName: approved.operationName };
  if (parsed.variables !== undefined) forward.variables = parsed.variables;
  return forward;
}

async function readUpstreamBody(response, controller, responseCap) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > responseCap) {
      controller.abort();
      throw new GatewayError(502, "Upstream response is too large");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function sanitizeGraphQLErrors(errors) {
  if (!Array.isArray(errors)) throw new GatewayError(502, "Invalid upstream GraphQL response");
  return errors.map(() => ({ message: "Upstream GraphQL error" }));
}

async function forwardQuery(payload, config, state, request, response) {
  const controller = new AbortController();
  let clientAborted = false;
  const onClientAbort = () => {
    clientAborted = true;
    controller.abort();
  };
  const onRequestClose = () => {
    if (!request.complete) onClientAbort();
  };
  const onResponseClose = () => {
    if (!response.writableEnded) onClientAbort();
  };
  const timeout = setTimeout(() => controller.abort(), config.upstreamTimeoutMs);
  state.controllers.add(controller);
  request.once("aborted", onClientAbort);
  request.once("close", onRequestClose);
  response.once("close", onResponseClose);

  try {
    if (request.aborted || response.destroyed) onClientAbort();
    const upstreamResponse = await fetch(config.upstreamUrl, {
      method: "POST",
      redirect: "error",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const rawBody = await readUpstreamBody(upstreamResponse, controller, config.upstreamResponseCap);
    let body;
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new GatewayError(502, "Invalid upstream GraphQL response");
    }
    if (!isPlainObject(body) || (!Object.hasOwn(body, "data") && !Object.hasOwn(body, "errors"))) {
      throw new GatewayError(502, "Invalid upstream GraphQL response");
    }

    const result = {};
    if (Object.hasOwn(body, "data")) result.data = body.data;
    if (Object.hasOwn(body, "errors")) result.errors = sanitizeGraphQLErrors(body.errors);
    return {
      status: upstreamResponse.status >= 200 && upstreamResponse.status <= 599 ? upstreamResponse.status : 502,
      body: result,
    };
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    if (clientAborted) throw new GatewayError(499, "Client disconnected");
    if (error && error.name === "AbortError") throw new GatewayError(504, "Upstream GraphQL request timed out");
    throw new GatewayError(502, "Upstream GraphQL request failed");
  } finally {
    clearTimeout(timeout);
    state.controllers.delete(controller);
    request.removeListener("aborted", onClientAbort);
    request.removeListener("close", onRequestClose);
    response.removeListener("close", onResponseClose);
  }
}

function sendJson(response, status, body) {
  if (response.destroyed || response.writableEnded) return;
  const serialized = JSON.stringify(body);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(serialized),
  });
  response.end(serialized);
}

function sendError(response, error) {
  if (response.destroyed || response.writableEnded) return;
  const status = error instanceof GatewayError ? error.status : 500;
  const message = error instanceof GatewayError ? error.publicMessage : "Query gateway failure";
  sendJson(response, status, { errors: [{ message }] });
}

async function handleRequest(request, response, config, state) {
  try {
    if (request.method === "GET" && request.url === "/healthz") {
      response.writeHead(200, { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" });
      response.end("ok\n");
      return;
    }
    if (request.url !== "/graphql" || request.method !== "POST") {
      consumeRequestBody(request);
      response.writeHead(404, { "cache-control": "no-store" });
      response.end();
      return;
    }
    if (state.shuttingDown) {
      consumeRequestBody(request);
      sendJson(response, 503, { errors: [{ message: "Query gateway is shutting down" }] });
      return;
    }
    if (!isAuthorized(request, config.tokenDigests)) {
      consumeRequestBody(request);
      sendJson(response, 401, { errors: [{ message: "Unauthorized" }] });
      return;
    }

    const contentType = request.headers["content-type"];
    if (
      typeof contentType !== "string" ||
      contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json"
    ) {
      consumeRequestBody(request);
      throw new GatewayError(415, "Content-Type must be application/json");
    }
    const contentLength = request.headers["content-length"];
    if (contentLength !== undefined && Number(contentLength) > MAX_REQUEST_BYTES) {
      consumeRequestBody(request);
      throw new GatewayError(413, "Request body is too large");
    }

    if (state.inFlight >= config.maxInFlightUpstream) {
      consumeRequestBody(request);
      throw new GatewayError(503, "Query gateway is busy");
    }
    state.inFlight += 1;
    try {
      const payload = parseGraphQLRequest(await readRequestBody(request, config.requestBodyTimeoutMs));
      const upstream = await forwardQuery(payload, config, state, request, response);
      sendJson(response, upstream.status, upstream.body);
    } finally {
      state.inFlight -= 1;
    }
  } catch (error) {
    sendError(response, error);
  }
}

function createGatewayServer(options = {}) {
  const supplied = options.config || readConfig(options.env);
  const tokenDigests = supplied.tokenDigests || [
    validateToken(supplied.token, "GRAPH_QUERY_GATEWAY_TOKEN"),
    ...(supplied.nextToken === undefined ? [] : [validateToken(supplied.nextToken, "GRAPH_QUERY_GATEWAY_NEXT_TOKEN")]),
  ];
  const config = {
    ...supplied,
    tokenDigests,
    upstreamTimeoutMs: supplied.upstreamTimeoutMs ?? UPSTREAM_TIMEOUT_MS,
    upstreamResponseCap: supplied.upstreamResponseCap ?? MAX_UPSTREAM_RESPONSE_BYTES,
    requestBodyTimeoutMs: supplied.requestBodyTimeoutMs ?? REQUEST_BODY_TIMEOUT_MS,
    maxInFlightUpstream: supplied.maxInFlightUpstream ?? MAX_IN_FLIGHT_UPSTREAM,
  };
  const state = {
    controllers: new Set(),
    inFlight: 0,
    shuttingDown: false,
    shutdownPromise: null,
  };
  const server = http.createServer(
    {
      headersTimeout: HEADER_TIMEOUT_MS,
      requestTimeout: REQUEST_TIMEOUT_MS,
      keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
    },
    (request, response) => {
      void handleRequest(request, response, config, state);
    },
  );
  server.gatewayConfig = config;
  server.gatewayState = state;
  return server;
}

function shutdownGatewayServer(server, timeoutMs = SHUTDOWN_TIMEOUT_MS) {
  const state = server.gatewayState;
  if (state.shutdownPromise) return state.shutdownPromise;
  state.shuttingDown = true;
  state.shutdownPromise = new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      for (const controller of state.controllers) controller.abort();
      if (typeof server.closeAllConnections === "function") server.closeAllConnections();
      finish();
    }, timeoutMs);
    server.close(() => finish());
    if (typeof server.closeIdleConnections === "function") server.closeIdleConnections();
  });
  return state.shutdownPromise;
}

if (require.main === module) {
  try {
    const config = readConfig();
    const server = createGatewayServer({ config });
    server.listen(config.port, "0.0.0.0", () => {
      console.log(`query-gateway listening on 0.0.0.0:${config.port}`);
    });
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      void shutdownGatewayServer(server).then(() => process.exit(0));
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  } catch (error) {
    console.error(`Query gateway configuration error: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  ALLOWED_OPERATION_NAMES,
  HEADER_TIMEOUT_MS,
  KEEP_ALIVE_TIMEOUT_MS,
  MAX_IN_FLIGHT_UPSTREAM,
  MAX_GRAPHQL_TOKENS,
  MAX_QUERY_BYTES,
  MAX_REQUEST_BYTES,
  MAX_UPSTREAM_RESPONSE_BYTES,
  REQUEST_BODY_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  SHUTDOWN_TIMEOUT_MS,
  UPSTREAM_TIMEOUT_MS,
  createGatewayServer,
  getOperationName: (query) => canonicalizeApprovedDocument(query).operationName,
  readConfig,
  shutdownGatewayServer,
  tokenDigest,
  tokenMatches,
};
