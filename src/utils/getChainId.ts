function getChainHexFromName(chainName: string): string {
  if (chainName.includes("sepolia")) {
    return "0xaa36a7";
  } else if (chainName.includes("mainnet")) {
    return "0x01";
  }

  return "0x01";
}

function getChainIdFromName(chainName: string): i32 {
  if (chainName.includes("sepolia")) {
    return 11155111;
  } else if (chainName.includes("mainnet")) {
    return 1;
  }

  return 1;
}

export { getChainHexFromName, getChainIdFromName };
