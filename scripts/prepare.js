const fs = require("fs");
const path = require("path");

const EXPECTED_NETWORKS = {
  mainnet: { chainId: 1 },
  sepolia: { chainId: 11155111 },
};

const SOURCES = [
  "SocietyProtocolBadges",
  "EasyAuction",
  "vipManager",
  "CommunityRegistry",
];

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`Could not read valid JSON from ${filePath}: ${error.message}`);
  }
}

function validateAddress(sourceName, source) {
  if (typeof source.address !== "string") {
    throw new Error(`${sourceName}.address is missing or is not a string`);
  }

  if (!/^0x[0-9a-fA-F]{40}$/.test(source.address)) {
    throw new Error(`${sourceName}.address is not a valid Ethereum address`);
  }

  if (/^0x0{40}$/i.test(source.address)) {
    throw new Error(`${sourceName}.address must not be the zero address`);
  }
}

function validateStartBlock(sourceName, source) {
  const block = source.startBlock;
  const validNumber =
    typeof block === "number" && Number.isSafeInteger(block) && block >= 0;
  const validString =
    typeof block === "string" && /^\d+$/.test(block) && Number.isSafeInteger(Number(block));

  if (!validNumber && !validString) {
    throw new Error(
      `${sourceName}.startBlock is missing or must be a non-negative safe integer`,
    );
  }
}

function validateSource(sourceName, source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error(`${sourceName} configuration is missing or invalid`);
  }

  if (source.enabled !== undefined && typeof source.enabled !== "boolean") {
    throw new Error(`${sourceName}.enabled must be a boolean`);
  }

  // Disabled sources are intentionally allowed to omit address and startBlock.
  if (source.enabled === false) {
    return false;
  }

  validateAddress(sourceName, source);
  validateStartBlock(sourceName, source);
  return true;
}

function validateNetwork(network, networkConfig) {
  const expected = EXPECTED_NETWORKS[network];
  if (!expected) {
    throw new Error(
      `Network "${network}" is not supported. Available networks: ${Object.keys(EXPECTED_NETWORKS).join(
        ", ",
      )}`,
    );
  }

  if (!networkConfig || typeof networkConfig !== "object") {
    throw new Error(`Network "${network}" configuration is missing or invalid`);
  }

  // Keep the network identity in the data file so a copied/swapped config fails
  // closed instead of generating a manifest for the wrong chain.
  if (networkConfig.network !== network) {
    throw new Error(
      `Network configuration mismatch: requested "${network}" but config declares "${networkConfig.network || "missing"}"`,
    );
  }
  if (networkConfig.chainId !== expected.chainId) {
    throw new Error(
      `Network configuration mismatch: "${network}" must use chainId ${expected.chainId}`,
    );
  }

  const enabledSources = {};
  for (const sourceName of SOURCES) {
    try {
      enabledSources[sourceName] = validateSource(
        sourceName,
        networkConfig[sourceName],
      );
    } catch (error) {
      throw new Error(`${network}: ${error.message}`);
    }
  }
  return enabledSources;
}

function replacePlaceholder(template, placeholder, value) {
  // The spaces are intentional: these tokens keep the source template valid
  // enough for editors while remaining unambiguous to this renderer.
  return template.split(`{ { ${placeholder} } }`).join(String(value));
}

function renderOptionalBlock(template, name, enabled) {
  const opening = new RegExp(`^[ \\t]*# \\{\\{#${name}\\}\\}\\r?\\n`, "m");
  const closing = new RegExp(`^[ \\t]*# \\{\\{/${name}\\}\\}\\r?\\n?`, "m");
  const wholeBlock = new RegExp(
    `^[ \\t]*# \\{\\{#${name}\\}\\}\\r?\\n[\\s\\S]*?^[ \\t]*# \\{\\{/${name}\\}\\}\\r?\\n?`,
    "m",
  );

  if (!enabled) {
    return template.replace(wholeBlock, "");
  }

  return template.replace(opening, "").replace(closing, "");
}

function assertV2Manifest(manifest, network) {
  const spec = manifest.match(/^specVersion:\s*(\d+)\.(\d+)\.(\d+)\s*$/m);
  const specVersion = spec
    ? [Number(spec[1]), Number(spec[2]), Number(spec[3])]
    : null;
  if (
    specVersion === null ||
    specVersion[0] < 0 ||
    (specVersion[0] === 0 && specVersion[1] < 0) ||
    (specVersion[0] === 0 && specVersion[1] === 0 && specVersion[2] < 7)
  ) {
    throw new Error(`Generated ${network} manifest requires specVersion >= 0.0.7`);
  }

  if (!/^  - kind: file\/ipfs\s*$/m.test(manifest)) {
    throw new Error(`Generated ${network} manifest is missing the file/ipfs template`);
  }

  const templateStart = manifest.indexOf("templates:");
  if (templateStart < 0) {
    throw new Error(`Generated ${network} manifest is missing templates`);
  }
  const template = manifest.slice(templateStart);
  if (/^      kind:\s*\S+/m.test(template)) {
    throw new Error(`Generated ${network} file template must not define mapping.kind`);
  }

  const abiEntry = template.match(
    /^        - name:\s+(\S+)\s*\n\s{10}file:\s+(\S+)\s*$/m,
  );
  if (!abiEntry || !abiEntry[1] || !abiEntry[2]) {
    throw new Error(`Generated ${network} file template requires a non-empty ABI entry`);
  }
  const abiPath = path.resolve(__dirname, "..", abiEntry[2]);
  if (!fs.existsSync(abiPath) || !fs.statSync(abiPath).isFile()) {
    throw new Error(`Generated ${network} file template ABI does not exist`);
  }

  if (/ipfsOnEthereumContracts/.test(manifest)) {
    throw new Error(`Generated ${network} manifest enables ipfsOnEthereumContracts`);
  }
}

