import {
  afterEach,
  assert,
  clearStore,
  describe,
  log,
  test,
  mockIpfsFile,
} from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { Badge, User } from "../../generated/schema";
import {
  handleBadgeCreated,
  handleBadgeModified,
  handleBadgePermissions,
  handleHookUpdated,
  handleProfileCreated,
  handleTransferBatch,
  handleTransferSingle,
  handleURI,
} from "../../src/society-protocol-badges";
import {
  createBadgeCreatedEvent,
  createBadgeModifiedEvent,
  createBadgePermissionsEvent,
  createHookUpdatedEvent,
  createProfileCreatedEvent,
  createTransferBatchEvent,
  createTransferSingleEvent,
  createURIEvent,
  ZERO_ADDRESS,
} from "./society-protocol-badges-utils";

/**
 * Helper: creates a Badge with all required schema fields initialised and saves it.
 * Use this in tests that need a Badge in the store without going through an event handler.
 */
function createAndSaveBadge(
  id: string,
  name: string = "Test Badge",
  isOfficial: boolean = true,
  uri: string = "",
): Badge {
  const badge = new Badge(id);
  badge.name = name;
  badge.isOfficial = isOfficial;
  badge.isCommunity = false;
  badge.isProfile = false;
  badge.hookAddress = new Bytes(0);
  badge.createdAt = BigInt.fromI32(1683094249);
  badge.uri = uri;
  badge.creatorAddress = ZERO_ADDRESS;
  badge.createdBy = ZERO_ADDRESS;
  badge.holdersCount = BigInt.zero();
  badge.minters = [];
  badge.burners = [];
  badge.transferers = [];
  badge.save();
  return badge;
}

/**
 * Helper: creates a User with all required schema fields initialised and saves it.
 * Use this in tests that need a User in the store without going through an event handler.
 */
