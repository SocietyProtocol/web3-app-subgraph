import {
  afterEach,
  assert,
  clearStore,
  describe,
  log,
  test,
} from "matchstick-as/assembly/index";
import { BigInt } from "@graphprotocol/graph-ts";
import { Community } from "../../generated/schema";

import {
  handleCommunityTierGranted,
  handleCommunityTierRevoked,
  handleTokensLocked,
  handleTokensUnlocked,
} from "../../src/vip-manager";
import {
  userAddress1,
  userAddress2,
  lockAmount1,
  lockAmount2,
  lockTimestamp,
  unlockTime1,
  unlockTime2,
  bronzeBadgeId,
  silverBadgeId,
  goldBadgeId,
} from "./constants";
import {
  createCommunityTierGrantedEvent,
  createCommunityTierRevokedEvent,
  createTokensLockedEvent,
  createTokensUnlockedEvent,
  mockTierBadgeIds,
} from "./utils";

// Helper: create and store a minimal Community entity in the mock store.
function createAndSaveCommunity(id: string): void {
  const community = new Community(id);
  community.name = "Test Community";
  community.createdAt = BigInt.fromI32(1683094249);
  community.tierId = BigInt.zero();
  community.tierName = "unaffiliated";
  community.tierExpiresAt = BigInt.zero();
  community.managerAddress = "0x0000000000000000000000000000000000000001";
  community.manager = "0x0000000000000000000000000000000000000001";
  community.managerBadge = id;
  community.memberCount = BigInt.zero();
  community.badgeCount = BigInt.zero();
  community.save();
}

describe("VipManager — handleTokensLocked", () => {
  afterEach(() => {
    clearStore();
  });

  test("creates a LockTransaction with type lock and correct fields", () => {
    let event = createTokensLockedEvent(
      userAddress1,
      lockAmount1,
      unlockTime1,
      lockTimestamp,
    );
    handleTokensLocked(event);

    let txId = event.transaction.hash.toHex();

    assert.entityCount("LockTransaction", 1);
    assert.fieldEquals("LockTransaction", txId, "type", "lock");
    assert.fieldEquals(
      "LockTransaction",
      txId,
      "userAddress",
      userAddress1.toLowerCase(),
    );
    assert.fieldEquals(
      "LockTransaction",
      txId,
      "user",
      userAddress1.toLowerCase(),
    );
    assert.fieldEquals(
      "LockTransaction",
      txId,
      "amount",
      lockAmount1.toString(),
    );
    assert.fieldEquals(
      "LockTransaction",
      txId,
      "lockDate",
      lockTimestamp.toString(),
    );
    assert.fieldEquals(
      "LockTransaction",
      txId,
      "unlockDate",
      unlockTime1.toString(),
    );

    log.success(
      "handleTokensLocked creates LockTransaction with correct fields",
      [],
    );
  });

  test("each lock call creates a separate LockTransaction", () => {
    handleTokensLocked(
      createTokensLockedEvent(
        userAddress1,
        lockAmount1,
        unlockTime1,
        lockTimestamp,
      ),
    );
    handleTokensLocked(
      createTokensLockedEvent(
        userAddress1,
        lockAmount2,
        unlockTime2,
        lockTimestamp + 1000,
      ),
    );

    assert.entityCount("LockTransaction", 2);

    log.success("each lock call creates a distinct LockTransaction", []);
  });

  test("multiple users get independent LockTransactions", () => {
    let event1 = createTokensLockedEvent(
      userAddress1,
      lockAmount1,
      unlockTime1,
      lockTimestamp,
    );
    let event2 = createTokensLockedEvent(
      userAddress2,
      lockAmount2,
      unlockTime2,
      lockTimestamp + 1,
    );
    handleTokensLocked(event1);
    handleTokensLocked(event2);

    assert.entityCount("LockTransaction", 2);
    assert.fieldEquals(
      "LockTransaction",
      event1.transaction.hash.toHex(),
      "amount",
      lockAmount1.toString(),
    );
    assert.fieldEquals(
      "LockTransaction",
      event2.transaction.hash.toHex(),
      "amount",
      lockAmount2.toString(),
    );

    log.success("multiple users get independent LockTransactions", []);
  });
});

