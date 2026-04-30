import { Address, BigInt } from "@graphprotocol/graph-ts";
import {
  CommunityTierGranted,
  CommunityTierRevoked,
  SocietyVipManager,
  TokensLocked,
  TokensUnlocked,
} from "../generated/SocietyVipManager/SocietyVipManager";
import { Community, LockTransaction } from "../generated/schema";
import { findOrCreateUser } from "./user";

function tierIdToName(tierId: BigInt, contractAddress: Address): string {
  const contract = SocietyVipManager.bind(contractAddress);

  const bronzeResult = contract.try_bronzeBadgeId();
  if (!bronzeResult.reverted && tierId.equals(bronzeResult.value))
    return "bronze";

  const silverResult = contract.try_silverBadgeId();
  if (!silverResult.reverted && tierId.equals(silverResult.value))
    return "silver";

  const goldResult = contract.try_goldBadgeId();
  if (!goldResult.reverted && tierId.equals(goldResult.value)) return "gold";

  return "unaffiliated";
}

export function handleCommunityTierGranted(event: CommunityTierGranted): void {
  const communityId = event.params.communityId.toString();
  const community = Community.load(communityId);
  if (community == null) return;

  community.tierId = event.params.tierId;
  community.tierName = tierIdToName(event.params.tierId, event.address);
  community.tierExpiresAt = event.params.expiry;
  community.save();
}

export function handleCommunityTierRevoked(event: CommunityTierRevoked): void {
  const communityId = event.params.communityId.toString();
  const community = Community.load(communityId);
  if (community == null) return;

  community.tierId = BigInt.zero();
  community.tierName = "unaffiliated";
  community.tierExpiresAt = BigInt.zero();
  community.save();
}

export function handleTokensLocked(event: TokensLocked): void {
  let userId = event.params.user.toHex();
  let tx = new LockTransaction(event.transaction.hash.toHex());
  tx.userAddress = event.params.user;

  findOrCreateUser(event.params.user.toHexString());

  tx.user = userId;
  tx.amount = event.params.amount;
  tx.lockDate = event.block.timestamp;
  tx.unlockDate = event.params.unlockTime;
  tx.type = "lock";
  tx.save();
}

export function handleTokensUnlocked(event: TokensUnlocked): void {
  let userId = event.params.user.toHex();
  let tx = new LockTransaction(event.transaction.hash.toHex());
  tx.userAddress = event.params.user;

  findOrCreateUser(event.params.user.toHexString());

  tx.user = userId;
  tx.amount = event.params.amount;
  tx.lockDate = null;
  tx.unlockDate = event.block.timestamp;
  tx.type = "claim";
  tx.save();
}
