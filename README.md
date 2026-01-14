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

## Network Configuration

Network configurations are defined in [networks.json](networks.json). Each network includes:

- Contract addresses for `SocietyProtocolBadges` and `EasyAuction`
- Start blocks for indexing

Available networks:

- `mainnet`: Ethereum mainnet
- `sepolia`: Sepolia testnet

To add a new network, edit `networks.json` and add the configuration.

### Deploy to individual networks

The deployment commands automatically generate the `subgraph.yaml` from `subgraph.template.yaml` using the network configuration:

```bash
# Deploy to mainnet
# This runs: prepare:mainnet -> codegen -> build -> deploy
yarn deploy --deploy-key <YOUR_DEPLOY_KEY>

# Deploy to testnet (sepolia)
# This runs: prepare:sepolia -> codegen -> build -> deploy
yarn deploy:testnet --deploy-key <YOUR_DEPLOY_KEY>
```

You can also manually prepare the subgraph.yaml for a specific network:

```bash
# Generate subgraph.yaml for mainnet
yarn prepare:mainnet

# Generate subgraph.yaml for sepolia
yarn prepare:sepolia
```

Note: Replace`yarn` with `npm run` in the above commands to use npm.
