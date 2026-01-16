import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { Badge, User } from "../generated/schema";
import {
  BadgeCreated,
  HookUpdated,
  ProfileCreated,
  TransferBatch,
  TransferSingle,
  URI,
} from "../generated/SocietyProtocolBadges/SocietyProtocolBadges";

const findOrCreateUser = (userId: string): User => {
  let user = User.load(userId);

  if (user == null) {
    user = new User(userId);
    user.badges = [];
    user.save();
  }

  return user;
};

export function handleBadgeCreated(event: BadgeCreated): void {
  const badge = new Badge(event.params.id.toString());

  const createdByUser = findOrCreateUser(event.transaction.from.toHexString());

  badge.createdBy = createdByUser.id;
  badge.name = event.params.name;
  badge.isOfficial = event.params.isOfficial;
  badge.isCommunity = event.params.isCommunity;
  badge.hookAddress = new Bytes(0);
  badge.createdAt = event.block.timestamp;
  badge.uri = "";
  badge.save();
}

export function handleHookUpdated(event: HookUpdated): void {
  const badge = Badge.load(event.params.id.toString());
  if (badge == null) {
    return;
  }

  badge.hookAddress = event.params.hook;
  badge.save();
}

export function handleProfileCreated(event: ProfileCreated): void {
  const userId = event.params.user;

  const user = findOrCreateUser(userId.toHexString());

  const badge = Badge.load(event.params.id.toString());

  if (badge == null) {
    return;
  }

  user.profile = badge.id;
  user.save();
}

export function handleURI(event: URI): void {
  const badge = Badge.load(event.params.id.toString());
  if (badge == null) {
    return;
  }

  badge.uri = event.params.value;
  badge.save();
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
  user.badges = user.badges.concat([badge.id]);
  user.save();
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
  }
}

export function transfer(
  badgeId: BigInt,
  fromUserId: Address,
  toUserId: Address,
  value: BigInt
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

  toUser.badges = toUser.badges.concat([badge.id]);
  toUser.save();
}

export function handleTransferSingle(event: TransferSingle): void {
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
      event.params.value
    );
  }
}

export function handleTransferBatch(event: TransferBatch): void {
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
