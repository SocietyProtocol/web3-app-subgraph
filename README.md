# Society Protocol Badges Subgraph

This repository holds the subgraph code used to index the smart contracts events using the Graph.

## Getting Started

Basic commands to get started with the subgraph.

```bash
# Install dependencies
yarn install

# Generate types
yarn codegen

# Build
yarn build

# Test
yarn test
```

### Deploy to individual networks

```bash
# Deploy to mainnet
yarn deploy --deploy-key <YOUR_DEPLOY_KEY>

# Deploy to testnet (sepolia)
yarn deploy:testnet --network sepolia --deploy-key <YOUR_DEPLOY_KEY>
```

Note: Replace`yarn` with `npm run` in the above commands to use npm.
