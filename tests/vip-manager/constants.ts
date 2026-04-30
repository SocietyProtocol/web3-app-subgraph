import { BigInt } from "@graphprotocol/graph-ts";

export const vipManagerContractAddress =
  "0x91715d95004Bd57eDC1E0FD718688CEd475E130A";

export const userAddress1 = "0x5eA1474CeFA1ea5986327F97932B587deD802CF7";
export const userAddress2 = "0xf3dBd9F4C902c7183E0fd22bFdbAF5ed330845c4";

// 1000 tokens (18 decimals)
export const lockAmount1 = BigInt.fromString("1000000000000000000000");
// 500 tokens (18 decimals)
export const lockAmount2 = BigInt.fromString("500000000000000000000");

// Wed May 03 2023 — lock timestamp
export const lockTimestamp: i32 = 1683094249;
// unlock time: 90 days later
export const unlockTime1 = BigInt.fromI32(1683094249 + 90 * 24 * 3600);
export const unlockTime2 = BigInt.fromI32(1683094249 + 180 * 24 * 3600);

// Badge IDs as configured in the contract (used by tierIdToName)
export const bronzeBadgeId = BigInt.fromI32(10);
export const silverBadgeId = BigInt.fromI32(20);
export const goldBadgeId = BigInt.fromI32(30);
