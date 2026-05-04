import { Address, BigInt, Bytes, store } from "@graphprotocol/graph-ts";
import {
  Badge,
  BadgeBurnedActivity,
  BadgeMintedActivity,
  Community,
  CommunityMembership,
  ManagerChangedActivity,
  MemberJoinedActivity,
  MemberLeftActivity,
  MemberTransferredActivity,
} from "../../generated/schema";
import { findOrCreateUser } from "../user";

export function generateActivityId(
  txHash: Bytes,
  logIndex: string,
  suffix: string,
): string {
  if (suffix.length > 0) {
    return txHash.toHex() + "-" + logIndex + "-" + suffix;
  }
  return txHash.toHex() + "-" + logIndex;
}

export function generateMembershipId(
  userId: string,
  communityId: string,
): string {
  return userId + "-" + communityId;
}

export function upsertCommunityMembership(
  userId: string,
  communityId: string,
  joinActivityId: string,
): void {
  const membershipId = generateMembershipId(userId, communityId);
  let membership = CommunityMembership.load(membershipId);
  if (membership == null) {
    membership = new CommunityMembership(membershipId);
    membership.user = userId;
    membership.community = communityId;
  }
  membership.joinActivity = joinActivityId;
  membership.save();
}

export function mint(
  badgeId: BigInt,
  userId: Address,
  value: BigInt,
  txHash: Bytes,
  blockTimestamp: BigInt,
  blockNumber: BigInt,
  logIndex: string,
): void {
  const badge = Badge.load(badgeId.toString());
  const user = findOrCreateUser(userId.toHexString());

  if (badge == null) {
    return;
  }

  const alreadyHasBadge = user.badges.indexOf(badge.id) >= 0;

  if (alreadyHasBadge) {
    return;
  }

  const updatedBadges = user.badges;
  updatedBadges.push(badge.id);
  user.badges = updatedBadges;
  user.save();

  badge.holdersCount = badge.holdersCount.plus(BigInt.fromI32(1));
  badge.save();

  if (badge.community != null) {
    const community = Community.load(badge.community!);
    if (community != null) {
      // Always record the badge mint
      const mintActivityId = generateActivityId(
        txHash,
        logIndex,
        "badge-minted",
      );
      const mintActivity = new BadgeMintedActivity(mintActivityId);
      mintActivity.community = community.id;
      mintActivity.timestamp = blockTimestamp;
      mintActivity.blockNumber = blockNumber;
      mintActivity.txHash = txHash;
      mintActivity.badge = badge.id;
      mintActivity.user = user.id;
      mintActivity.save();

      if (badge.id == community.managerBadge) {
        // Manager badge mint → track manager joining their community
        if (!user.managedCommunities.includes(community.id)) {
          const updatedManaged = user.managedCommunities;
          updatedManaged.push(community.id);
          user.managedCommunities = updatedManaged;
          user.save();
        }
      } else if (!user.communities.includes(community.id)) {
        // Member badge mint → user joins community
        const updatedCommunities = user.communities;
        updatedCommunities.push(community.id);
        user.communities = updatedCommunities;
        user.save();
        community.memberCount = community.memberCount.plus(BigInt.fromI32(1));
        community.save();

        const joinActivityId = generateActivityId(
          txHash,
          logIndex,
          "member-join",
        );
        const joinActivity = new MemberJoinedActivity(joinActivityId);
        joinActivity.community = community.id;
        joinActivity.timestamp = blockTimestamp.plus(BigInt.fromI32(1)); // ensure ordering after mint activity
        joinActivity.blockNumber = blockNumber;
        joinActivity.txHash = txHash;
        joinActivity.badge = badge.id;
        joinActivity.user = user.id;
        joinActivity.save();

        upsertCommunityMembership(user.id, community.id, joinActivityId);
      }
    }
  }
}

