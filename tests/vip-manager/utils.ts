import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { newMockEventWithParams } from "matchstick-as/assembly/index";

import {
  TokensLocked,
  TokensUnlocked,
} from "../../generated/SocietyVipManager/SocietyVipManager";
import { vipManagerContractAddress } from "./constants";

export const contractAddress = Address.fromString(vipManagerContractAddress);

// newMockEventWithParams always returns the same hardcoded transaction hash.
// Encode blockTimestamp into the last 4 bytes of a 32-byte hash so that
// events with distinct timestamps produce distinct tx hashes.
function hashFromTimestamp(blockTimestamp: i32): Bytes {
  let hash = new Bytes(32); // zero-initialised
  hash[28] = u8((blockTimestamp >> 24) & 0xff);
  hash[29] = u8((blockTimestamp >> 16) & 0xff);
  hash[30] = u8((blockTimestamp >> 8) & 0xff);
  hash[31] = u8(blockTimestamp & 0xff);
  return hash;
}

export function createTokensLockedEvent(
  user: string,
  amount: BigInt,
  unlockTime: BigInt,
  blockTimestamp: i32 = 0
): TokensLocked {
  let event = changetype<TokensLocked>(
    newMockEventWithParams([
      new ethereum.EventParam(
        "user",
        ethereum.Value.fromAddress(Address.fromString(user))
      ),
      new ethereum.EventParam(
        "amount",
        ethereum.Value.fromUnsignedBigInt(amount)
      ),
      new ethereum.EventParam(
        "unlockTime",
        ethereum.Value.fromUnsignedBigInt(unlockTime)
      ),
    ])
  );
  event.address = contractAddress;
  event.block.timestamp = BigInt.fromI32(blockTimestamp);
  event.transaction.hash = hashFromTimestamp(blockTimestamp);
  return event;
}

export function createTokensUnlockedEvent(
  user: string,
  amount: BigInt,
  blockTimestamp: i32 = 0
): TokensUnlocked {
  let event = changetype<TokensUnlocked>(
    newMockEventWithParams([
      new ethereum.EventParam(
        "user",
        ethereum.Value.fromAddress(Address.fromString(user))
      ),
      new ethereum.EventParam(
        "amount",
        ethereum.Value.fromUnsignedBigInt(amount)
      ),
    ])
  );
  event.address = contractAddress;
  event.block.timestamp = BigInt.fromI32(blockTimestamp);
  event.transaction.hash = hashFromTimestamp(blockTimestamp);
  return event;
}
