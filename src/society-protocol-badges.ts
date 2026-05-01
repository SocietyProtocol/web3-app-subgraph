import { BigInt, Bytes, log } from "@graphprotocol/graph-ts";
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
import { findOrCreateBadge, bigIntArrayToStringArray } from "./utils/badge";
import { mint, burn, transfer } from "./utils/community-membership";

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
    mint(
      event.params.id,
      event.params.to,
      event.params.value,
      event.transaction.hash,
      event.block.timestamp,
      event.block.number,
      event.logIndex.toString(),
    );
  }

  // Burning
  else if (
    event.params.to.toHexString() ==
    "0x0000000000000000000000000000000000000000"
  ) {
    burn(
      event.params.id,
      event.params.from,
      event.params.value,
      event.transaction.hash,
      event.block.timestamp,
      event.block.number,
      event.logIndex.toString(),
    );
  }

  // Transferring
  else {
    transfer(
      event.params.id,
      event.params.from,
      event.params.to,
      event.params.value,
      event.transaction.hash,
      event.block.timestamp,
      event.block.number,
      event.logIndex.toString(),
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
    const logKey = event.logIndex.toString() + "-" + i.toString();
    // Minting
    if (from.toHexString() == "0x0000000000000000000000000000000000000000") {
      mint(
        badgeId,
        to,
        event.params.values[i],
        event.transaction.hash,
        event.block.timestamp,
        event.block.number,
        logKey,
      );
    }
    // Burning
    else if (to.toHexString() == "0x0000000000000000000000000000000000000000") {
      burn(
        badgeId,
        from,
        event.params.values[i],
        event.transaction.hash,
        event.block.timestamp,
        event.block.number,
        logKey,
      );
    }
    // Transferring
    else {
      transfer(
        badgeId,
        from,
        to,
        event.params.values[i],
        event.transaction.hash,
        event.block.timestamp,
        event.block.number,
        logKey,
      );
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
