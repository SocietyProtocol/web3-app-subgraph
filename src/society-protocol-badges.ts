import { Address, BigInt, Bytes, log } from "@graphprotocol/graph-ts";
import { Badge, Community, User } from "../generated/schema";
import {
  BadgeCreated,
  BadgeModified,
  BadgePermissions,
  EditorsUpdated,
  HookUpdated,
  ProfileCreated,
  SocietyProtocolBadges,
  TransferBatch,
  TransferSingle,
  URI,
} from "../generated/SocietyProtocolBadges/SocietyProtocolBadges";
import { findOrCreateUser } from "./user";
import { fetchIpfsMetadata, getStringFromTypedMap } from "./utils/metadata";

const findOrCreateBadge = (badgeId: string, creator: string): Badge => {
  let badge = Badge.load(badgeId);

  if (badge == null) {
    const createdByUser = findOrCreateUser(creator);
    badge = new Badge(badgeId);
    badge.creatorAddress = creator;
    badge.createdBy = createdByUser.id;
    badge.name = "";
    badge.isOfficial = false;
    badge.isCommunity = false;
    badge.isProfile = false;
    badge.hookAddress = new Bytes(0);
    badge.createdAt = BigInt.zero();
    badge.uri = "";
    badge.holdersCount = BigInt.zero();
    badge.minters = [];
    badge.burners = [];
    badge.transferers = [];

    badge.save();
  }

  return badge;
};

export function handleBadgeCreated(event: BadgeCreated): void {
  log.info("Handling BadgeCreated for badge ID: {}", [
    event.params.id.toString(),
  ]);
  const badge = findOrCreateBadge(
    event.params.id.toString(),
    event.params.creator.toHexString(),
  );

  const createdByUser = findOrCreateUser(event.params.creator.toHexString());

  badge.creatorAddress = event.params.creator.toHexString();
  badge.createdBy = createdByUser.id;
  badge.name = event.params.name;
  badge.isOfficial = event.params.isOfficial;
  badge.isCommunity = event.params.isCommunity;
  badge.isProfile = false;
  badge.hookAddress = new Bytes(0);
  badge.createdAt = event.block.timestamp;

  const contract = SocietyProtocolBadges.bind(event.address);

  const uriResult = contract.try_uri(event.params.id);

  if (!uriResult.reverted) {
    badge.uri = uriResult.value;
    log.info("URI found for badge ID: {}: {}", [
      event.params.id.toString(),
      uriResult.value,
    ]);
  } else {
    log.info("URI not found for badge ID: {}", [event.params.id.toString()]);

    badge.uri = "";
  }

  const metadata = fetchIpfsMetadata(badge.uri);

  if (metadata !== null) {
    badge.imageUrl = getStringFromTypedMap(metadata, "imageUrl");
    badge.description = getStringFromTypedMap(metadata, "description");
  } else {
    badge.imageUrl = null;
    badge.description = null;
  }

  badge.save();
}

export function handleBadgeModified(event: BadgeModified): void {
  log.info("Handling BadgeModified for badge ID: {}", [
    event.params.id.toString(),
  ]);
  const badge = Badge.load(event.params.id.toString());
  if (badge == null) {
    return;
  }

  badge.name = event.params.name;
  badge.isOfficial = event.params.isOfficial;
  badge.isCommunity = event.params.isCommunity;
  badge.uri = event.params.metadataURI;
  const metadata = fetchIpfsMetadata(badge.uri);

  if (metadata !== null) {
    badge.imageUrl = getStringFromTypedMap(metadata, "imageUrl");
    badge.description = getStringFromTypedMap(metadata, "description");
  } else {
    badge.imageUrl = null;
    badge.description = null;
  }

  badge.save();
}

export function handleHookUpdated(event: HookUpdated): void {
  log.info("Handling HookUpdated for badge ID: {}", [
    event.params.id.toString(),
  ]);
  const badge = Badge.load(event.params.id.toString());
  if (badge == null) {
    return;
  }

  badge.hookAddress = event.params.hook;
  badge.save();
}

