import {
  afterEach,
  assert,
  clearStore,
  describe,
  log,
  test,
} from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { Badge, User } from "../generated/schema";
import {
  handleBadgeCreated,
  handleHookUpdated,
  handleProfileCreated,
  handleTransferBatch,
  handleTransferSingle,
  handleURI,
} from "../src/society-protocol-badges";
import {
  createBadgeCreatedEvent,
  createHookUpdatedEvent,
  createPermissionsUpdatedEvent,
  createProfileCreatedEvent,
  createTransferBatchEvent,
  createTransferSingleEvent,
  createURIEvent,
  ZERO_ADDRESS,
} from "./society-protocol-badges-utils";

describe("Society Protocol Badges Mappings", () => {
  afterEach(() => {
    clearStore();
  });

  describe("handleBadgeCreated", () => {
    test("Should create a new badge with correct properties", () => {
      const badgeId = BigInt.fromI32(1);
      const badgeName = "Test Badge";
      const isOfficial = true;
      const timestamp = BigInt.fromI32(1683094249);

      const badgeCreatedEvent = createBadgeCreatedEvent(
        badgeId,
        badgeName,
        isOfficial,
        timestamp
      );

      handleBadgeCreated(badgeCreatedEvent);

      // Assert the badge was created
      assert.fieldEquals("Badge", "1", "id", "1");
      assert.fieldEquals("Badge", "1", "name", badgeName);
      assert.fieldEquals("Badge", "1", "isOfficial", "true");
      assert.fieldEquals("Badge", "1", "createdAt", timestamp.toString());
      assert.fieldEquals("Badge", "1", "hookAddress", "0x");

      log.success("Badge created successfully", []);
    });

    test("Should create a non-official badge", () => {
      const badgeId = BigInt.fromI32(2);
      const badgeName = "Community Badge";
      const isOfficial = false;
      const timestamp = BigInt.fromI32(1683094250);

      const badgeCreatedEvent = createBadgeCreatedEvent(
        badgeId,
        badgeName,
        isOfficial,
        timestamp
      );

      handleBadgeCreated(badgeCreatedEvent);

      assert.fieldEquals("Badge", "2", "id", "2");
      assert.fieldEquals("Badge", "2", "name", badgeName);
      assert.fieldEquals("Badge", "2", "isOfficial", "false");

      log.success("Non-official badge created successfully", []);
    });
  });

  describe("handleHookUpdated", () => {
    test("Should update hook address for existing badge", () => {
      // Create a badge first
      const badge = new Badge("1");
      badge.name = "Test Badge";
      badge.isOfficial = true;
      badge.hookAddress = new Bytes(0);
      badge.createdAt = BigInt.fromI32(1683094249);
      badge.uri = "";
      badge.save();

      const hookAddress = Address.fromString(
        "0x1234567890123456789012345678901234567890"
      );
      const hookUpdatedEvent = createHookUpdatedEvent(
        BigInt.fromI32(1),
        hookAddress
      );

      handleHookUpdated(hookUpdatedEvent);

      assert.fieldEquals(
        "Badge",
        "1",
        "hookAddress",
        "0x1234567890123456789012345678901234567890"
      );

      log.success("Hook address updated successfully", []);
    });

    test("Should not fail when updating non-existent badge", () => {
      const hookAddress = Address.fromString(
        "0x1234567890123456789012345678901234567890"
      );
      const hookUpdatedEvent = createHookUpdatedEvent(
        BigInt.fromI32(999),
        hookAddress
      );

      handleHookUpdated(hookUpdatedEvent);

      // Badge should not exist
      assert.notInStore("Badge", "999");

      log.success("Handled non-existent badge gracefully", []);
    });
  });

  describe("handleProfileCreated", () => {
    test("Should set badge as user profile", () => {
      // Create a badge
      const badge = new Badge("1");
      badge.name = "Profile Badge";
      badge.isOfficial = true;
      badge.hookAddress = new Bytes(0);
      badge.createdAt = BigInt.fromI32(1683094249);
      badge.uri = "";
      badge.save();

      // Create a user
      const userAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7"
      );
      const user = new User(userAddress.toHexString());
      user.badges = new Array();
      user.save();

      const profileCreatedEvent = createProfileCreatedEvent(
        BigInt.fromI32(1),
        userAddress
      );

      handleProfileCreated(profileCreatedEvent);

      assert.fieldEquals("User", userAddress.toHexString(), "profile", "1");

      log.success("Profile badge set successfully", []);
    });

    test("Should not fail for non-existent user", () => {
      // Create a badge
      const badge = new Badge("1");
      badge.name = "Profile Badge";
      badge.isOfficial = true;
      badge.hookAddress = new Bytes(0);
      badge.createdAt = BigInt.fromI32(1683094249);
      badge.uri = "";
      badge.save();

      const userAddress = Address.fromString(
        "0x9999999999999999999999999999999999999999"
      );
      const profileCreatedEvent = createProfileCreatedEvent(
        BigInt.fromI32(1),
        userAddress
      );

      handleProfileCreated(profileCreatedEvent);

      // Should not crash
      log.success("Handled non-existent user gracefully", []);
    });
  });

  describe("handleURI", () => {
    test("Should update badge URI", () => {
      // Create a badge
      const badge = new Badge("1");
      badge.name = "Test Badge";
      badge.isOfficial = true;
      badge.hookAddress = new Bytes(0);
      badge.createdAt = BigInt.fromI32(1683094249);
      badge.uri = "";
      badge.save();

      const uri = "ipfs://QmTest123456";
      const uriEvent = createURIEvent(BigInt.fromI32(1), uri);

      handleURI(uriEvent);

      assert.fieldEquals("Badge", "1", "uri", uri);

      log.success("Badge URI updated successfully", []);
    });

    test("Should not fail for non-existent badge", () => {
      const uri = "ipfs://QmTest123456";
      const uriEvent = createURIEvent(BigInt.fromI32(999), uri);

      handleURI(uriEvent);

      assert.notInStore("Badge", "999");

      log.success("Handled non-existent badge gracefully", []);
    });
  });

  describe("handleTransferSingle - Minting", () => {
    test("Should mint badge to user", () => {
      // Create a badge
      const badge = new Badge("1");
      badge.name = "Test Badge";
      badge.isOfficial = true;
      badge.hookAddress = new Bytes(0);
      badge.createdAt = BigInt.fromI32(1683094249);
      badge.uri = "";
      badge.save();

      // Create a user
      const userAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7"
      );
      const user = new User(userAddress.toHexString());
      user.badges = new Array();
      user.save();

      const transferEvent = createTransferSingleEvent(
        Address.fromString(ZERO_ADDRESS),
        userAddress,
        BigInt.fromI32(1),
        BigInt.fromI32(1)
      );

      handleTransferSingle(transferEvent);

      const updatedUser = User.load(userAddress.toHexString());
      assert.assertNotNull(updatedUser);
      assert.i32Equals(updatedUser!.badges.length, 1);
      assert.stringEquals(updatedUser!.badges[0], "1");

      log.success("Badge minted to user successfully", []);
    });

    test("Should not mint badge twice to same user", () => {
      // Create a badge
      const badge = new Badge("1");
      badge.name = "Test Badge";
      badge.isOfficial = true;
      badge.hookAddress = new Bytes(0);
      badge.createdAt = BigInt.fromI32(1683094249);
      badge.uri = "";
      badge.save();

      // Create a user with badge already
      const userAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7"
      );
      const user = new User(userAddress.toHexString());
      user.badges = ["1"];
      user.save();

      const transferEvent = createTransferSingleEvent(
        Address.fromString(ZERO_ADDRESS),
        userAddress,
        BigInt.fromI32(1),
        BigInt.fromI32(1)
      );

      handleTransferSingle(transferEvent);

      const updatedUser = User.load(userAddress.toHexString());
      assert.assertNotNull(updatedUser);
      assert.i32Equals(updatedUser!.badges.length, 1);

      log.success("Duplicate minting prevented successfully", []);
    });
  });

  describe("handleTransferSingle - Burning", () => {
    test("Should burn badge from user", () => {
      // Create a badge
      const badge = new Badge("1");
      badge.name = "Test Badge";
      badge.isOfficial = true;
      badge.hookAddress = new Bytes(0);
      badge.createdAt = BigInt.fromI32(1683094249);
      badge.uri = "";
      badge.save();

      // Create a user with badge
      const userAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7"
      );
      const user = new User(userAddress.toHexString());
      user.badges = ["1"];
      user.save();

      const transferEvent = createTransferSingleEvent(
        userAddress,
        Address.fromString(ZERO_ADDRESS),
        BigInt.fromI32(1),
        BigInt.fromI32(1)
      );

      handleTransferSingle(transferEvent);

      const updatedUser = User.load(userAddress.toHexString());
      assert.assertNotNull(updatedUser);
      assert.i32Equals(updatedUser!.badges.length, 0);

      log.success("Badge burned from user successfully", []);
    });

    test("Should handle burning non-existent badge gracefully", () => {
      // Create a badge
      const badge = new Badge("1");
      badge.name = "Test Badge";
      badge.isOfficial = true;
      badge.hookAddress = new Bytes(0);
      badge.createdAt = BigInt.fromI32(1683094249);
      badge.uri = "";
      badge.save();

      // Create a user without badge
      const userAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7"
      );
      const user = new User(userAddress.toHexString());
      user.badges = new Array();
      user.save();

      const transferEvent = createTransferSingleEvent(
        userAddress,
        Address.fromString(ZERO_ADDRESS),
        BigInt.fromI32(1),
        BigInt.fromI32(1)
      );

      handleTransferSingle(transferEvent);

      const updatedUser = User.load(userAddress.toHexString());
      assert.assertNotNull(updatedUser);
      assert.i32Equals(updatedUser!.badges.length, 0);

      log.success("Handled burning non-existent badge gracefully", []);
    });
  });

  describe("handleTransferSingle - Transferring", () => {
    test("Should transfer badge between users", () => {
      // Create a badge
      const badge = new Badge("1");
      badge.name = "Test Badge";
      badge.isOfficial = true;
      badge.hookAddress = new Bytes(0);
      badge.createdAt = BigInt.fromI32(1683094249);
      badge.uri = "";
      badge.save();

      // Create from user with badge
      const fromAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7"
      );
      const fromUser = new User(fromAddress.toHexString());
      fromUser.badges = ["1"];
      fromUser.save();

      // Create to user without badge
      const toAddress = Address.fromString(
        "0xf3dBd9F4C902c7183E0fd22bFdbAF5ed330845c4"
      );
      const toUser = new User(toAddress.toHexString());
      toUser.badges = new Array();
      toUser.save();

      const transferEvent = createTransferSingleEvent(
        fromAddress,
        toAddress,
        BigInt.fromI32(1),
        BigInt.fromI32(1)
      );

      handleTransferSingle(transferEvent);

      const updatedFromUser = User.load(fromAddress.toHexString());
      const updatedToUser = User.load(toAddress.toHexString());

      assert.assertNotNull(updatedFromUser);
      assert.assertNotNull(updatedToUser);
      assert.i32Equals(updatedFromUser!.badges.length, 0);
      assert.i32Equals(updatedToUser!.badges.length, 1);
      assert.stringEquals(updatedToUser!.badges[0], "1");

      log.success("Badge transferred between users successfully", []);
    });

    test("Should not transfer if recipient already has badge", () => {
      // Create a badge
      const badge = new Badge("1");
      badge.name = "Test Badge";
      badge.isOfficial = true;
      badge.hookAddress = new Bytes(0);
      badge.createdAt = BigInt.fromI32(1683094249);
      badge.uri = "";
      badge.save();

      // Create from user with badge
      const fromAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7"
      );
      const fromUser = new User(fromAddress.toHexString());
      fromUser.badges = ["1"];
      fromUser.save();

      // Create to user also with badge
      const toAddress = Address.fromString(
        "0xf3dBd9F4C902c7183E0fd22bFdbAF5ed330845c4"
      );
      const toUser = new User(toAddress.toHexString());
      toUser.badges = ["1"];
      toUser.save();

      const transferEvent = createTransferSingleEvent(
        fromAddress,
        toAddress,
        BigInt.fromI32(1),
        BigInt.fromI32(1)
      );

      handleTransferSingle(transferEvent);

      const updatedFromUser = User.load(fromAddress.toHexString());
      const updatedToUser = User.load(toAddress.toHexString());

      assert.assertNotNull(updatedFromUser);
      assert.assertNotNull(updatedToUser);
      assert.i32Equals(updatedFromUser!.badges.length, 0);
      assert.i32Equals(updatedToUser!.badges.length, 1);

      log.success("Duplicate transfer prevented successfully", []);
    });
  });

  describe("handleTransferBatch", () => {
    test("Should mint multiple badges to user", () => {
      // Create badges
      const badge1 = new Badge("1");
      badge1.name = "Badge 1";
      badge1.isOfficial = true;
      badge1.hookAddress = new Bytes(0);
      badge1.createdAt = BigInt.fromI32(1683094249);
      badge1.uri = "";
      badge1.save();

      const badge2 = new Badge("2");
      badge2.name = "Badge 2";
      badge2.isOfficial = false;
      badge2.hookAddress = new Bytes(0);
      badge2.createdAt = BigInt.fromI32(1683094249);
      badge2.uri = "";
      badge2.save();

      // Create a user
      const userAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7"
      );
      const user = new User(userAddress.toHexString());
      user.badges = new Array();
      user.save();

      const transferBatchEvent = createTransferBatchEvent(
        Address.fromString(ZERO_ADDRESS),
        userAddress,
        [BigInt.fromI32(1), BigInt.fromI32(2)],
        [BigInt.fromI32(1), BigInt.fromI32(1)]
      );

      handleTransferBatch(transferBatchEvent);

      const updatedUser = User.load(userAddress.toHexString());
      assert.assertNotNull(updatedUser);
      assert.i32Equals(updatedUser!.badges.length, 2);
      assert.stringEquals(updatedUser!.badges[0], "1");
      assert.stringEquals(updatedUser!.badges[1], "2");

      log.success("Multiple badges minted successfully", []);
    });

    test("Should burn multiple badges from user", () => {
      // Create badges
      const badge1 = new Badge("1");
      badge1.name = "Badge 1";
      badge1.isOfficial = true;
      badge1.hookAddress = new Bytes(0);
      badge1.createdAt = BigInt.fromI32(1683094249);
      badge1.uri = "";
      badge1.save();

      const badge2 = new Badge("2");
      badge2.name = "Badge 2";
      badge2.isOfficial = false;
      badge2.hookAddress = new Bytes(0);
      badge2.createdAt = BigInt.fromI32(1683094249);
      badge2.uri = "";
      badge2.save();

      // Create a user with badges
      const userAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7"
      );
      const user = new User(userAddress.toHexString());
      user.badges = ["1", "2"];
      user.save();

      const transferBatchEvent = createTransferBatchEvent(
        userAddress,
        Address.fromString(ZERO_ADDRESS),
        [BigInt.fromI32(1), BigInt.fromI32(2)],
        [BigInt.fromI32(1), BigInt.fromI32(1)]
      );

      handleTransferBatch(transferBatchEvent);

      const updatedUser = User.load(userAddress.toHexString());
      assert.assertNotNull(updatedUser);
      assert.i32Equals(updatedUser!.badges.length, 0);

      log.success("Multiple badges burned successfully", []);
    });

    test("Should transfer multiple badges between users", () => {
      // Create badges
      const badge1 = new Badge("1");
      badge1.name = "Badge 1";
      badge1.isOfficial = true;
      badge1.hookAddress = new Bytes(0);
      badge1.createdAt = BigInt.fromI32(1683094249);
      badge1.uri = "";
      badge1.save();

      const badge2 = new Badge("2");
      badge2.name = "Badge 2";
      badge2.isOfficial = false;
      badge2.hookAddress = new Bytes(0);
      badge2.createdAt = BigInt.fromI32(1683094249);
      badge2.uri = "";
      badge2.save();

      // Create from user with badges
      const fromAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7"
      );
      const fromUser = new User(fromAddress.toHexString());
      fromUser.badges = ["1", "2"];
      fromUser.save();

      // Create to user without badges
      const toAddress = Address.fromString(
        "0xf3dBd9F4C902c7183E0fd22bFdbAF5ed330845c4"
      );
      const toUser = new User(toAddress.toHexString());
      toUser.badges = new Array();
      toUser.save();

      const transferBatchEvent = createTransferBatchEvent(
        fromAddress,
        toAddress,
        [BigInt.fromI32(1), BigInt.fromI32(2)],
        [BigInt.fromI32(1), BigInt.fromI32(1)]
      );

      handleTransferBatch(transferBatchEvent);

      const updatedFromUser = User.load(fromAddress.toHexString());
      const updatedToUser = User.load(toAddress.toHexString());

      assert.assertNotNull(updatedFromUser);
      assert.assertNotNull(updatedToUser);
      assert.i32Equals(updatedFromUser!.badges.length, 0);
      assert.i32Equals(updatedToUser!.badges.length, 2);
      assert.stringEquals(updatedToUser!.badges[0], "1");
      assert.stringEquals(updatedToUser!.badges[1], "2");

      log.success("Multiple badges transferred successfully", []);
    });
  });
});
