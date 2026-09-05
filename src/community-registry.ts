import { BigInt, Bytes, log } from "@graphprotocol/graph-ts";
import {
  Badge,
  BadgeMintedActivity,
  Community,
  CommunityBadgeLinkedActivity,
  CommunityCreatedActivity,
  CommunityDetailsUpdatedActivity,
  MemberJoinedActivity,
} from "../generated/schema";
import {
  CommunityBadgeCreated,
  CommunityCreated,
  CommunityDetailsUpdated,
  CommunityRegistry,
} from "../generated/CommunityRegistry/CommunityRegistry";
import { findOrCreateUser } from "./user";
import {
  generateActivityId,
  upsertCommunityMembership,
} from "./utils/community-membership";

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
    if (badge.community == null) {
      const community = Community.load(communityId);
      if (community != null) {
        community.badgeCount = community.badgeCount.plus(BigInt.fromI32(1));
        community.save();

        const activityId = generateActivityId(
          event.transaction.hash,
          event.logIndex.toString(),
          "badge-linked",
        );
        const activity = new CommunityBadgeLinkedActivity(activityId);
        activity.community = communityId;
        activity.timestamp = event.block.timestamp;
        activity.blockNumber = event.block.number;
        activity.txHash = event.transaction.hash;
        activity.badge = badgeId;
        activity.save();
      }
    }
    badge.community = communityId;
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
  // Use event params as fallback values; all community details are authoritative
  // from the getCommunityDetails view call below.
  let assistantBadgeId = event.params.assistantBadgeId.toString();
  let memberBadgeId = event.params.memberBadgeId.toString();
  const creatorAddress = event.params.creator.toHexString();

  log.info(
    "Handling CommunityCreated: communityId={}, creator={}, assistantBadgeId={}, memberBadgeId={}",
    [communityId, creatorAddress, assistantBadgeId, memberBadgeId],
  );

  // By contract design, managerBadgeId == communityId (same sequential ID).
  const managerBadgeId = communityId;

  let community = Community.load(communityId);

  if (community == null) {
    community = new Community(communityId);
    community.name = "";
    community.tierId = BigInt.zero();
    community.tierName = "unaffiliated";
    community.tierExpiresAt = BigInt.zero();
    community.memberCount = BigInt.zero();
    community.badgeCount = BigInt.zero();
    community.createdAt = event.block.timestamp;
  }

  // Fetch all community details from the contract at index time.
  // This is the authoritative source for name, description, badge IDs, and createdAt.
  const contract = CommunityRegistry.bind(event.address);
  const detailsResult = contract.try_getCommunityDetails(
    event.params.communityId,
  );
  if (!detailsResult.reverted) {
    community.name = detailsResult.value.name;
    community.description = detailsResult.value.description;
    assistantBadgeId = detailsResult.value.assistantBadgeId.toString();
    memberBadgeId = detailsResult.value.memberBadgeId.toString();
    community.createdAt = detailsResult.value.createdAt;
  }

  community.managerBadge = managerBadgeId;
  community.assistantBadge = assistantBadgeId;
  community.memberBadge = memberBadgeId;
  community.managerAddress = creatorAddress;

  const manager = findOrCreateUser(creatorAddress);
  community.manager = manager.id;

  if (!manager.managedCommunities.includes(communityId)) {
    const updatedCommunities = manager.managedCommunities;
    updatedCommunities.push(communityId);
    manager.managedCommunities = updatedCommunities;
  }

  if (!manager.badges.includes(memberBadgeId)) {
    const updatedBadges = manager.badges;
    updatedBadges.push(memberBadgeId);
    manager.badges = updatedBadges;
  }

  if (!manager.communities.includes(communityId)) {
    const updatedCommunities = manager.communities;
    updatedCommunities.push(communityId);
    manager.communities = updatedCommunities;
    community.memberCount = community.memberCount.plus(BigInt.fromI32(1)); // count the creator as the first member
  }

  manager.save();

  // Generate base activity ID for all activities emitted from this event.
  const baseId = generateActivityId(
    event.transaction.hash,
    event.logIndex.toString(),
    "",
  );

  // Ensure the manager badge exists before saving the community, since
  // Community.managerBadge is non-nullable in the schema.
  let managerBadgeLinked = false;
  let managerBadge = Badge.load(managerBadgeId);
  if (managerBadge == null) {
    managerBadge = new Badge(managerBadgeId);
    managerBadge.name = `${community.name} Manager`;
    managerBadge.isOfficial = false;
    managerBadge.isCommunity = true;
    managerBadge.isProfile = false;
    managerBadge.hookAddress = new Bytes(0);
    managerBadge.creatorAddress = creatorAddress;
    managerBadge.createdAt = event.block.timestamp;
    managerBadge.createdBy = manager.id;
    managerBadge.holdersCount = BigInt.zero();
    managerBadge.minters = [];
    managerBadge.burners = [];
    managerBadge.transferers = [];
    managerBadge.community = communityId;
    managerBadge.save();
    community.badgeCount = community.badgeCount.plus(BigInt.fromI32(1));
    managerBadgeLinked = true;
  }

  // The manager badge is the community's initial metadata source. The
  // immutable Metadata entity may be processed after this chain event.
  community.metadata = managerBadge.metadata;
  community.imageUrl = null;

  // Ensure manager badge is linked (may already be set by handleCommunityBadgeCreated)
  if (managerBadge.community == null) {
    managerBadge.community = communityId;
    managerBadge.save();
    community.badgeCount = community.badgeCount.plus(BigInt.fromI32(1));
    managerBadgeLinked = true;
  }

  // Link the assistant badge to this community
  let assistantBadgeLinked = false;
  const assistantBadge = Badge.load(assistantBadgeId);

  if (assistantBadge != null) {
    if (assistantBadge.community == null) {
      community.badgeCount = community.badgeCount.plus(BigInt.fromI32(1));
      assistantBadgeLinked = true;
    }
    assistantBadge.community = communityId;
    assistantBadge.save();
  }

  // Link the member badge to this community
  let memberBadgeLinked = false;
  const memberBadge = Badge.load(memberBadgeId);

  if (memberBadge != null) {
    if (memberBadge.community == null) {
      community.badgeCount = community.badgeCount.plus(BigInt.fromI32(1));
      memberBadgeLinked = true;
    }
    memberBadge.community = communityId;
    memberBadge.save();
  }

  community.save();

  // Emit CommunityBadgeLinkedActivity for each badge linked during community creation.
  // Previously driven by CommunityBadgeCreated events; now BadgeCreated fires instead
  // and the linking context is only available here at CommunityCreated handling time.
  if (managerBadgeLinked) {
    const managerLinkedActivity = new CommunityBadgeLinkedActivity(
      baseId + "-badge-linked-" + managerBadgeId,
    );
    managerLinkedActivity.community = communityId;
    managerLinkedActivity.timestamp = event.block.timestamp.plus(
      BigInt.fromI32(1),
    );
    managerLinkedActivity.blockNumber = event.block.number;
    managerLinkedActivity.txHash = event.transaction.hash;
    managerLinkedActivity.badge = managerBadgeId;
    managerLinkedActivity.save();
  }

  if (assistantBadgeLinked) {
    const assistantLinkedActivity = new CommunityBadgeLinkedActivity(
      baseId + "-badge-linked-" + assistantBadgeId,
    );
    assistantLinkedActivity.community = communityId;
    assistantLinkedActivity.timestamp = event.block.timestamp.plus(
      BigInt.fromI32(1),
    );
    assistantLinkedActivity.blockNumber = event.block.number;
    assistantLinkedActivity.txHash = event.transaction.hash;
    assistantLinkedActivity.badge = assistantBadgeId;
    assistantLinkedActivity.save();
  }

  if (memberBadgeLinked) {
    const memberLinkedActivity = new CommunityBadgeLinkedActivity(
      baseId + "-badge-linked-" + memberBadgeId,
    );
    memberLinkedActivity.community = communityId;
    memberLinkedActivity.timestamp = event.block.timestamp.plus(
      BigInt.fromI32(1),
    );
    memberLinkedActivity.blockNumber = event.block.number;
    memberLinkedActivity.txHash = event.transaction.hash;
    memberLinkedActivity.badge = memberBadgeId;
    memberLinkedActivity.save();
  }

  const createdActivity = new CommunityCreatedActivity(
    baseId + "-community-created",
  );
  createdActivity.community = communityId;
  createdActivity.timestamp = event.block.timestamp;
  createdActivity.blockNumber = event.block.number;
  createdActivity.txHash = event.transaction.hash;
  createdActivity.creator = creatorAddress;
  createdActivity.save();

  // TransferSingle for the initial badge mints fires before CommunityCreated,
  // so badge.community is null at that point and mint() cannot create activities.
  // Emit them here instead.
  // Timestamps are offset to preserve the causal sequence of follow-up events:
  // CommunityCreated (+0) → BadgeLinked (+1) → manager mint (+2) →
  // member mint (+3) → MemberJoined (+4). In a timestamp-desc query, the
  // highest offset is shown first, so MemberJoined/mints appear before
  // CommunityCreated.
  const managerMintActivity = new BadgeMintedActivity(baseId + "-manager-mint");
  managerMintActivity.community = communityId;
  managerMintActivity.timestamp = event.block.timestamp.plus(BigInt.fromI32(2));
  managerMintActivity.blockNumber = event.block.number;
  managerMintActivity.txHash = event.transaction.hash;
  managerMintActivity.badge = managerBadgeId;
  managerMintActivity.user = manager.id;
  managerMintActivity.save();

  if (memberBadge != null) {
    const memberMintActivity = new BadgeMintedActivity(baseId + "-member-mint");
    memberMintActivity.community = communityId;
    memberMintActivity.timestamp = event.block.timestamp.plus(
      BigInt.fromI32(3),
    );
    memberMintActivity.blockNumber = event.block.number;
    memberMintActivity.txHash = event.transaction.hash;
    memberMintActivity.badge = memberBadgeId;
    memberMintActivity.user = manager.id;
    memberMintActivity.save();

    const memberJoinActivity = new MemberJoinedActivity(
      baseId + "-member-join",
    );
    memberJoinActivity.community = communityId;
    memberJoinActivity.timestamp = event.block.timestamp.plus(
      BigInt.fromI32(4),
    );
    memberJoinActivity.blockNumber = event.block.number;
    memberJoinActivity.txHash = event.transaction.hash;
    memberJoinActivity.badge = memberBadgeId;
    memberJoinActivity.user = manager.id;
    memberJoinActivity.save();

    upsertCommunityMembership(manager.id, communityId, baseId + "-member-join");
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

  const activityId = generateActivityId(
    event.transaction.hash,
    event.logIndex.toString(),
    "details-updated",
  );
  const activity = new CommunityDetailsUpdatedActivity(activityId);
  activity.community = communityId;
  activity.timestamp = event.block.timestamp;
  activity.blockNumber = event.block.number;
  activity.txHash = event.transaction.hash;
  activity.save();
}
