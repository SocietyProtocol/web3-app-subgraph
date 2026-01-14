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
    "0x6b175474e89094c44da98b954eedeac495271d0f",
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    "0xdac17f958d2ee523a2206206994597c13d831ec7",
  ])
);

legitTokens.set(11155111, new LegitTokens(11155111, []));

export function getTokenList(index: i32): LegitTokens | null {
  if (legitTokens.has(index)) {
    return legitTokens.get(index);
  }

  return null;
}