export function handleProfileCreated(event: ProfileCreated): void {
  log.info("Handling ProfileCreated for user: {}", [
    event.params.user.toHexString(),
  ]);
  const userId = event.params.user;

  const user = findOrCreateUser(userId.toHexString());

  const badge = Badge.load(event.params.id.toString());

  if (badge == null) {
    return;
  }

  user.profile = badge.id;

  const metaData = fetchIpfsMetadata(badge.uri);
  if (metaData !== null) {
    user.name = getStringFromTypedMap(metaData, "name");
    user.bio = getStringFromTypedMap(metaData, "bio");
    user.imageUrl = getStringFromTypedMap(metaData, "imageUrl");
  }

  user.save();

  badge.isProfile = true;
  badge.profileUser = user.id;
  badge.save();
}

export function handleURI(event: URI): void {
  log.info("Handling URI for badge ID: {}", [event.params.id.toString()]);
  const badge = Badge.load(event.params.id.toString());
  if (badge == null) {
    return;
  }

  badge.uri = event.params.value;

  const metaData = fetchIpfsMetadata(event.params.value);
  badge.imageUrl =
    metaData !== null ? getStringFromTypedMap(metaData, "imageUrl") : null;
  badge.description =
    metaData !== null ? getStringFromTypedMap(metaData, "description") : null;
  badge.save();

  if (badge.isProfile && badge.profileUser != null) {
    const user = User.load(badge.profileUser!);
    if (user != null && metaData !== null) {
      user.name = getStringFromTypedMap(metaData, "name");
      user.bio = getStringFromTypedMap(metaData, "bio");
      user.imageUrl = getStringFromTypedMap(metaData, "imageUrl");
      user.save();
    }
  }

  if (badge.community != null) {
    const community = Community.load(badge.community!);
    if (community != null && metaData !== null) {
      community.imageUrl = getStringFromTypedMap(metaData, "imageUrl");
      community.save();
    }
  }
}

export function mint(badgeId: BigInt, userId: Address, value: BigInt): void {
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

  // If this badge is a community member badge, add user to the community.
  // We identify member badges by comparing badge.id to community.managerBadge
  // because both manager and member badges have isCommunity=true on-chain.
  if (badge.community != null) {
    const community = Community.load(badge.community!);

    if (
      community != null &&
      badge.id != community.managerBadge &&
      !user.communities.includes(community.id)
    ) {
      const updatedCommunities = user.communities;
      updatedCommunities.push(community.id);
      user.communities = updatedCommunities;
      user.save();
      community.memberCount = community.memberCount.plus(BigInt.fromI32(1));
      community.save();
    }
  }
}