export function burn(
  badgeId: BigInt,
  userId: Address,
  value: BigInt,
  txHash: Bytes,
  blockTimestamp: BigInt,
  blockNumber: BigInt,
  logIndex: string,
): void {
  const badge = Badge.load(badgeId.toString());
  const user = findOrCreateUser(userId.toHexString());

  if (badge == null) {
    return;
  }

  const badgeIndex = user.badges.indexOf(badge.id);

  if (badgeIndex >= 0) {
    const updatedBadges = user.badges;
    updatedBadges.splice(badgeIndex, 1);
    user.badges = updatedBadges;
    user.save();

    badge.holdersCount = badge.holdersCount.minus(BigInt.fromI32(1));
    badge.save();

    if (badge.community != null) {
      const community = Community.load(badge.community!);
      if (community != null) {
        const burnActivityId = generateActivityId(
          txHash,
          logIndex,
          "badge-burned",
        );
        const burnActivity = new BadgeBurnedActivity(burnActivityId);
        burnActivity.community = community.id;
        burnActivity.timestamp = blockTimestamp;
        burnActivity.blockNumber = blockNumber;
        burnActivity.txHash = txHash;
        burnActivity.badge = badge.id;
        burnActivity.user = user.id;
        burnActivity.save();

        if (badge.id != community.managerBadge) {
          // Non-manager community badge burned → user may leave community
          const communityIndex = user.communities.indexOf(community.id);
          if (communityIndex >= 0) {
            const updatedCommunities = user.communities;
            updatedCommunities.splice(communityIndex, 1);
            user.communities = updatedCommunities;
            user.save();
            community.memberCount = community.memberCount.minus(
              BigInt.fromI32(1),
            );
            community.save();

            const activityId = generateActivityId(
              txHash,
              logIndex,
              "member-left",
            );
            const activity = new MemberLeftActivity(activityId);
            activity.community = community.id;
            activity.timestamp = blockTimestamp.plus(BigInt.fromI32(1)); // ensure ordering after burn activity
            activity.blockNumber = blockNumber;
            activity.txHash = txHash;
            activity.badge = badge.id;
            activity.user = user.id;
            activity.save();

            const membershipId = generateMembershipId(user.id, community.id);
            if (CommunityMembership.load(membershipId) != null) {
              store.remove("CommunityMembership", membershipId);
            }
          }
        }
      }
    }
  }
}

export function transfer(
  badgeId: BigInt,
  fromUserId: Address,
  toUserId: Address,
  value: BigInt,
  txHash: Bytes,
  blockTimestamp: BigInt,
  blockNumber: BigInt,
  logIndex: string,
): void {
  const badge = Badge.load(badgeId.toString());
  const fromUser = findOrCreateUser(fromUserId.toHexString());
  const toUser = findOrCreateUser(toUserId.toHexString());

  if (badge == null) {
    return;
  }

  const badgeIndex = fromUser.badges.indexOf(badge.id);

  if (badgeIndex >= 0) {
    const updatedBadges = fromUser.badges;
    updatedBadges.splice(badgeIndex, 1);
    fromUser.badges = updatedBadges;
    fromUser.save();
  }

  const alreadyHasBadge = toUser.badges.indexOf(badge.id) >= 0;

  if (!alreadyHasBadge) {
    const updatedBadges = toUser.badges;
    updatedBadges.push(badge.id);
    toUser.badges = updatedBadges;
    toUser.save();
  }

  if (badge.community != null) {
    const community = Community.load(badge.community!);

    if (community != null && badge.id == community.managerBadge) {
      // Manager badge transfer → change community manager
      const oldManagerIndex = fromUser.managedCommunities.indexOf(community.id);
      if (oldManagerIndex >= 0) {
        const updatedCommunities = fromUser.managedCommunities;
        updatedCommunities.splice(oldManagerIndex, 1);
        fromUser.managedCommunities = updatedCommunities;
        fromUser.save();
      }

      if (!toUser.managedCommunities.includes(community.id)) {
        const updatedCommunities = toUser.managedCommunities;
        updatedCommunities.push(community.id);
        toUser.managedCommunities = updatedCommunities;
        toUser.save();
      }

      community.managerAddress = toUserId.toHexString();
      community.manager = toUserId.toHexString();
      community.save();

      const activityId = generateActivityId(
        txHash,
        logIndex,
        "manager-changed",
      );
      const activity = new ManagerChangedActivity(activityId);
      activity.community = community.id;
      activity.timestamp = blockTimestamp;
      activity.blockNumber = blockNumber;
      activity.txHash = txHash;
      activity.badge = badge.id;
      activity.fromManager = fromUserId.toHexString();
      activity.toManager = toUserId.toHexString();
      activity.save();
    } else if (community != null) {
      // Member badge transfer → transfer community membership
      const fromIndex = fromUser.communities.indexOf(community.id);
      if (fromIndex >= 0) {
        const fromCommunities = fromUser.communities;
        fromCommunities.splice(fromIndex, 1);
        fromUser.communities = fromCommunities;
        fromUser.save();
        community.memberCount = community.memberCount.minus(BigInt.fromI32(1));
        community.save();
      }

      if (!alreadyHasBadge && !toUser.communities.includes(community.id)) {
        const toCommunities = toUser.communities;
        toCommunities.push(community.id);
        toUser.communities = toCommunities;
        toUser.save();
        community.memberCount = community.memberCount.plus(BigInt.fromI32(1));
        community.save();

        const activityId = generateActivityId(
          txHash,
          logIndex,
          "member-transferred",
        );
        const activity = new MemberTransferredActivity(activityId);
        activity.community = community.id;
        activity.timestamp = blockTimestamp;
        activity.blockNumber = blockNumber;
        activity.txHash = txHash;
        activity.badge = badge.id;
        activity.fromUser = fromUserId.toHexString();
        activity.toUser = toUserId.toHexString();
        activity.save();
      }
    }
  }
}
