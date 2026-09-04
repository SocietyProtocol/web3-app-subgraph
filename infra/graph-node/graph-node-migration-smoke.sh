#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
image="society-graph-node-migration-smoke:local"
network="society-graph-node-smoke-network"
postgres="society-graph-node-smoke-postgres"
smoke_container="society-graph-node-smoke"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/graph-node-migration-smoke.XXXXXX")"
cleanup() {
  docker rm -f "$smoke_container" >/dev/null 2>&1 || true
  docker rm -f "$postgres" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

docker build --pull -t "$image" "$script_dir"
docker network create "$network" >/dev/null

database_password='smoke-only-password'
docker run -d --name "$postgres" --network "$network" \
  -e POSTGRES_USER=graph-node \
  -e POSTGRES_PASSWORD="$database_password" \
  -e POSTGRES_DB=graph-node \
  -e POSTGRES_INITDB_ARGS='-E UTF8 --locale=C' \
  postgres:14 >/dev/null

ready=0
for _ in {1..60}; do
  if docker exec "$postgres" pg_isready -U graph-node -d graph-node >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if (( ready == 0 )); then
  printf '%s\n' 'disposable Postgres did not become ready' >&2
  exit 1
fi

cat > "$tmp_dir/start" <<'STUB'
#!/bin/sh
set -eu
test -z "${DATABASE_URL+x}"
test -z "${GRAPH_NODE_CONFIG+x}"
exit 0
STUB
chmod 0555 "$tmp_dir/start"

database_url="postgresql://graph-node:${database_password}@${postgres}:5432/graph-node"
run_log="$tmp_dir/entrypoint.log"
if ! docker run --rm --name "$smoke_container" \
  --network "$network" \
  -v "$tmp_dir/start:/usr/local/bin/start:ro" \
  -e DATABASE_URL="$database_url" \
  -e postgres_host="$postgres" \
  -e postgres_port=5432 \
  -e postgres_user=graph-node \
  -e postgres_pass="$database_password" \
  -e postgres_db=graph-node \
  -e ipfs=ipfs:5001 \
  -e ethereum=mainnet:http://ethereum.invalid:8545 \
  -e GRAPH_NODE_CONFIG=must-be-removed \
  "$image" --migration-smoke >"$run_log" 2>&1; then
  printf '%s\n' 'graph-node migration smoke failed (details intentionally suppressed)' >&2
  exit 1
fi

printf '%s\n' 'graph-node migration image smoke passed'