export function burn(badgeId: BigInt, userId: Address, value: BigInt): void {
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

    // If this badge is a community member badge, remove user from the community.
    // We identify member badges by comparing badge.id to community.managerBadge
    // because both manager and member badges have isCommunity=true on-chain.
    if (badge.community != null) {
      const community = Community.load(badge.community!);
      if (community != null && badge.id != community.managerBadge) {
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

  if (alreadyHasBadge) {
    return;
  }

  const updatedBadges = toUser.badges;
  updatedBadges.push(badge.id);
  toUser.badges = updatedBadges;
  toUser.save();

  // Use community.managerBadge to distinguish manager vs member badge
  // because both badge types have isCommunity=true on-chain.
  if (badge.community != null) {
    const community = Community.load(badge.community!);
    if (community != null && badge.id == community.managerBadge) {
      // Remove community from old manager's managedCommunities
      const oldManagerIndex = fromUser.managedCommunities.indexOf(community.id);
      if (oldManagerIndex >= 0) {
        const updatedCommunities = fromUser.managedCommunities;
        updatedCommunities.splice(oldManagerIndex, 1);
        fromUser.managedCommunities = updatedCommunities;
        fromUser.save();
      }

      // Add community to new manager's managedCommunities
      if (!toUser.managedCommunities.includes(community.id)) {
        const updatedCommunities = toUser.managedCommunities;
        updatedCommunities.push(community.id);
        toUser.managedCommunities = updatedCommunities;
        toUser.save();
      }

      community.managerAddress = toUserId.toHexString();
      community.manager = toUserId.toHexString();
      community.save();
    }
  }

  // If this badge is a community member badge, transfer membership
  if (badge.community != null) {
    const community = Community.load(badge.community!);
    if (community != null && badge.id != community.managerBadge) {
      // Remove membership from old holder
      const fromIndex = fromUser.communities.indexOf(community.id);
      if (fromIndex >= 0) {
        const fromCommunities = fromUser.communities;
        fromCommunities.splice(fromIndex, 1);
        fromUser.communities = fromCommunities;
        fromUser.save();
        community.memberCount = community.memberCount.minus(BigInt.fromI32(1));
        community.save();
      }
      // Add membership to new holder
      if (!toUser.communities.includes(community.id)) {
        const toCommunities = toUser.communities;
        toCommunities.push(community.id);
        toUser.communities = toCommunities;
        toUser.save();
        community.memberCount = community.memberCount.plus(BigInt.fromI32(1));
        community.save();
      }
    }
  }
}

export function handleTransferSingle(event: TransferSingle): void {
  log.info("Handling TransferSingle for badge ID: {}, from: {}, to: {}", [
    event.params.id.toString(),
    event.params.from.toHexString(),
    event.params.to.toHexString(),
  ]);
  // Minting
  if (
    event.params.from.toHexString() ==
    "0x0000000000000000000000000000000000000000"
  ) {
    mint(event.params.id, event.params.to, event.params.value);
  }

  // Burning
  else if (
    event.params.to.toHexString() ==
    "0x0000000000000000000000000000000000000000"
  ) {
    burn(event.params.id, event.params.from, event.params.value);
  }

  // Transferring
  else {
    transfer(
      event.params.id,
      event.params.from,
      event.params.to,
      event.params.value,
    );
  }
}

export function handleTransferBatch(event: TransferBatch): void {
  log.info("Handling TransferBatch for badge IDs: {}", [
    event.params.ids.map<string>((id) => id.toString()).join(", "),
  ]);
  const from = event.params.from;
  const to = event.params.to;

  for (let i = 0; i < event.params.ids.length; i++) {
    const badgeId = event.params.ids[i];
    // Minting
    if (from.toHexString() == "0x0000000000000000000000000000000000000000") {
      mint(badgeId, to, event.params.values[i]);
    }
    // Burning
    else if (to.toHexString() == "0x0000000000000000000000000000000000000000") {
      burn(badgeId, from, event.params.values[i]);
    }
    // Transferring
    else {
      transfer(badgeId, from, to, event.params.values[i]);
    }
  }
}

export function handleEditorsUpdated(event: EditorsUpdated): void {
  log.info("Handling EditorsUpdated for badge ID: {}", [
    event.params.id.toString(),
  ]);
  const badge = findOrCreateBadge(
    event.params.id.toString(),
    event.transaction.from.toHexString(),
  );

  const manager = findOrCreateUser(event.params.editor.toHexString());

  if (event.params.isAllowed) {
    if (!manager.managedBadges.includes(badge.id)) {
      const updatedBadges = manager.managedBadges;
      updatedBadges.push(badge.id);
      manager.managedBadges = updatedBadges;
      manager.save();
    }
  } else {
    const index = manager.managedBadges.indexOf(badge.id);
    if (index < 0) {
      return;
    }
    const updatedBadges = manager.managedBadges;
    updatedBadges.splice(index, 1);
    manager.managedBadges = updatedBadges;
    manager.save();
  }
}

function bigIntArrayToStringArray(arr: Array<BigInt>): string[] {
  const result: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    result.push(arr[i].toString());
  }
  return result;
}

export function handleBadgePermissions(event: BadgePermissions): void {
  log.info("Handling BadgePermissions for badge ID: {}", [
    event.params.id.toString(),
  ]);
  const badge = findOrCreateBadge(
    event.params.id.toString(),
    event.transaction.from.toHexString(),
  );

  badge.minters = bigIntArrayToStringArray(event.params.minters);
  badge.burners = bigIntArrayToStringArray(event.params.burners);
  badge.transferers = bigIntArrayToStringArray(event.params.transferers);

  // Note: event.params.editors is intentionally not stored here as a separate array.
  // Editor permissions are managed through the EditorsUpdated event handler.

  badge.save();
}
