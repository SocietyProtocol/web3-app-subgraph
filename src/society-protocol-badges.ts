import {
  Address,
  BigInt,
  Bytes,
  ipfs,
  json,
  log,
} from "@graphprotocol/graph-ts";
import { Badge, User } from "../generated/schema";
import {
  BadgeCreated,
  EditorsUpdated,
  HookUpdated,
  ProfileCreated,
  SocietyProtocolBadges,
  TransferBatch,
  TransferSingle,
  URI,
} from "../generated/SocietyProtocolBadges/SocietyProtocolBadges";

const findOrCreateUser = (userId: string): User => {
  let user = User.load(userId);

  if (user == null) {
    user = new User(userId);
    user.badges = [];
    user.managedBadges = [];
    user.save();
  }

  return user;
};

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
    badge.hookAddress = new Bytes(0);
    badge.createdAt = BigInt.zero();
    badge.uri = "";
    badge.holdersCount = BigInt.zero();

    badge.save();
  }

  return badge;
};

const getImageUrlFromMetadata = (uri: string | null): string | null => {
  if (uri !== null && uri.includes("/ipfs/")) {
    const parts = uri.split("/ipfs/");
    if (parts.length > 1) {
      const hash = parts[parts.length - 1];

      const metadata = ipfs.cat(hash);

      if (metadata !== null) {
        const jsonData = json.fromBytes(metadata).toObject();

        const imageUrl = jsonData.get("imageUrl");

        if (imageUrl !== null) {
          return imageUrl.toString();
        }
      }
    }
  }
  return null;
};

export function handleBadgeCreated(event: BadgeCreated): void {
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
  badge.hookAddress = new Bytes(0);
  badge.createdAt = event.block.timestamp;

  const contract = SocietyProtocolBadges.bind(event.address);

  const uriResult = contract.try_uri(event.params.id);

  if (!uriResult.reverted) {
    badge.uri = uriResult.value;
  } else {
    badge.uri = "";
  }

  badge.imageUrl = getImageUrlFromMetadata(badge.uri);

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

  badge.imageUrl = getImageUrlFromMetadata(event.params.value);

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

  const updatedBadges = user.badges;
  updatedBadges.push(badge.id);
  user.badges = updatedBadges;
  user.save();

  badge.holdersCount = badge.holdersCount.plus(BigInt.fromI32(1));
  badge.save();
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
      event.params.value,
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

export function handleEditorsUpdated(event: EditorsUpdated): void {
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
