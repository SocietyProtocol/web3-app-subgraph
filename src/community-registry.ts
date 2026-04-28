import { BigInt, log } from "@graphprotocol/graph-ts";
import { Badge, Community } from "../generated/schema";
import {
  CommunityBadgeCreated,
  CommunityCreated,
  CommunityDetailsUpdated,
  CommunityRegistry,
} from "../generated/CommunityRegistry/CommunityRegistry";
import { findOrCreateUser } from "./user";
import { fetchIpfsMetadata, getStringFromTypedMap } from "./utils/metadata";

/**
 * Maps a tier string to its numeric rank.
 * unaffiliated=0, bronze=100, silver=10000, gold=1000000
 */
function tierToRank(tier: string): BigInt {
  if (tier == "bronze") return BigInt.fromI32(100);
  if (tier == "silver") return BigInt.fromI32(10000);
  if (tier == "gold") return BigInt.fromI32(1000000);
  return BigInt.zero(); // unaffiliated
}

/**
 * CommunityBadgeCreated fires for any community-scoped badge created via
 * createCommunityBadge. Links the badge to its community.
 */
export function handleCommunityBadgeCreated(
  event: CommunityBadgeCreated,
): void {
  const communityId = event.params.communityId.toString();
  const badgeId = event.params.badgeId.toString();

  log.info("Handling CommunityBadgeCreated: communityId={}, badgeId={}", [
    communityId,
    badgeId,
  ]);

  // Link this badge back to the community
  const badge = Badge.load(badgeId);
  if (badge != null) {
    badge.communityId = communityId;
    badge.save();
  }
}

/**
 * CommunityCreated fires after badge creation on SocietyProtocolBadges.
 * By contract design the manager badge ID equals the communityId (same
 * sequential ID), so community.managerBadge = communityId.
 */
export function handleCommunityCreated(event: CommunityCreated): void {
  const communityId = event.params.communityId.toString();
  const memberBadgeId = event.params.memberBadgeId.toString();
  const creatorAddress = event.params.creator.toHexString();

  log.info(
    "Handling CommunityCreated: communityId={}, creator={}, memberBadgeId={}",
    [communityId, creatorAddress, memberBadgeId],
  );

  // By contract design, managerBadgeId == communityId (same sequential ID).
  const managerBadgeId = communityId;

  let community = Community.load(communityId);

  if (community == null) {
    community = new Community(communityId);
    community.name = "";
    community.tier = "unaffiliated";
    community.tierRank = BigInt.zero();
    community.memberCount = BigInt.zero();
    community.createdAt = event.block.timestamp;
  }

  community.managerBadge = managerBadgeId;
  community.memberBadge = memberBadgeId;
  community.managerAddress = creatorAddress;

  // Fetch name and description from the contract at index time
  const contract = CommunityRegistry.bind(event.address);
  const detailsResult = contract.try_getCommunityDetails(
    event.params.communityId,
  );
  if (!detailsResult.reverted) {
    community.name = detailsResult.value.name;
    community.description = detailsResult.value.description;
  }

  const manager = findOrCreateUser(creatorAddress);
  community.manager = manager.id;

  if (!manager.managedCommunities.includes(communityId)) {
    const updatedCommunities = manager.managedCommunities;
    updatedCommunities.push(communityId);
    manager.managedCommunities = updatedCommunities;
    manager.save();
  }

  // Ensure the manager badge exists before saving the community, since
  // Community.managerBadge is non-nullable in the schema.
  let managerBadge = Badge.load(managerBadgeId);
  if (managerBadge == null) {
    managerBadge = new Badge(managerBadgeId);
    managerBadge.name = `${community.name} Manager`;
    managerBadge.isOfficial = false;
    managerBadge.isCommunity = true;
    managerBadge.isProfile = false;
    managerBadge.creatorAddress = creatorAddress;
    managerBadge.createdAt = event.block.timestamp;
    managerBadge.communityId = communityId;
    managerBadge.save();
  }

  const badgeImageUrl = managerBadge.imageUrl;
  if (badgeImageUrl != null) {
    community.imageUrl = badgeImageUrl;
  }

  const metaData = fetchIpfsMetadata(managerBadge.uri);

  if (metaData !== null) {
    const tier = getStringFromTypedMap(metaData, "tier");
    if (tier !== null) {
      community.tier = tier;
      community.tierRank = tierToRank(tier);
    }
  } else {
    community.tier = "unaffiliated";
    community.tierRank = BigInt.zero();
  }

  // Ensure manager badge is linked (may already be set by handleCommunityBadgeCreated)
  if (managerBadge.communityId == null) {
    managerBadge.communityId = communityId;
    managerBadge.save();
  }

  community.save();

  // Link the member badge to this community
  const memberBadge = Badge.load(memberBadgeId);
  if (memberBadge != null) {
    memberBadge.communityId = communityId;
    memberBadge.save();
  }
}

/**
 * CommunityDetailsUpdated fires when name/description are changed, and also
 * during community creation. Community entity ID = registry communityId.
 */
export function handleCommunityDetailsUpdated(
  event: CommunityDetailsUpdated,
): void {
  const communityId = event.params.communityId.toString();

  log.info("Handling CommunityDetailsUpdated: communityId={}, name={}", [
    communityId,
    event.params.name,
  ]);

  const community = Community.load(communityId);
  if (community == null) {
    log.warning("Community not found for communityId={}", [communityId]);
    return;
  }

  community.name = event.params.name;
  community.description = event.params.description;
  community.save();
}
