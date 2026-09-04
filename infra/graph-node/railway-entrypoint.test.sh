#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/graph-node-entrypoint-test.XXXXXX")"
cleanup() {
  if [[ -n "${listener_pid:-}" ]]; then kill "$listener_pid" 2>/dev/null || true; fi
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

mkdir -p "$tmp_dir/bin"
cat > "$tmp_dir/bin/envsubst" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-}" == '${DATABASE_URL}' ]]
input="$(cat)"
printf '%s' "${input//\$\{DATABASE_URL\}/${DATABASE_URL}}"
STUB
cat > "$tmp_dir/bin/graphman" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-}" == '--config' ]]
config_file="$2"
[[ "${3:-}" == 'database' && "${4:-}" == 'migrate' ]]
printf 'graphman\n' >> "$EVENTS_FILE"
printf '%s' "$config_file" > "$CONFIG_PATH_FILE"
config_contents="$(<"$config_file")"
[[ "$config_contents" == *'connection = "postgres://test/db"'* ]]
[[ "$config_contents" == *'indexers = ["default"]'* ]]
[[ "${DATABASE_URL+x}" != x ]]
mode="$(stat -c '%a' "$config_file" 2>/dev/null || stat -f '%Lp' "$config_file")"
[[ "$mode" == '600' ]]
STUB
chmod 0555 "$tmp_dir/bin/envsubst" "$tmp_dir/bin/graphman"

start_listener() {
  local port="$1"
  (
    sleep 0.2
    python3 -m http.server "$port" --bind 127.0.0.1 >/dev/null 2>&1
  ) &
  listener_pid=$!
}

run_success_test() {
  local events_file="$tmp_dir/success.events"
  local config_path_file="$tmp_dir/success.config-path"
  : > "$events_file"
  : > "$config_path_file"
  start_listener 15432
  (
    export PATH="$tmp_dir/bin:$PATH"
    export EVENTS_FILE="$events_file"
    export CONFIG_PATH_FILE="$config_path_file"
    export DATABASE_URL='postgres://test/db'
    export GRAPH_NODE_CONFIG='must-be-unset'
    export GRAPH_NODE_CONFIG_TEMPLATE="$script_dir/graph-node.toml.template"
    export postgres_host=127.0.0.1
    export postgres_port=15432
    export POSTGRES_READY_TIMEOUT_SECONDS=3
    exec() {
      [[ "$1" == '/usr/local/bin/start' ]]
      [[ "${DATABASE_URL+x}" != x ]]
      [[ "${GRAPH_NODE_CONFIG+x}" != x ]]
      [[ ! -e "$(<"$CONFIG_PATH_FILE")" ]]
      shift
      printf 'start %s\n' "$*" >> "$EVENTS_FILE"
      return 0
    }
    source "$script_dir/railway-entrypoint.sh" --test-arg
    [[ -z "${GRAPH_NODE_CONFIG+x}" ]]
  )
  kill "$listener_pid" 2>/dev/null || true
  wait "$listener_pid" 2>/dev/null || true
  listener_pid=""
  [[ "$(<"$events_file")" == $'graphman\nstart --test-arg' ]]
  [[ ! -e "$(<"$config_path_file")" ]]
}

run_migration_failure_test() {
  local events_file="$tmp_dir/migration-failure.events"
  local config_path_file="$tmp_dir/migration-failure.config-path"
  : > "$events_file"
  : > "$config_path_file"
  chmod 0755 "$tmp_dir/bin/graphman"
  cat > "$tmp_dir/bin/graphman" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf 'graphman\n' >> "$EVENTS_FILE"
printf '%s' "$2" > "$CONFIG_PATH_FILE"
[[ "${DATABASE_URL+x}" != x ]]
exit 42
STUB
  chmod 0555 "$tmp_dir/bin/graphman"
  start_listener 15433
  if (
    export PATH="$tmp_dir/bin:$PATH"
    export EVENTS_FILE="$events_file"
    export CONFIG_PATH_FILE="$config_path_file"
    export DATABASE_URL='postgres://test/db'
    export GRAPH_NODE_CONFIG_TEMPLATE="$script_dir/graph-node.toml.template"
    export postgres_host=127.0.0.1
    export postgres_port=15433
    export POSTGRES_READY_TIMEOUT_SECONDS=3
    exec() {
      printf 'start\n' >> "$EVENTS_FILE"
      return 0
    }
    source "$script_dir/railway-entrypoint.sh"
  ); then
    return 1
  fi
  kill "$listener_pid" 2>/dev/null || true
  wait "$listener_pid" 2>/dev/null || true
  listener_pid=""
  [[ "$(<"$events_file")" == 'graphman' ]]
  [[ ! -e "$(<"$config_path_file")" ]]
}

run_readiness_failure_test() {
  local events_file="$tmp_dir/readiness-failure.events"
  : > "$events_file"
  chmod 0755 "$tmp_dir/bin/graphman"
  cat > "$tmp_dir/bin/graphman" <<'STUB'
#!/usr/bin/env bash
printf 'graphman\n' >> "$EVENTS_FILE"
exit 0
STUB
  chmod 0555 "$tmp_dir/bin/graphman"
  if (
    export PATH="$tmp_dir/bin:$PATH"
    export EVENTS_FILE="$events_file"
    export DATABASE_URL='postgres://test/db'
    export GRAPH_NODE_CONFIG_TEMPLATE="$script_dir/graph-node.toml.template"
    export postgres_host=127.0.0.1
    export postgres_port=59999
    export POSTGRES_READY_TIMEOUT_SECONDS=1
    exec() { printf 'start\n' >> "$EVENTS_FILE"; return 0; }
    source "$script_dir/railway-entrypoint.sh"
  ); then
    return 1
  fi
  [[ ! -s "$events_file" ]]
}

run_configuration_shape_test() {
  local config_contents="$(<"$script_dir/graph-node.toml.template")"
  [[ "$config_contents" == *'[chains]'* ]]
  [[ "$config_contents" == *'ingestor = "default"'* ]]
  [[ "$config_contents" == *'[store.primary]'* ]]
  [[ "$config_contents" == *'connection = "${DATABASE_URL}"'* ]]
  [[ "$config_contents" == *'pool_size = 10'* ]]
  [[ "$config_contents" == *'[[deployment.rule]]'* ]]
  [[ "$config_contents" == *'indexers = ["default"]'* ]]
}

run_success_test
run_migration_failure_test
run_readiness_failure_test
run_configuration_shape_test
printf '%s\n' 'railway entrypoint validation passed'
