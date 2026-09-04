# Railway Graph Node bootstrap wrapper

This wrapper keeps the official `graphprotocol/graph-node:v0.45.0` image and
startup command, but initializes a fresh Postgres schema before normal startup.
Each container start runs the official idempotent command:

```text
graphman --config <generated-toml> database migrate
```

Migration failure is fail-closed: `/usr/local/bin/start` is not invoked. After a
successful migration, the generated file is removed, `GRAPH_NODE_CONFIG` is
unset, and the wrapper executes `/usr/local/bin/start "$@"`. The existing
lower-case Graph Node runtime variables remain the normal runtime path:
`postgres_host`, `postgres_port`, `postgres_user`, `postgres_pass`,
`postgres_db`, `ipfs`, `ethereum`, and `node_id`.

## Railway setup

Update the existing `graph-node` service to build this repository revision with
**Root Directory** set to `infra/graph-node`. Use the included Dockerfile; it
inherits exactly `graphprotocol/graph-node:v0.45.0` and installs no packages.

Add a server-only Railway variable reference on that service:

```text
DATABASE_URL=${{postgres.DATABASE_URL}}
```

Retain the existing Graph Node variables, including the lower-case variables
listed above and the current `GRAPH_LOG`/network settings. `DATABASE_URL` is used
only during the bootstrap migration and is never logged. Keep graph-node at one
replica on the private Railway network. PostgreSQL and Graph Node should remain
private; public GraphQL access belongs at the protected query gateway.

The migration is safe to run on every restart and is idempotent. Do not create a
second concurrent migration job: the wrapper is the single schema-migration
owner for this service. Railway should deploy/restart the graph-node service only
after the Postgres service is available.

## Rollback

If necessary, temporarily roll back the service image to the direct official
`graphprotocol/graph-node:v0.45.0` image only after the database schema has been
successfully initialized. Retaining this wrapper is recommended so fresh
databases and future schema migrations remain self-bootstrapping. Do not remove
the `DATABASE_URL` reference while using the wrapper.

## Local validation

The low-cost shell test stubs `envsubst`, `graphman`, and the official start
command; it does not require Docker or a database:

```bash
bash railway-entrypoint.test.sh
```

With Docker available, run the genuine image-level migration smoke test as well:

```bash
bash graph-node-migration-smoke.sh
```

It builds this wrapper, starts a disposable Postgres 14 database with the
Graph Node-required UTF-8/C locale, runs the real image `graphman` through the
entrypoint, and removes its containers and network on exit.
