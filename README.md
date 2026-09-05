# Society Protocol Badges Subgraph

This repository holds the subgraph code used to index smart contract events with The Graph.

## Prerequisites

- Node.js and Yarn
- Graph CLI (installed through project dependencies)
- A Graph Studio deploy key for hosted deployments

## Install

```bash
# Install dependencies
yarn install
```

## Build and Test

```bash
# Atomically prepares the mainnet manifest, runs codegen, and builds it
yarn build:mainnet

# The equivalent explicit codegen commands (each prepares its own network)
yarn codegen:mainnet
yarn codegen:sepolia

# Builds the already-prepared manifest without changing its network
yarn build

# Runs matchstick unit tests (the test fixture codegen uses Sepolia, where VIP is enabled)
yarn test

# Run the focused, offline Phase 1 inventory tests
yarn test:inventory
```

## Phase 1 mainnet URI inventory

`inventory:metadata-uris` is a server-only, read-only archive-RPC command. It
uses the checked-in contract ABIs and does not fetch IPFS content, contact
Graph Node/Kubo/gateways, use latest state, or create transactions. The range
is inclusive. Both output paths are explicit so the JSONL and its companion
summary/checksum cannot be confused with logs:

```bash
ETH_MAINNET_ARCHIVE_RPC_URL='https://archive-rpc.example.invalid/' \
FROM_BLOCK=25102724 TO_BLOCK=25133887 \
yarn inventory:metadata-uris \
  --output ./artifacts/mainnet-uri-inventory.jsonl \
  --summary ./artifacts/mainnet-uri-inventory.summary.json
```

Every event filter is queried in inclusive `eth_getLogs` chunks of 5,000
blocks, so the scan is not dependent on a provider-wide range limit. A
server-only `LOG_CHUNK_SIZE` override may be used for a smaller chunk and must
be a decimal integer from 1 through 10,000; invalid values fail closed. Chunk
boundaries are advanced by one block and the merged results are globally
ordered by block, transaction, and log.

The RPC URL, and any credentials it contains, must exist only in the server
job environment. The JSONL contains ordered URI assertions and profile/
community-manager associations; the summary contains the configured starts,
range, provider label, counts, unresolved IDs, and the JSONL SHA-256.

### One-time private Railway inventory job

Create a short-lived private job in the existing `outpost-graph` Railway
environment, attach `ETH_MAINNET_ARCHIVE_RPC_URL` as a server-only secret, and
run the following once. Use the fixed checkpoint (or a separately approved
inclusive range) and copy the two artifacts out through the job's private
artifact mechanism. Do not add a public domain, expose Graph Node/Kubo, or put
the secret in a command, repository, artifact, or client variable.

```bash
yarn install --frozen-lockfile
FROM_BLOCK=25102724 TO_BLOCK=25133887 \
yarn inventory:metadata-uris \
  --output /tmp/mainnet-uri-inventory.jsonl \
  --summary /tmp/mainnet-uri-inventory.summary.json
```

The job is inventory-only and must be deleted after its evidence is retained.

The file template intentionally has no local metadata dedupe guard: identical
template parameters are the identity boundary. A candidate Graph Node v0.45.0
deployment must verify that same-template-parameter data sources are deduplicated
and that shared immutable CIDs are handled safely before publishing v2.

## How Configuration Is Generated

`subgraph.yaml` is generated from `subgraph.template.yaml` using `networks.json`:

```bash
# Generate subgraph.yaml for mainnet
yarn prepare:mainnet

# Generate subgraph.yaml for sepolia
yarn prepare:sepolia
```

During `prepare:*`, the script also generates `src/auction-config.ts` from `AUCTION_ID`.

- `AUCTION_ID` unset or `0`: index all auctions
- `AUCTION_ID=<decimal number>`: index only that auction ID (for example, `42`)
- Invalid values: fallback to `0` with a warning

Preparation fails closed when a selected source has a missing, malformed, or zero
address; a missing, negative, fractional, or unsafe start block; or a network and
chain ID that do not match the requested command. A source with `"enabled": false`
is omitted from the generated manifest, including its entire template block.

## Network Configuration

Network configurations are defined in [networks.json](networks.json). Each network includes:

- Contract addresses for `SocietyProtocolBadges`, `EasyAuction`, and `vipManager`
- Start blocks for indexing

The first current-contracts-only mainnet manifest contains exactly these sources:

- `SocietyProtocolBadges`: `0x2313C0cDdc233c92d16c2cfE17DF5fDCcE556763`, from block `25128949`
- `CommunityRegistry`: `0xEa008f15E1454C79D6AA7B95Dd3E1d39Ba32EB76`, from block `25102724`
- `EasyAuction`: `0x0b7fFc1f4AD541A4Ed16b40D8c37f0929158D101`, from block `12135186`

The current VIP proxy is disabled and excluded until its activation and first
event block are proven. No legacy Badges or VIP source is included.

Available networks:

- `mainnet`: Ethereum mainnet
- `sepolia`: Sepolia testnet

To add a new network, edit `networks.json` and add the configuration.

## Deploy to Graph Studio

The deploy scripts run all required steps in order:

- `prepare:<network>`
- `graph codegen`
- `graph build`
- `graph deploy`

### Mainnet deploy

```bash
yarn deploy --deploy-key <YOUR_DEPLOY_KEY>
```

This deploys to Graph Studio subgraph name `society-mainnet`. The command uses the
atomic mainnet build path and never prepares Sepolia.

### Sepolia deploy

```bash
yarn deploy:testnet --deploy-key <YOUR_DEPLOY_KEY>
```

This deploys to Graph Studio subgraph name `society-testnet`.

## Inspecting the generated mainnet manifest

Run the build, then run this exact check from the repository root. It verifies the
selected addresses and blocks and verifies that the disabled VIP source was omitted:

```bash
yarn build:mainnet
node -e 'const fs=require("fs"); const m=fs.readFileSync("subgraph.yaml","utf8"); const expected=["network: mainnet","name: SocietyProtocolBadges","address: \"0x2313C0cDdc233c92d16c2cfE17DF5fDCcE556763\"","startBlock: 25128949","name: CommunityRegistry","address: \"0xEa008f15E1454C79D6AA7B95Dd3E1d39Ba32EB76\"","startBlock: 25102724","name: EasyAuction","address: \"0x0b7fFc1f4AD541A4Ed16b40D8c37f0929158D101\"","startBlock: 12135186"]; for (const value of expected) if (!m.includes(value)) throw new Error(`Missing manifest value: ${value}`); if (m.includes("name: SocietyVipManager")) throw new Error("VIP source must be omitted"); console.log("mainnet manifest inspection passed");'
```

The manifest is generated and ignored locally; inspect it before every Railway
deployment and record its SHA-256 (`shasum -a 256 subgraph.yaml`) with the deploy
job evidence.

## Railway deploy job requirements

Use a short-lived deploy job in the same `outpost-graph` Railway environment as
graph-node, Postgres, and Kubo. Its command sequence is:

```bash
yarn install --frozen-lockfile
yarn build:mainnet
graph deploy --node http://graph-node.railway.internal:8020 \
  --ipfs http://kubo.railway.internal:5001 society-mainnet
```

Replace the two private DNS service names if the Railway services use different
names. The job must run inside the Railway private network; image builds must not
depend on private service DNS. The graph-node admin port (`8020`) and Kubo API
port (`5001`) are private job-to-service connections only and must not receive
public Railway domains. Do not expose either port, and do not add Railway
credentials as a repository prerequisite. Keep graph-node's query/health target
on its configured HTTP port (`8000`) and use a protected query gateway for
external GraphQL access.

## Run and Deploy Locally (graph-node + IPFS + Postgres)

Start local services:

```bash
docker compose up -d
```

Create the local subgraph:

```bash
yarn create-local
```

Deploy to local graph-node:

```bash
yarn deploy-local
```

Remove local subgraph:

```bash
yarn remove-local
```

Local endpoints used by scripts:

- Graph node admin: `http://localhost:8020/`
- IPFS API: `http://localhost:5001`

## Deploying a Single Auction Only

Set `AUCTION_ID` before any command that runs `prepare:*` (including deploy commands):

```bash
# Mainnet: index only auction 42
AUCTION_ID=42 yarn deploy --deploy-key <YOUR_DEPLOY_KEY>

# Sepolia: index only auction 7
AUCTION_ID=7 yarn deploy:testnet --deploy-key <YOUR_DEPLOY_KEY>

# Local deploy filtered to auction 42
AUCTION_ID=42 yarn deploy-local

# Index all auctions (default)
yarn deploy --deploy-key <YOUR_DEPLOY_KEY>
```

You can regenerate only the config files without deploying:

```bash
AUCTION_ID=42 yarn prepare:mainnet
# or
AUCTION_ID=42 yarn prepare:sepolia
```

> `src/auction-config.ts` is auto-generated by `scripts/prepare.js` and should not be edited manually.

## Script Reference

- `yarn prepare:mainnet`: generate `subgraph.yaml` for mainnet + generate `src/auction-config.ts`
- `yarn prepare:sepolia`: generate `subgraph.yaml` for sepolia + generate `src/auction-config.ts`
- `yarn codegen:mainnet`: prepare mainnet, then run `graph codegen`
- `yarn codegen:sepolia`: prepare Sepolia, then run `graph codegen`
- `yarn build:mainnet`: prepare mainnet, codegen, then build (atomic network-specific path)
- `yarn build:sepolia`: prepare Sepolia, codegen, then build (atomic network-specific path)
- `yarn build`: runs `graph build`
- `yarn deploy`: mainnet build + deploy (`society-mainnet`)
- `yarn deploy:testnet`: Sepolia build + deploy (`society-testnet`)
- `yarn create-local`: create local subgraph on `http://localhost:8020/`
- `yarn deploy-local`: mainnet prepare + codegen + build + deploy to local graph-node/IPFS
- `yarn remove-local`: remove local subgraph from `http://localhost:8020/`
- `yarn test`: prepare/codegen Sepolia for fixture bindings, then run matchstick tests

Note: replace `yarn <script>` with `npm run <script>` if you use npm.
