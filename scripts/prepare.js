const fs = require("fs");
const path = require("path");

// Get network from command line argument
const network = process.argv[2];

if (!network) {
  console.error("Error: Network argument is required");
  console.error("Usage: node scripts/prepare.js <network>");
  console.error("Available networks: mainnet, sepolia");
  process.exit(1);
}

// Load networks configuration
const networksPath = path.join(__dirname, "..", "networks.json");
const networks = JSON.parse(fs.readFileSync(networksPath, "utf8"));

if (!networks[network]) {
  console.error(`Error: Network "${network}" not found in networks.json`);
  console.error(`Available networks: ${Object.keys(networks).join(", ")}`);
  process.exit(1);
}

const networkConfig = networks[network];

// Load template
const templatePath = path.join(__dirname, "..", "subgraph.template.yaml");
let template = fs.readFileSync(templatePath, "utf8");

// Replace network placeholders
template = template.replace(/{ { network } }/g, network);

// Replace SocietyProtocolBadges placeholders
template = template.replace(
  "{ { SocietyProtocolBadges.address } }",
  networkConfig.SocietyProtocolBadges.address
);
template = template.replace(
  "{ { SocietyProtocolBadges.startBlock } }",
  networkConfig.SocietyProtocolBadges.startBlock
);

// Replace EasyAuction placeholders
template = template.replace(
  "{ { EasyAuction.address } }",
  networkConfig.EasyAuction.address
);
template = template.replace(
  "{ { EasyAuction.startBlock } }",
  networkConfig.EasyAuction.startBlock
);

// Write output
const outputPath = path.join(__dirname, "..", "subgraph.yaml");
fs.writeFileSync(outputPath, template);

console.log(`✅ Generated subgraph.yaml for network: ${network}`);
console.log(
  `   - SocietyProtocolBadges: ${networkConfig.SocietyProtocolBadges.address}`
);
console.log(`   - EasyAuction: ${networkConfig.EasyAuction.address}`);
