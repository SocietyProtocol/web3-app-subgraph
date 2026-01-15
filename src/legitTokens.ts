export class LegitTokens {
  chainId: i32;
  tokenAddressList: string[];

  constructor(chainId: i32, tokenAddressList: string[]) {
    this.chainId = chainId;
    this.tokenAddressList = tokenAddressList;
  }
}

export let legitTokens: Map<i32, LegitTokens> = new Map();

legitTokens.set(
  1,
  new LegitTokens(1, [
    // USDC
    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  ])
);

legitTokens.set(
  11155111,
  new LegitTokens(11155111, [
    // Sepolia USDC
    "0x730B28005E3F107a719d6e1A64246eDA86374C00",
  ])
);

export function getTokenList(index: i32): LegitTokens | null {
  if (legitTokens.has(index)) {
    return legitTokens.get(index);
  }

  return null;
}
