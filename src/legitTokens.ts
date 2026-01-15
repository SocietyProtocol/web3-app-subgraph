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
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  ])
);

legitTokens.set(
  11155111,
  new LegitTokens(11155111, [
    // Sepolia USDC
    "0x730b28005e3f107a719d6e1a64246eda86374c00",
  ])
);

export function getTokenList(index: i32): LegitTokens | null {
  if (legitTokens.has(index)) {
    return legitTokens.get(index);
  }

  return null;
}
