import {
  afterEach,
  assert,
  clearStore,
  describe,
  log,
  test,
} from "matchstick-as/assembly/index";

import {
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
} from "./constants";
import { createTokensLockedEvent, createTokensUnlockedEvent } from "./utils";

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
