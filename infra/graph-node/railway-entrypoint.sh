#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  printf '%s\n' 'DATABASE_URL is required' >&2
  exit 1
fi
case "$DATABASE_URL" in
  postgres://*|postgresql://*) ;;
  *) printf '%s\n' 'DATABASE_URL must use the postgres URL scheme' >&2; exit 1 ;;
esac
if [[ "$DATABASE_URL" == *$'\n'* || "$DATABASE_URL" == *$'\r'* || "$DATABASE_URL" == *$'\t'* || "$DATABASE_URL" == *' '* || "$DATABASE_URL" == *'"'* || "$DATABASE_URL" == *\\* ]]; then
  printf '%s\n' 'DATABASE_URL contains unsupported characters' >&2
  exit 1
fi

postgres_host="${postgres_host:-}"
postgres_port="${postgres_port:-5432}"
if [[ -z "$postgres_host" || ! "$postgres_host" =~ ^[A-Za-z0-9._:-]+$ ]]; then
  printf '%s\n' 'postgres_host is required and must be a hostname or address' >&2
  exit 1
fi
if [[ ! "$postgres_port" =~ ^[0-9]+$ || "$postgres_port" -lt 1 || "$postgres_port" -gt 65535 ]]; then
  printf '%s\n' 'postgres_port must be between 1 and 65535' >&2
  exit 1
fi
ready_timeout="${POSTGRES_READY_TIMEOUT_SECONDS:-30}"
if [[ ! "$ready_timeout" =~ ^[1-9][0-9]*$ || "$ready_timeout" -gt 300 ]]; then
  printf '%s\n' 'POSTGRES_READY_TIMEOUT_SECONDS must be between 1 and 300' >&2
  exit 1
fi

ready_deadline=$((SECONDS + ready_timeout))
while ! (builtin exec 3<>"/dev/tcp/$postgres_host/$postgres_port" && builtin exec 3>&-) 2>/dev/null; do
  if (( SECONDS >= ready_deadline )); then
    printf '%s\n' 'Postgres did not become ready before the deadline' >&2
    exit 1
  fi
  sleep 1
done

template_file="${GRAPH_NODE_CONFIG_TEMPLATE:-/etc/graph-node/railway.toml.template}"
config_file=""
cleanup() {
  if [[ -n "$config_file" ]]; then rm -f "$config_file"; fi
  unset DATABASE_URL GRAPH_NODE_CONFIG
}
trap cleanup EXIT

# Restrict envsubst to DATABASE_URL. It substitutes text only; the URL is never
# evaluated as shell code.
umask 077
config_file="$(mktemp "${TMPDIR:-/tmp}/graph-node-config.XXXXXX")"
chmod 0600 "$config_file"
envsubst '${DATABASE_URL}' < "$template_file" > "$config_file"
unset DATABASE_URL
unset GRAPH_NODE_CONFIG
graphman --config "$config_file" database migrate

rm -f "$config_file"
config_file=""
trap - EXIT
unset DATABASE_URL GRAPH_NODE_CONFIG
exec /usr/local/bin/start "$@"