describe("VipManager — handleTokensUnlocked", () => {
  afterEach(() => {
    clearStore();
  });

  test("creates a LockTransaction with type claim and correct fields", () => {
    handleTokensLocked(
      createTokensLockedEvent(
        userAddress1,
        lockAmount1,
        unlockTime1,
        lockTimestamp,
      ),
    );

    let unlockEvent = createTokensUnlockedEvent(
      userAddress1,
      lockAmount1,
      lockTimestamp + 1,
    );
    handleTokensUnlocked(unlockEvent);

    let txId = unlockEvent.transaction.hash.toHex();

    assert.entityCount("LockTransaction", 2);
    assert.fieldEquals("LockTransaction", txId, "type", "claim");
    assert.fieldEquals(
      "LockTransaction",
      txId,
      "userAddress",
      userAddress1.toLowerCase(),
    );
    assert.fieldEquals(
      "LockTransaction",
      txId,
      "user",
      userAddress1.toLowerCase(),
    );
    assert.fieldEquals(
      "LockTransaction",
      txId,
      "amount",
      lockAmount1.toString(),
    );

    assert.fieldEquals(
      "LockTransaction",
      txId,
      "unlockDate",
      (lockTimestamp + 1).toString(),
    );

    log.success("handleTokensUnlocked creates claim LockTransaction", []);
  });

  test("does not affect other users", () => {
    let lockEvent2 = createTokensLockedEvent(
      userAddress2,
      lockAmount2,
      unlockTime2,
      lockTimestamp + 1,
    );
    handleTokensLocked(
      createTokensLockedEvent(
        userAddress1,
        lockAmount1,
        unlockTime1,
        lockTimestamp,
      ),
    );
    handleTokensLocked(lockEvent2);

    handleTokensUnlocked(
      createTokensUnlockedEvent(userAddress1, lockAmount1, lockTimestamp + 2),
    );

    assert.fieldEquals(
      "LockTransaction",
      lockEvent2.transaction.hash.toHex(),
      "type",
      "lock",
    );

    log.success("handleTokensUnlocked does not affect other users", []);
  });

  test("unlock with no prior lock still creates a claim LockTransaction", () => {
    let unlockEvent = createTokensUnlockedEvent(
      userAddress1,
      lockAmount1,
      lockTimestamp,
    );
    handleTokensUnlocked(unlockEvent);

    assert.entityCount("LockTransaction", 1);
    assert.fieldEquals(
      "LockTransaction",
      unlockEvent.transaction.hash.toHex(),
      "type",
      "claim",
    );

    log.success(
      "handleTokensUnlocked records claim even with no prior lock tx",
      [],
    );
  });
});