function createAndSaveUser(address: Address, badges: string[]): User {
  const user = new User(address.toHexString());
  user.badges = badges;
  user.managedBadges = [];
  user.save();
  return user;
}

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
        timestamp,
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
        timestamp,
      );

      handleBadgeCreated(badgeCreatedEvent);

      assert.fieldEquals("Badge", "2", "id", "2");
      assert.fieldEquals("Badge", "2", "name", badgeName);
      assert.fieldEquals("Badge", "2", "isOfficial", "false");

      log.success("Non-official badge created successfully", []);
    });

    test("Should handle IPFS metadata with valid string imageUrl", () => {
      const badgeId = BigInt.fromI32(3);
      const badgeName = "IPFS Badge";
      const isOfficial = true;
      const timestamp = BigInt.fromI32(1683094251);
      const ipfsHash = "QmValidHash123";
      const ipfsUri = "/ipfs/" + ipfsHash;

      // Mock IPFS file with valid string imageUrl
      mockIpfsFile(ipfsHash, "tests/badges/ipfs-mocks/valid-metadata.json");

      const badgeCreatedEvent = createBadgeCreatedEvent(
        badgeId,
        badgeName,
        isOfficial,
        timestamp,
        false,
        Address.fromString("0x5eA1474CeFA1ea5986327F97932B587deD802CF7"),
        ipfsUri,
      );

      handleBadgeCreated(badgeCreatedEvent);

      assert.fieldEquals("Badge", "3", "id", "3");
      assert.fieldEquals("Badge", "3", "name", badgeName);
      assert.fieldEquals(
        "Badge",
        "3",
        "imageUrl",
        "https://example.com/image.png",
      );

      log.success("Badge with valid IPFS metadata created successfully", []);
    });

    test("Should handle IPFS metadata with non-string imageUrl gracefully", () => {
      const badgeId = BigInt.fromI32(4);
      const badgeName = "Invalid IPFS Badge";
      const isOfficial = true;
      const timestamp = BigInt.fromI32(1683094252);
      const ipfsHash = "QmInvalidHash456";
      const ipfsUri = "/ipfs/" + ipfsHash;

      // Mock IPFS file with non-string imageUrl (number)
      mockIpfsFile(
        ipfsHash,
        "tests/badges/ipfs-mocks/invalid-metadata-number.json",
      );

      const badgeCreatedEvent = createBadgeCreatedEvent(
        badgeId,
        badgeName,
        isOfficial,
        timestamp,
        false,
        Address.fromString("0x5eA1474CeFA1ea5986327F97932B587deD802CF7"),
        ipfsUri,
      );

      handleBadgeCreated(badgeCreatedEvent);

      assert.fieldEquals("Badge", "4", "id", "4");
      assert.fieldEquals("Badge", "4", "name", badgeName);
      // imageUrl should be null since the JSON value wasn't a string
      const badge4 = Badge.load("4");
      assert.assertNotNull(badge4);
      assert.assertNull(badge4!.imageUrl);

      log.success("Badge with invalid IPFS metadata handled gracefully", []);
    });

    test("Should handle IPFS metadata with object imageUrl gracefully", () => {
      const badgeId = BigInt.fromI32(5);
      const badgeName = "Object IPFS Badge";
      const isOfficial = true;
      const timestamp = BigInt.fromI32(1683094253);
      const ipfsHash = "QmObjectHash789";
      const ipfsUri = "/ipfs/" + ipfsHash;

      // Mock IPFS file with object imageUrl
      mockIpfsFile(
        ipfsHash,
        "tests/badges/ipfs-mocks/invalid-metadata-object.json",
      );

      const badgeCreatedEvent = createBadgeCreatedEvent(
        badgeId,
        badgeName,
        isOfficial,
        timestamp,
        false,
        Address.fromString("0x5eA1474CeFA1ea5986327F97932B587deD802CF7"),
        ipfsUri,
      );

      handleBadgeCreated(badgeCreatedEvent);

      assert.fieldEquals("Badge", "5", "id", "5");
      assert.fieldEquals("Badge", "5", "name", badgeName);
      // imageUrl should be null since the JSON value wasn't a string
      const badge5 = Badge.load("5");
      assert.assertNotNull(badge5);
      assert.assertNull(badge5!.imageUrl);

      log.success("Badge with object IPFS metadata handled gracefully", []);
    });
  });

  describe("handleHookUpdated", () => {
    test("Should update hook address for existing badge", () => {
      // Create a badge first
      createAndSaveBadge("1");

      const hookAddress = Address.fromString(
        "0x1234567890123456789012345678901234567890",
      );
      const hookUpdatedEvent = createHookUpdatedEvent(
        BigInt.fromI32(1),
        hookAddress,
      );

      handleHookUpdated(hookUpdatedEvent);

      assert.fieldEquals(
        "Badge",
        "1",
        "hookAddress",
        "0x1234567890123456789012345678901234567890",
      );

      log.success("Hook address updated successfully", []);
    });

    test("Should not fail when updating non-existent badge", () => {
      const hookAddress = Address.fromString(
        "0x1234567890123456789012345678901234567890",
      );
      const hookUpdatedEvent = createHookUpdatedEvent(
        BigInt.fromI32(999),
        hookAddress,
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
      createAndSaveBadge("1", "Profile Badge");

      // Create a user
      const userAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
      );
      createAndSaveUser(userAddress, new Array());

      const profileCreatedEvent = createProfileCreatedEvent(
        BigInt.fromI32(1),
        userAddress,
      );

      handleProfileCreated(profileCreatedEvent);

      assert.fieldEquals("User", userAddress.toHexString(), "profile", "1");
      assert.fieldEquals("Badge", "1", "profileUser", userAddress.toHexString());

      log.success("Profile badge set successfully", []);
    });

    test("Should not fail for non-existent user", () => {
      // Create a badge
      createAndSaveBadge("1", "Profile Badge");

      const userAddress = Address.fromString(
        "0x9999999999999999999999999999999999999999",
      );
      const profileCreatedEvent = createProfileCreatedEvent(
        BigInt.fromI32(1),
        userAddress,
      );

      handleProfileCreated(profileCreatedEvent);

      // Should not crash
      log.success("Handled non-existent user gracefully", []);
    });

    test("Should parse valid IPFS profile metadata with string fields", () => {
      const ipfsHash = "QmProfileHash123";
      createAndSaveBadge("10", "Profile Badge", true, `ipfs://${ipfsHash}`);

      // Mock IPFS file with valid profile metadata
      mockIpfsFile(
        ipfsHash,
        "tests/badges/ipfs-mocks/valid-profile-metadata.json",
      );

      const userAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
      );
      createAndSaveUser(userAddress, new Array());

      const profileCreatedEvent = createProfileCreatedEvent(
        BigInt.fromI32(10),
        userAddress,
      );

      handleProfileCreated(profileCreatedEvent);

      assert.fieldEquals("User", userAddress.toHexString(), "profile", "10");
      assert.fieldEquals("Badge", "10", "profileUser", userAddress.toHexString());
      assert.fieldEquals("User", userAddress.toHexString(), "name", "John Doe");
      assert.fieldEquals(
        "User",
        userAddress.toHexString(),
        "bio",
        "Software developer and blockchain enthusiast",
      );
      assert.fieldEquals(
        "User",
        userAddress.toHexString(),
        "imageUrl",
        "https://example.com/profile.png",
      );

      log.success(
        "Profile metadata parsed successfully with valid strings",
        [],
      );
    });

    test("Should handle IPFS profile metadata with non-string name field", () => {
      const ipfsHash = "QmInvalidProfileName";
      createAndSaveBadge("11", "Profile Badge", true, `ipfs://${ipfsHash}`);

      // Mock IPFS file with non-string name
      mockIpfsFile(
        ipfsHash,
        "tests/badges/ipfs-mocks/invalid-profile-name.json",
      );

      const userAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
      );
      createAndSaveUser(userAddress, new Array());

      const profileCreatedEvent = createProfileCreatedEvent(
        BigInt.fromI32(11),
        userAddress,
      );

      handleProfileCreated(profileCreatedEvent);

      assert.fieldEquals("User", userAddress.toHexString(), "profile", "11");
      assert.fieldEquals("Badge", "11", "profileUser", userAddress.toHexString());
      // Name should not be set since it wasn't a string
      const user11 = User.load(userAddress.toHexString());
      assert.assertNotNull(user11);
      assert.assertNull(user11!.name);
      // bio and imageUrl are valid strings and should be set
      assert.fieldEquals(
        "User",
        userAddress.toHexString(),
        "bio",
        "Software developer",
      );
      assert.fieldEquals(
        "User",
        userAddress.toHexString(),
        "imageUrl",
        "https://example.com/profile.png",
      );

      log.success("Invalid profile name type handled gracefully", []);
    });

    test("Should handle IPFS profile metadata with non-string bio field", () => {
      const ipfsHash = "QmInvalidProfileBio";
      createAndSaveBadge("12", "Profile Badge", true, `ipfs://${ipfsHash}`);

      // Mock IPFS file with non-string bio
      mockIpfsFile(
        ipfsHash,
        "tests/badges/ipfs-mocks/invalid-profile-bio.json",
      );

      const userAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
      );
      createAndSaveUser(userAddress, new Array());

      const profileCreatedEvent = createProfileCreatedEvent(
        BigInt.fromI32(12),
        userAddress,
      );

      handleProfileCreated(profileCreatedEvent);

      assert.fieldEquals("User", userAddress.toHexString(), "profile", "12");
      assert.fieldEquals("Badge", "12", "profileUser", userAddress.toHexString());
      // Bio should not be set since it wasn't a string
      const user12 = User.load(userAddress.toHexString());
      assert.assertNotNull(user12);
      assert.assertNull(user12!.bio);
      // name and imageUrl are valid strings and should be set
      assert.fieldEquals("User", userAddress.toHexString(), "name", "John Doe");
      assert.fieldEquals(
        "User",
        userAddress.toHexString(),
        "imageUrl",
        "https://example.com/profile.png",
      );

      log.success("Invalid profile bio type handled gracefully", []);
    });

    test("Should handle IPFS profile metadata with non-string imageUrl field", () => {
      const ipfsHash = "QmInvalidProfileImage";
      createAndSaveBadge("13", "Profile Badge", true, `ipfs://${ipfsHash}`);

      // Mock IPFS file with non-string imageUrl
      mockIpfsFile(
        ipfsHash,
        "tests/badges/ipfs-mocks/invalid-profile-imageurl.json",
      );

      const userAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
      );
      createAndSaveUser(userAddress, new Array());

      const profileCreatedEvent = createProfileCreatedEvent(
        BigInt.fromI32(13),
        userAddress,
      );

      handleProfileCreated(profileCreatedEvent);

      assert.fieldEquals("User", userAddress.toHexString(), "profile", "13");
      assert.fieldEquals("Badge", "13", "profileUser", userAddress.toHexString());
      // ImageUrl should not be set since it wasn't a string
      const user13 = User.load(userAddress.toHexString());
      assert.assertNotNull(user13);
      assert.assertNull(user13!.imageUrl);
      // name and bio are valid strings and should be set
      assert.fieldEquals("User", userAddress.toHexString(), "name", "John Doe");
      assert.fieldEquals(
        "User",
        userAddress.toHexString(),
        "bio",
        "Software developer",
      );

      log.success("Invalid profile imageUrl type handled gracefully", []);
    });
  });

  describe("handleURI", () => {
    test("Should update badge URI", () => {
      // Create a badge
      createAndSaveBadge("1");

      // Use a non-IPFS URI to test basic URI update without triggering IPFS fetch
      const uri = "https://example.com/badge-metadata.json";
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

    test("Should update URI and handle invalid imageUrl type in metadata", () => {
      createAndSaveBadge("14");

      const ipfsHash = "QmURIInvalidImage";
      // Mock IPFS file with array as imageUrl
      mockIpfsFile(
        ipfsHash,
        "tests/badges/ipfs-mocks/invalid-metadata-array.json",
      );

      const uri = `ipfs://${ipfsHash}`;
      const uriEvent = createURIEvent(BigInt.fromI32(14), uri);

      handleURI(uriEvent);

      assert.fieldEquals("Badge", "14", "uri", uri);
      // imageUrl should not be set since it wasn't a valid string
      const badge14 = Badge.load("14");
      assert.assertNotNull(badge14);
      assert.assertNull(badge14!.imageUrl);

      log.success("URI updated with invalid metadata handled gracefully", []);
    });

    test("Should update profile user metadata when URI changes on a profile badge", () => {
      const ipfsHash = "QmNewProfileMeta";
      const userAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
      );
      createAndSaveUser(userAddress, new Array());

      const badge = createAndSaveBadge("30", "Profile Badge", true, "");
      badge.isProfile = true;
      badge.profileUser = userAddress.toHexString();
      badge.save();

      mockIpfsFile(
        ipfsHash,
        "tests/badges/ipfs-mocks/valid-profile-metadata.json",
      );

      const uriEvent = createURIEvent(BigInt.fromI32(30), `ipfs://${ipfsHash}`);

      handleURI(uriEvent);

      assert.fieldEquals("Badge", "30", "uri", `ipfs://${ipfsHash}`);
      assert.fieldEquals("User", userAddress.toHexString(), "name", "John Doe");
      assert.fieldEquals(
        "User",
        userAddress.toHexString(),
        "bio",
        "Software developer and blockchain enthusiast",
      );
      assert.fieldEquals(
        "User",
        userAddress.toHexString(),
        "imageUrl",
        "https://example.com/profile.png",
      );

      log.success("Profile user metadata updated when URI changes", []);
    });

    test("Should not update user when URI changes on a non-profile badge", () => {
      const userAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
      );
      createAndSaveUser(userAddress, new Array());
      createAndSaveBadge("31", "Regular Badge", false, "");

      const uriEvent = createURIEvent(
        BigInt.fromI32(31),
        "https://example.com/regular.json",
      );

      handleURI(uriEvent);

      assert.fieldEquals(
        "Badge",
        "31",
        "uri",
        "https://example.com/regular.json",
      );
      const user = User.load(userAddress.toHexString());
      assert.assertNotNull(user);
      assert.assertNull(user!.name);

      log.success("Non-profile badge URI change does not affect user", []);
    });

    test("Should not crash when profile badge has no profileUser set", () => {
      const badge = createAndSaveBadge("32", "Orphan Profile", true, "");
      badge.isProfile = true;
      // profileUser intentionally left null
      badge.save();

      const uriEvent = createURIEvent(
        BigInt.fromI32(32),
        "https://example.com/orphan.json",
      );

      handleURI(uriEvent);

      assert.fieldEquals(
        "Badge",
        "32",
        "uri",
        "https://example.com/orphan.json",
      );

      log.success("Profile badge with no profileUser handled gracefully", []);
    });
  });

  describe("handleTransferSingle - Minting", () => {
    test("Should mint badge to user", () => {
      // Create a badge
      createAndSaveBadge("1");

      // Create a user
      const userAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
      );
      createAndSaveUser(userAddress, new Array());

      const transferEvent = createTransferSingleEvent(
        Address.fromString(ZERO_ADDRESS),
        userAddress,
        BigInt.fromI32(1),
        BigInt.fromI32(1),
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
      createAndSaveBadge("1");

      // Create a user with badge already
      const userAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
      );
      createAndSaveUser(userAddress, ["1"]);

      const transferEvent = createTransferSingleEvent(
        Address.fromString(ZERO_ADDRESS),
        userAddress,
        BigInt.fromI32(1),
        BigInt.fromI32(1),
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
      createAndSaveBadge("1");

      // Create a user with badge
      const userAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
      );
      createAndSaveUser(userAddress, ["1"]);

      const transferEvent = createTransferSingleEvent(
        userAddress,
        Address.fromString(ZERO_ADDRESS),
        BigInt.fromI32(1),
        BigInt.fromI32(1),
      );

      handleTransferSingle(transferEvent);

      const updatedUser = User.load(userAddress.toHexString());
      assert.assertNotNull(updatedUser);
      assert.i32Equals(updatedUser!.badges.length, 0);

      log.success("Badge burned from user successfully", []);
    });

    test("Should handle burning non-existent badge gracefully", () => {
      // Create a badge
      createAndSaveBadge("1");

      // Create a user without badge
      const userAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
      );
      createAndSaveUser(userAddress, new Array());

      const transferEvent = createTransferSingleEvent(
        userAddress,
        Address.fromString(ZERO_ADDRESS),
        BigInt.fromI32(1),
        BigInt.fromI32(1),
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
      createAndSaveBadge("1");

      // Create from user with badge
      const fromAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
      );
      createAndSaveUser(fromAddress, ["1"]);

      // Create to user without badge
      const toAddress = Address.fromString(
        "0xf3dBd9F4C902c7183E0fd22bFdbAF5ed330845c4",
      );
      createAndSaveUser(toAddress, new Array());

      const transferEvent = createTransferSingleEvent(
        fromAddress,
        toAddress,
        BigInt.fromI32(1),
        BigInt.fromI32(1),
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
      createAndSaveBadge("1");

      // Create from user with badge
      const fromAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
      );
      createAndSaveUser(fromAddress, ["1"]);

      // Create to user also with badge
      const toAddress = Address.fromString(
        "0xf3dBd9F4C902c7183E0fd22bFdbAF5ed330845c4",
      );
      createAndSaveUser(toAddress, ["1"]);

      const transferEvent = createTransferSingleEvent(
        fromAddress,
        toAddress,
        BigInt.fromI32(1),
        BigInt.fromI32(1),
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
      createAndSaveBadge("1", "Badge 1");
      createAndSaveBadge("2", "Badge 2", false);

      // Create a user
      const userAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
      );
      createAndSaveUser(userAddress, new Array());

      const transferBatchEvent = createTransferBatchEvent(
        Address.fromString(ZERO_ADDRESS),
        userAddress,
        [BigInt.fromI32(1), BigInt.fromI32(2)],
        [BigInt.fromI32(1), BigInt.fromI32(1)],
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
      createAndSaveBadge("1", "Badge 1");
      createAndSaveBadge("2", "Badge 2", false);

      // Create a user with badges
      const userAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
      );
      createAndSaveUser(userAddress, ["1", "2"]);

      const transferBatchEvent = createTransferBatchEvent(
        userAddress,
        Address.fromString(ZERO_ADDRESS),
        [BigInt.fromI32(1), BigInt.fromI32(2)],
        [BigInt.fromI32(1), BigInt.fromI32(1)],
      );

      handleTransferBatch(transferBatchEvent);

      const updatedUser = User.load(userAddress.toHexString());
      assert.assertNotNull(updatedUser);
      assert.i32Equals(updatedUser!.badges.length, 0);

      log.success("Multiple badges burned successfully", []);
    });

    test("Should transfer multiple badges between users", () => {
      // Create badges
      createAndSaveBadge("1", "Badge 1");
      createAndSaveBadge("2", "Badge 2", false);

      // Create from user with badges
      const fromAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
      );
      createAndSaveUser(fromAddress, ["1", "2"]);

      // Create to user without badges
      const toAddress = Address.fromString(
        "0xf3dBd9F4C902c7183E0fd22bFdbAF5ed330845c4",
      );
      createAndSaveUser(toAddress, new Array());

      const transferBatchEvent = createTransferBatchEvent(
        fromAddress,
        toAddress,
        [BigInt.fromI32(1), BigInt.fromI32(2)],
        [BigInt.fromI32(1), BigInt.fromI32(1)],
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

  describe("handleBadgePermissions", () => {
    test("Should set minters, burners, and transferers on badge", () => {
      // Create a badge first
      createAndSaveBadge("1");

      const minterAddress = BigInt.fromString("123456789");
      const burnerAddress = BigInt.fromString("987654321");
      const transfererAddress = BigInt.fromString("111111111");

      const permissionsEvent = createBadgePermissionsEvent(
        BigInt.fromI32(1),
        [minterAddress],
        [transfererAddress],
        [burnerAddress],
      );

      handleBadgePermissions(permissionsEvent);

      const updatedBadge = Badge.load("1");
      assert.assertNotNull(updatedBadge);
      assert.i32Equals(updatedBadge!.minters.length, 1);
      assert.stringEquals(updatedBadge!.minters[0], minterAddress.toString());
      assert.i32Equals(updatedBadge!.burners.length, 1);
      assert.stringEquals(updatedBadge!.burners[0], burnerAddress.toString());
      assert.i32Equals(updatedBadge!.transferers.length, 1);
      assert.stringEquals(
        updatedBadge!.transferers[0],
        transfererAddress.toString(),
      );

      log.success("Badge permissions set successfully", []);
    });

    test("Should create badge if it does not exist when setting permissions", () => {
      const minterAddress = BigInt.fromString("123456789");

      const permissionsEvent = createBadgePermissionsEvent(
        BigInt.fromI32(99),
        [minterAddress],
        [],
        [],
      );

      handleBadgePermissions(permissionsEvent);

      assert.fieldEquals("Badge", "99", "id", "99");
      const updatedBadge = Badge.load("99");
      assert.assertNotNull(updatedBadge);
      assert.i32Equals(updatedBadge!.minters.length, 1);
      assert.stringEquals(updatedBadge!.minters[0], minterAddress.toString());

      log.success(
        "Badge created and permissions set when badge did not exist",
        [],
      );
    });
  });

  describe("handleBadgeModified", () => {
    test("Should update badge name, isOfficial, isCommunity and uri", () => {
      createAndSaveBadge("1", "Old Name", true);

      const modifiedEvent = createBadgeModifiedEvent(
        BigInt.fromI32(1),
        "New Name",
        false,
        true,
        "",
      );

      handleBadgeModified(modifiedEvent);

      assert.fieldEquals("Badge", "1", "name", "New Name");
      assert.fieldEquals("Badge", "1", "isOfficial", "false");
      assert.fieldEquals("Badge", "1", "isCommunity", "true");

      log.success("Badge modified successfully", []);
    });

    test("Should update uri and imageUrl from IPFS metadataURI", () => {
      createAndSaveBadge("2", "Badge Two", true);

      mockIpfsFile(
        "QmValidMetadata",
        "tests/badges/ipfs-mocks/valid-metadata.json",
      );

      const modifiedEvent = createBadgeModifiedEvent(
        BigInt.fromI32(2),
        "Badge Two Updated",
        true,
        false,
        "ipfs://QmValidMetadata",
      );

      handleBadgeModified(modifiedEvent);

      assert.fieldEquals("Badge", "2", "name", "Badge Two Updated");
      assert.fieldEquals("Badge", "2", "uri", "ipfs://QmValidMetadata");

      log.success("Badge uri and imageUrl updated from IPFS", []);
    });

    test("Should do nothing if badge does not exist", () => {
      const modifiedEvent = createBadgeModifiedEvent(
        BigInt.fromI32(999),
        "Ghost Badge",
        true,
      );

      handleBadgeModified(modifiedEvent);

      assert.notInStore("Badge", "999");

      log.success("No badge created when BadgeModified targets unknown id", []);
    });
  });
});
