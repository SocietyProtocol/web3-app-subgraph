FROM graphprotocol/graph-node:v0.45.0

COPY graph-node.toml.template /etc/graph-node/railway.toml.template
COPY railway-entrypoint.sh /usr/local/bin/railway-entrypoint.sh
RUN chmod 0555 /usr/local/bin/railway-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/railway-entrypoint.sh"]