describe("VipManager — handleCommunityTierGranted", () => {
  afterEach(() => {
    clearStore();
  });

  test("sets tierId, tierName, and tierExpiresAt on the Community", () => {
    createAndSaveCommunity("1");
    mockTierBadgeIds(bronzeBadgeId, silverBadgeId, goldBadgeId);

    const expiry = BigInt.fromI32(1900000000);
    handleCommunityTierGranted(
      createCommunityTierGrantedEvent(
        BigInt.fromI32(1),
        goldBadgeId, // gold
        expiry,
        lockTimestamp,
      ),
    );

    assert.fieldEquals("Community", "1", "tierId", goldBadgeId.toString());
    assert.fieldEquals("Community", "1", "tierName", "gold");
    assert.fieldEquals("Community", "1", "tierExpiresAt", expiry.toString());

    log.success("handleCommunityTierGranted sets gold tier correctly", []);
  });

  test("maps bronzeBadgeId to bronze", () => {
    createAndSaveCommunity("2");
    mockTierBadgeIds(bronzeBadgeId, silverBadgeId, goldBadgeId);

    handleCommunityTierGranted(
      createCommunityTierGrantedEvent(
        BigInt.fromI32(2),
        bronzeBadgeId,
        BigInt.fromI32(1900000001),
        lockTimestamp,
      ),
    );

    assert.fieldEquals("Community", "2", "tierId", bronzeBadgeId.toString());
    assert.fieldEquals("Community", "2", "tierName", "bronze");

    log.success("handleCommunityTierGranted maps bronzeBadgeId to bronze", []);
  });

  test("maps silverBadgeId to silver", () => {
    createAndSaveCommunity("3");
    mockTierBadgeIds(bronzeBadgeId, silverBadgeId, goldBadgeId);

    handleCommunityTierGranted(
      createCommunityTierGrantedEvent(
        BigInt.fromI32(3),
        silverBadgeId,
        BigInt.fromI32(1900000002),
        lockTimestamp,
      ),
    );

    assert.fieldEquals("Community", "3", "tierId", silverBadgeId.toString());
    assert.fieldEquals("Community", "3", "tierName", "silver");

    log.success("handleCommunityTierGranted maps silverBadgeId to silver", []);
  });

  test("unknown tierId falls back to unaffiliated", () => {
    createAndSaveCommunity("4");
    mockTierBadgeIds(bronzeBadgeId, silverBadgeId, goldBadgeId);

    const unknownId = BigInt.fromI32(99);
    handleCommunityTierGranted(
      createCommunityTierGrantedEvent(
        BigInt.fromI32(4),
        unknownId,
        BigInt.fromI32(1900000003),
        lockTimestamp,
      ),
    );

    assert.fieldEquals("Community", "4", "tierId", unknownId.toString());
    assert.fieldEquals("Community", "4", "tierName", "unaffiliated");

    log.success("unknown tierId falls back to unaffiliated", []);
  });

  test("does nothing when Community does not exist", () => {
    mockTierBadgeIds(bronzeBadgeId, silverBadgeId, goldBadgeId);
    handleCommunityTierGranted(
      createCommunityTierGrantedEvent(
        BigInt.fromI32(999),
        goldBadgeId,
        BigInt.fromI32(1900000000),
        lockTimestamp,
      ),
    );

    assert.notInStore("Community", "999");

    log.success(
      "handleCommunityTierGranted is a no-op when Community is absent",
      [],
    );
  });
});

describe("VipManager — handleCommunityTierRevoked", () => {
  afterEach(() => {
    clearStore();
  });

  test("resets tierId to 0, tierName to unaffiliated, tierExpiresAt to 0", () => {
    createAndSaveCommunity("10");

    // First grant a tier
    mockTierBadgeIds(bronzeBadgeId, silverBadgeId, goldBadgeId);
    handleCommunityTierGranted(
      createCommunityTierGrantedEvent(
        BigInt.fromI32(10),
        goldBadgeId,
        BigInt.fromI32(1900000000),
        lockTimestamp,
      ),
    );
    assert.fieldEquals("Community", "10", "tierId", goldBadgeId.toString());

    // Then revoke it
    handleCommunityTierRevoked(
      createCommunityTierRevokedEvent(BigInt.fromI32(10), lockTimestamp + 1),
    );

    assert.fieldEquals("Community", "10", "tierId", "0");
    assert.fieldEquals("Community", "10", "tierName", "unaffiliated");
    assert.fieldEquals("Community", "10", "tierExpiresAt", "0");

    log.success(
      "handleCommunityTierRevoked resets tier fields to defaults",
      [],
    );
  });

  test("does nothing when Community does not exist", () => {
    handleCommunityTierRevoked(
      createCommunityTierRevokedEvent(BigInt.fromI32(888), lockTimestamp),
    );

    assert.notInStore("Community", "888");

    log.success(
      "handleCommunityTierRevoked is a no-op when Community is absent",
      [],
    );
  });
});