function assertNoInlineIpfsSource(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      assertNoInlineIpfsSource(entryPath);
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      const source = fs.readFileSync(entryPath, "utf8");
      if (/\bipfs\s*\.\s*cat\s*\(/.test(source)) {
        throw new Error(`Reachable inline ipfs.cat source found in ${entryPath}`);
      }
    }
  }
}

function main() {
  const network = process.argv[2];
  if (!network) {
    fail("Network argument is required. Usage: node scripts/prepare.js <mainnet|sepolia>");
  }

  const networksPath = path.join(__dirname, "..", "networks.json");
  const networks = readJson(networksPath);
  let enabledSources;
  try {
    enabledSources = validateNetwork(network, networks[network]);
  } catch (error) {
    fail(error.message);
  }

  const templatePath = path.join(__dirname, "..", "subgraph.template.yaml");
  let template = fs.readFileSync(templatePath, "utf8");
  const networkConfig = networks[network];

  template = replacePlaceholder(template, "network", network);
  for (const sourceName of SOURCES) {
    template = renderOptionalBlock(
      template,
      sourceName,
      enabledSources[sourceName],
    );

    if (enabledSources[sourceName]) {
      template = replacePlaceholder(
        template,
        `${sourceName}.address`,
        networkConfig[sourceName].address,
      );
      template = replacePlaceholder(
        template,
        `${sourceName}.startBlock`,
        networkConfig[sourceName].startBlock,
      );
    }
  }

  const manifestNetworks = [...template.matchAll(/^\s+network:\s+(\S+)\s*$/gm)].map(
    (match) => match[1],
  );
  const enabledSourceCount = Object.values(enabledSources).filter(Boolean).length;
  if (
    manifestNetworks.length !== enabledSourceCount ||
    manifestNetworks.some((manifestNetwork) => manifestNetwork !== network)
  ) {
    fail(
      `Generated manifest network does not match "${network}" for every enabled source`,
    );
  }

  if (/\{\s*\{[\s\S]*?\}\s*\}/.test(template) || /# \{\{[#/]/.test(template)) {
    fail("Generated manifest contains unresolved template markers");
  }

  try {
    assertV2Manifest(template, network);
    assertNoInlineIpfsSource(path.join(__dirname, "..", "src"));
  } catch (error) {
    fail(error.message);
  }

  const outputPath = path.join(__dirname, "..", "subgraph.yaml");
  fs.writeFileSync(outputPath, template);
  try {
    assertV2Manifest(fs.readFileSync(outputPath, "utf8"), network);
  } catch (error) {
    fail(error.message);
  }

  // Generate auction-config.ts from AUCTION_ID env variable.
  // Set AUCTION_ID=<id> to index only that auction; leave unset (or "0") to index all.
  const rawAuctionId = process.env.AUCTION_ID;
  let auctionId = "0";
  if (rawAuctionId && /^\d+$/.test(rawAuctionId)) {
    auctionId = rawAuctionId.replace(/^0+(?=\d)/, "");
  } else if (rawAuctionId && !/^\d+$/.test(rawAuctionId)) {
    console.warn(
      `Warning: Invalid AUCTION_ID "${rawAuctionId}" — expected a decimal number. Falling back to "0".`,
    );
  }
  const auctionConfigPath = path.join(
    __dirname,
    "..",
    "src",
    "auction-config.ts",
  );
  const auctionConfigContent = `// This file is auto-generated by scripts/prepare.js — do not edit manually.
// Set the AUCTION_ID environment variable to restrict indexing to a single auction.
// A value of "0" (the default) means all auctions are indexed.
export const AUCTION_ID_FILTER: string = "${auctionId}";
`;
  fs.writeFileSync(auctionConfigPath, auctionConfigContent);

  console.log(`✅ Generated subgraph.yaml for network: ${network}`);
  for (const sourceName of SOURCES) {
    const source = networkConfig[sourceName];
    console.log(
      `   - ${sourceName}: ${enabledSources[sourceName] ? `${source.address} (from block ${source.startBlock})` : "disabled"}`,
    );
  }
  console.log(
    `   - AUCTION_ID filter: ${auctionId === "0" ? "all auctions" : auctionId}`,
  );
}

main();
