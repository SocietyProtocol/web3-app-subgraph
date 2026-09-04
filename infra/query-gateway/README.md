# Society Graph Query Gateway

This is the only public ingress for GraphQL in the isolated Railway `outpost-graph`
project. It forwards an authenticated allowlist of read-only GraphQL operations to
one fixed graph-node subgraph URL. It does not enable CORS.

## Local development

From this directory:

```bash
npm ci
GRAPH_NODE_SUBGRAPH_URL=http://127.0.0.1:8000/subgraphs/name/society-mainnet \
GRAPH_QUERY_GATEWAY_TOKEN=replace-with-at-least-32-bytes \
PORT=8080 npm start
```

Run the deterministic built-in test suite with `npm test`. The service requires
Node `24.13.0` or a later Node 24 release.

## Railway deployment

Create a separate Railway service from this directory with **Root Directory** set
to `/infra/query-gateway` (relative to the repository root). Railway should build
the included `Dockerfile`; the image listens on `0.0.0.0:$PORT` and runs as the
non-root `node` user.

Set these Railway variables on the gateway service:

```text
NODE_ENV=production
GRAPH_NODE_SUBGRAPH_URL=http://graph-node.railway.internal:8000/subgraphs/name/society-mainnet
GRAPH_QUERY_GATEWAY_TOKEN=<random-secret-at-least-32-utf8-bytes>
```

Railway supplies `PORT`; do not hard-code it in the service configuration. Add one
public Railway domain targeting the gateway's `$PORT` and use
`https://<gateway-public-domain>/healthz` as its health-check target (path
`/healthz`). `/healthz` is intentionally unauthenticated. Clients must send
`Authorization: Bearer <GRAPH_QUERY_GATEWAY_TOKEN>` to `POST /graphql`.

The production URL is intentionally restricted to the exact private Graph Node
query endpoint shown above. The gateway service and graph-node must be in the same
Railway private network so `graph-node.railway.internal` resolves at runtime. Image
builds must not depend on private service DNS. Graph-node admin `8020`, PostgreSQL,
and the Kubo API (`5001`) remain private with no public domains; none is an ingress
for this service.

The Dockerfile pins the Node base image to the explicit `24.13.0` patch tag and
runs the final layer as the non-root `node` user. CI must resolve that tag to a
reviewed immutable image digest before a Railway deployment; this repository does
not invent or claim a digest for the base image.

## Request policy

The gateway enforces a 128 KiB request limit and an 8 KiB query-string byte limit.
The largest current persisted document is `Users` at 1,884 UTF-8 bytes; 8 KiB is
intentionally above that measured basis while remaining well below the request
cap. GraphQL parsing uses the standard parser with a strict 512-token ceiling.
Only the 13 canonical documents in `generated/registry.js` are accepted: each
request is parsed, normalized with `print(parse(query))`, and compared to its
immutable persisted source and SHA-256 hash. Same-name documents with altered
selections are rejected, as are mutations, subscriptions, and introspection.

Variable names/types and limits are metadata on each exact persisted operation.
Undeclared variables are rejected; list pages, scalar values, arrays, filter depth,
filter keys, node counts, and variable payload bytes are capped per operation while
permitting the current client call sites (including 1,000-row badge/user pages
and the 11-row community-member sentinel page).

It forwards only `query`, `variables`, and `operationName`, never forwards the
client authorization header, and never copies upstream response headers such as
`Set-Cookie`. Upstream GraphQL error messages and extensions are replaced with a
generic safe error shape. Header/request/keep-alive timers and graceful SIGTERM
draining are enabled; client disconnects abort the upstream request.

## Token rotation

Both `GRAPH_QUERY_GATEWAY_TOKEN` and the optional
`GRAPH_QUERY_GATEWAY_NEXT_TOKEN` must be at least 32 UTF-8 bytes. To rotate without
an outage, set the new secret as `GRAPH_QUERY_GATEWAY_NEXT_TOKEN` and deploy. Once
all clients use the new secret, promote it to `GRAPH_QUERY_GATEWAY_TOKEN`, remove
`GRAPH_QUERY_GATEWAY_NEXT_TOKEN`, and deploy again. The gateway stores only
pre-hashed token values and compares them with timing-safe equality.
