import { BigInt } from "@graphprotocol/graph-ts";
import { generateActivityId } from "./utils/community-membership";
import {
  CommunityTierGranted,
  CommunityTierRevoked,
  TokensLocked,
  TokensUnlocked,
} from "../generated/SocietyVipManager/SocietyVipManager";
import {
  Community,
  CommunityTierGrantedActivity,
  CommunityTierRevokedActivity,
  LockTransaction,
} from "../generated/schema";
import { findOrCreateUser } from "./user";

const TIER_ID_BRONZE = BigInt.fromI32(1);
const TIER_ID_SILVER = BigInt.fromI32(2);
const TIER_ID_GOLD = BigInt.fromI32(3);

function tierIdToName(tierId: BigInt): string {
  if (tierId.equals(TIER_ID_BRONZE)) return "bronze";
  if (tierId.equals(TIER_ID_SILVER)) return "silver";
  if (tierId.equals(TIER_ID_GOLD)) return "gold";
  return "unaffiliated";
}

export function handleCommunityTierGranted(event: CommunityTierGranted): void {
  const communityId = event.params.communityId.toString();
  const community = Community.load(communityId);
  if (community == null) return;

  const tierName = tierIdToName(event.params.tierId);
  community.tierId = event.params.tierId;
  community.tierName = tierName;
  community.tierExpiresAt = event.params.expiry;
  community.save();

  const activityId = generateActivityId(
    event.transaction.hash,
    event.logIndex.toString(),
    "tier-granted",
  );
  const activity = new CommunityTierGrantedActivity(activityId);
  activity.community = communityId;
  activity.timestamp = event.block.timestamp;
  activity.blockNumber = event.block.number;
  activity.txHash = event.transaction.hash;
  activity.tierId = event.params.tierId;
  activity.tierName = tierName;
  activity.tierExpiresAt = event.params.expiry;
  activity.save();
}

export function handleCommunityTierRevoked(event: CommunityTierRevoked): void {
  const communityId = event.params.communityId.toString();
  const community = Community.load(communityId);
  if (community == null) return;

  const previousTierId = community.tierId;
  const previousTierName = community.tierName;

  community.tierId = BigInt.zero();
  community.tierName = "unaffiliated";
  community.tierExpiresAt = BigInt.zero();
  community.save();

  const activityId = generateActivityId(
    event.transaction.hash,
    event.logIndex.toString(),
    "tier-revoked",
  );
  const activity = new CommunityTierRevokedActivity(activityId);
  activity.community = communityId;
  activity.timestamp = event.block.timestamp;
  activity.blockNumber = event.block.number;
  activity.txHash = event.transaction.hash;
  activity.previousTierId = previousTierId;
  activity.previousTierName = previousTierName;
  activity.save();
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
