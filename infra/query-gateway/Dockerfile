FROM node:24.13.0-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node server.js ./
COPY --chown=node:node generated ./generated

USER node
EXPOSE 8080
CMD ["node", "server.js"]
