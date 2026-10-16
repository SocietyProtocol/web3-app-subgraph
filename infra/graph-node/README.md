# Graph Node bootstrap wrapper

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

## AWS setup

Build this directory with the included Dockerfile on the AWS outpost. It inherits
`graphprotocol/graph-node:v0.45.0` and installs no packages.

Set `DATABASE_URL` to the local graph Postgres URL, for example
`postgresql://graph:<password>@prod-graph-postgres:5432/graph`. Staging uses
`staging-graph-postgres`. `DATABASE_URL` is used only during the bootstrap
migration and is never logged. Keep PostgreSQL and Graph Node private. Public
GraphQL access belongs at the query gateway.

The migration is safe to run on every restart and is idempotent. Do not run a
second migration at the same time. Start graph-node only after its Postgres
container is accepting connections.

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
