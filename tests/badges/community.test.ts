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
import { Badge, Community, User } from "../../generated/schema";
import {
  handleBadgeCreated,
  handleBadgeModified,
  handleTransferBatch,
  handleTransferSingle,
  handleURI,
} from "../../src/society-protocol-badges";
import {
  createBadgeCreatedEvent,
  createBadgeModifiedEvent,
  createTransferBatchEvent,
  createTransferSingleEvent,
  createURIEvent,
  DEFAULT_CREATOR_ADDRESS,
  ZERO_ADDRESS,
} from "./society-protocol-badges-utils";

// ── helpers ───────────────────────────────────────────────────────────────────

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

function createAndSaveUser(address: Address, badges: string[]): User {
  const user = new User(address.toHexString());
  user.badges = badges;
  user.managedBadges = [];
  user.managedCommunities = [];
  user.communities = [];
  user.save();
  return user;
}

/**
 * communityId    – the registry community ID (Community entity ID)
 * managerBadgeId – the manager badge ID
 */
function createAndSaveCommunity(
  communityId: string,
  managerBadgeId: string,
  managerAddress: string,
  name: string = "Test Community",
  memberBadgeId: string = "",
): Community {
  const community = new Community(communityId);
  community.name = name;
  community.managerAddress = managerAddress;
  community.manager = managerAddress;
  community.createdAt = BigInt.fromI32(1683094249);
  community.managerBadge = managerBadgeId;
  community.assistantBadge = managerBadgeId;
  community.memberBadge =
    memberBadgeId.length > 0 ? memberBadgeId : managerBadgeId;
  community.memberCount = BigInt.zero();
  community.badgeCount = BigInt.zero();
  community.tierId = BigInt.zero();
  community.tierName = "unaffiliated";
  community.tierExpiresAt = BigInt.zero();
  community.save();
  return community;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("Community Mappings", () => {
  afterEach(() => {
    clearStore();
  });

  describe("handleBadgeCreated - isCommunity badge", () => {
    test("Should set badge.isCommunity=true but NOT create a Community entity", () => {
      const badgeId = BigInt.fromI32(100);
      const creatorAddress = Address.fromString(DEFAULT_CREATOR_ADDRESS);
      const timestamp = BigInt.fromI32(1683094300);

      handleBadgeCreated(
        createBadgeCreatedEvent(
          badgeId,
          "My Community",
          false,
          timestamp,
          true,
          creatorAddress,
          "",
        ),
      );

      assert.fieldEquals("Badge", "100", "isCommunity", "true");
      assert.notInStore("Community", "100");

      log.success(
        "Badge.isCommunity=true set; Community NOT created by BadgeCreated",
        [],
      );
    });

    test("Should NOT create a Community entity for a regular badge", () => {
      handleBadgeCreated(
        createBadgeCreatedEvent(
          BigInt.fromI32(101),
          "Regular Badge",
          true,
          BigInt.fromI32(1683094301),
          false,
          Address.fromString(DEFAULT_CREATOR_ADDRESS),
          "",
        ),
      );

      assert.fieldEquals("Badge", "101", "isCommunity", "false");
      assert.notInStore("Community", "101");

      log.success("Regular badge created; no Community entity created", []);
    });
  });

  describe("handleBadgeModified - isCommunity badge", () => {
    test("Should update badge.isCommunity=true but NOT create a Community entity", () => {
      const creatorAddress = Address.fromString(DEFAULT_CREATOR_ADDRESS);

      const badge = createAndSaveBadge("400", "Old Name", false);
      badge.creatorAddress = creatorAddress.toHexString();
      badge.createdBy = creatorAddress.toHexString();
      badge.save();

      createAndSaveUser(creatorAddress, new Array());

      handleBadgeModified(
        createBadgeModifiedEvent(
          BigInt.fromI32(400),
          "Community Name",
          false,
          true,
          "",
        ),
      );

      assert.fieldEquals("Badge", "400", "isCommunity", "true");
      assert.notInStore("Community", "400");

      log.success(
        "Badge.isCommunity=true updated; Community NOT created by BadgeModified",
        [],
      );
    });
  });

  describe("handleTransferSingle - manager badge transfer", () => {
    test("Should update Community manager and managedCommunities on manager badge transfer", () => {
      const fromAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
      );
      const toAddress = Address.fromString(
        "0xf3dBd9F4C902c7183E0fd22bFdbAF5ed330845c4",
      );

      // Community "1", manager badge "200"
      const managerBadge = createAndSaveBadge("200", "Manager Badge");
      managerBadge.isCommunity = true;
      managerBadge.community = "1";
      managerBadge.save();

      createAndSaveCommunity("1", "200", fromAddress.toHexString());

      const fromUser = createAndSaveUser(fromAddress, ["200"]);
      const fromManaged = fromUser.managedCommunities;
      fromManaged.push("1");
      fromUser.managedCommunities = fromManaged;
      fromUser.save();

      createAndSaveUser(toAddress, new Array());

      handleTransferSingle(
        createTransferSingleEvent(
          fromAddress,
          toAddress,
          BigInt.fromI32(200),
          BigInt.fromI32(1),
        ),
      );

      assert.fieldEquals(
        "Community",
        "1",
        "managerAddress",
        toAddress.toHexString(),
      );

      const updatedFromUser = User.load(fromAddress.toHexString());
      assert.assertNotNull(updatedFromUser);
      assert.i32Equals(updatedFromUser!.managedCommunities.length, 0);

      const updatedToUser = User.load(toAddress.toHexString());
      assert.assertNotNull(updatedToUser);
      assert.i32Equals(updatedToUser!.managedCommunities.length, 1);
      assert.stringEquals(updatedToUser!.managedCommunities[0], "1");

      log.success(
        "Community manager and managedCommunities updated on manager badge transfer",
        [],
      );
    });

    test("Should not add community to new manager's managedCommunities twice", () => {
      const fromAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
      );
      const toAddress = Address.fromString(
        "0xf3dBd9F4C902c7183E0fd22bFdbAF5ed330845c4",
      );

      const managerBadge = createAndSaveBadge("201", "Manager Badge");
      managerBadge.isCommunity = true;
      managerBadge.community = "2";
      managerBadge.save();

      createAndSaveCommunity("2", "201", fromAddress.toHexString());

      const fromUser = createAndSaveUser(fromAddress, ["201"]);
      const fromManaged = fromUser.managedCommunities;
      fromManaged.push("2");
      fromUser.managedCommunities = fromManaged;
      fromUser.save();

      const toUser = createAndSaveUser(toAddress, new Array());
      const toManaged = toUser.managedCommunities;
      toManaged.push("2");
      toUser.managedCommunities = toManaged;
      toUser.save();

      handleTransferSingle(
        createTransferSingleEvent(
          fromAddress,
          toAddress,
          BigInt.fromI32(201),
          BigInt.fromI32(1),
        ),
      );

      const updatedToUser = User.load(toAddress.toHexString());
      assert.assertNotNull(updatedToUser);
      assert.i32Equals(updatedToUser!.managedCommunities.length, 1);

      log.success(
        "Community not duplicated in new manager's managedCommunities",
        [],
      );
    });
  });

  describe("handleTransferBatch - manager badge", () => {
    test("Should update Community manager on manager badge batch transfer", () => {
      const fromAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
      );
      const toAddress = Address.fromString(
        "0xf3dBd9F4C902c7183E0fd22bFdbAF5ed330845c4",
      );

      createAndSaveBadge("1", "Regular Badge");

      const managerBadge = createAndSaveBadge("300", "Manager Badge");
      managerBadge.isCommunity = true;
      managerBadge.community = "3";
      managerBadge.save();

      createAndSaveCommunity("3", "300", fromAddress.toHexString());

      const fromUser = createAndSaveUser(fromAddress, ["1", "300"]);
      const fromManaged = fromUser.managedCommunities;
      fromManaged.push("3");
      fromUser.managedCommunities = fromManaged;
      fromUser.save();

      createAndSaveUser(toAddress, new Array());

      handleTransferBatch(
        createTransferBatchEvent(
          fromAddress,
          toAddress,
          [BigInt.fromI32(1), BigInt.fromI32(300)],
          [BigInt.fromI32(1), BigInt.fromI32(1)],
        ),
      );

      assert.fieldEquals(
        "Community",
        "3",
        "managerAddress",
        toAddress.toHexString(),
      );

      const updatedFromUser = User.load(fromAddress.toHexString());
      assert.assertNotNull(updatedFromUser);
      assert.i32Equals(updatedFromUser!.managedCommunities.length, 0);

      const updatedToUser = User.load(toAddress.toHexString());
      assert.assertNotNull(updatedToUser);
      assert.i32Equals(updatedToUser!.managedCommunities.length, 1);
      assert.stringEquals(updatedToUser!.managedCommunities[0], "3");

      log.success(
        "Community manager updated on manager badge batch transfer",
        [],
      );
    });
  });

  describe("handleURI - community badge", () => {
    test("Should update Community imageUrl when URI changes on a linked badge", () => {
      const ipfsHash = "QmCommunityURIUpdate";
      const creatorAddress = Address.fromString(DEFAULT_CREATOR_ADDRESS);

      const managerBadge = createAndSaveBadge(
        "500",
        "Manager Badge",
        false,
        "",
      );
      managerBadge.isCommunity = true;
      managerBadge.community = "5";
      managerBadge.save();

      createAndSaveCommunity("5", "500", creatorAddress.toHexString());

      mockIpfsFile(ipfsHash, "tests/badges/ipfs-mocks/valid-metadata.json");

      handleURI(createURIEvent(BigInt.fromI32(500), `ipfs://${ipfsHash}`));

      assert.fieldEquals("Badge", "500", "uri", `ipfs://${ipfsHash}`);
      assert.fieldEquals(
        "Community",
        "5",
        "imageUrl",
        "https://example.com/image.png",
      );

      log.success(
        "Community imageUrl updated when URI changes on a linked badge",
        [],
      );
    });

    test("Should not touch Community when URI changes on an unlinked badge", () => {
      createAndSaveBadge("501", "Regular Badge", true, "");

      handleURI(
        createURIEvent(BigInt.fromI32(501), "https://example.com/regular.json"),
      );

      assert.fieldEquals(
        "Badge",
        "501",
        "uri",
        "https://example.com/regular.json",
      );
      assert.notInStore("Community", "501");

      log.success(
        "Unlinked badge URI change does not affect any Community",
        [],
      );
    });
  });

  describe("Community membership via member badge", () => {
    test("Should add user to community and increment memberCount on member badge mint", () => {
      const managerAddress = Address.fromString(DEFAULT_CREATOR_ADDRESS);
      const memberAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
      );

      // Community "10", manager badge "600", member badge "601"
      createAndSaveBadge("600", "Manager Badge");
      createAndSaveCommunity(
        "10",
        "600",
        managerAddress.toHexString(),
        "Test Community",
        "601",
      );

      const memberBadge = createAndSaveBadge("601", "Member Badge");
      memberBadge.community = "10";
      memberBadge.save();

      createAndSaveUser(memberAddress, new Array());

      handleTransferSingle(
        createTransferSingleEvent(
          Address.fromString("0x0000000000000000000000000000000000000000"),
          memberAddress,
          BigInt.fromI32(601),
          BigInt.fromI32(1),
        ),
      );

      assert.fieldEquals("Community", "10", "memberCount", "1");

      const member = User.load(memberAddress.toHexString());
      assert.assertNotNull(member);
      assert.i32Equals(member!.communities.length, 1);
      assert.stringEquals(member!.communities[0], "10");

      log.success("User added to community on member badge mint", []);
    });

    test("Should not add user to community twice on duplicate mint", () => {
      const managerAddress = Address.fromString(DEFAULT_CREATOR_ADDRESS);
      const memberAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
      );

      createAndSaveBadge("602", "Manager Badge");
      createAndSaveCommunity(
        "11",
        "602",
        managerAddress.toHexString(),
        "Test Community",
        "603",
      );

      const memberBadge = createAndSaveBadge("603", "Member Badge");
      memberBadge.community = "11";
      memberBadge.save();

      createAndSaveUser(memberAddress, new Array());

      const mintEvent = createTransferSingleEvent(
        Address.fromString("0x0000000000000000000000000000000000000000"),
        memberAddress,
        BigInt.fromI32(603),
        BigInt.fromI32(1),
      );

      handleTransferSingle(mintEvent);
      handleTransferSingle(mintEvent);

      assert.fieldEquals("Community", "11", "memberCount", "1");

      const member = User.load(memberAddress.toHexString());
      assert.assertNotNull(member);
      assert.i32Equals(member!.communities.length, 1);

      log.success("User not added to community twice on duplicate mint", []);
    });

    test("Should remove user from community and decrement memberCount on member badge burn", () => {
      const managerAddress = Address.fromString(DEFAULT_CREATOR_ADDRESS);
      const memberAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
      );

      createAndSaveBadge("604", "Manager Badge");
      const community = createAndSaveCommunity(
        "12",
        "604",
        managerAddress.toHexString(),
        "Test Community",
        "605",
      );
      community.memberCount = BigInt.fromI32(1);
      community.save();

      const memberBadge = createAndSaveBadge("605", "Member Badge");
      memberBadge.community = "12";
      memberBadge.save();

      const member = createAndSaveUser(memberAddress, ["605"]);
      const memberCommunities = member.communities;
      memberCommunities.push("12");
      member.communities = memberCommunities;
      member.save();

      handleTransferSingle(
        createTransferSingleEvent(
          memberAddress,
          Address.fromString("0x0000000000000000000000000000000000000000"),
          BigInt.fromI32(605),
          BigInt.fromI32(1),
        ),
      );

      assert.fieldEquals("Community", "12", "memberCount", "0");

      const updatedMember = User.load(memberAddress.toHexString());
      assert.assertNotNull(updatedMember);
      assert.i32Equals(updatedMember!.communities.length, 0);

      log.success("User removed from community on member badge burn", []);
    });

    test("Should transfer community membership when member badge is transferred", () => {
      const managerAddress = Address.fromString(DEFAULT_CREATOR_ADDRESS);
      const fromAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
      );
      const toAddress = Address.fromString(
        "0xf3dBd9F4C902c7183E0fd22bFdbAF5ed330845c4",
      );

      createAndSaveBadge("606", "Manager Badge");
      const community = createAndSaveCommunity(
        "13",
        "606",
        managerAddress.toHexString(),
        "Test Community",
        "607",
      );
      community.memberCount = BigInt.fromI32(1);
      community.save();

      const memberBadge = createAndSaveBadge("607", "Member Badge");
      memberBadge.community = "13";
      memberBadge.save();

      const fromUser = createAndSaveUser(fromAddress, ["607"]);
      const fromCommunities = fromUser.communities;
      fromCommunities.push("13");
      fromUser.communities = fromCommunities;
      fromUser.save();

      createAndSaveUser(toAddress, new Array());

      handleTransferSingle(
        createTransferSingleEvent(
          fromAddress,
          toAddress,
          BigInt.fromI32(607),
          BigInt.fromI32(1),
        ),
      );

      assert.fieldEquals("Community", "13", "memberCount", "1");

      const updatedFrom = User.load(fromAddress.toHexString());
      assert.assertNotNull(updatedFrom);
      assert.i32Equals(updatedFrom!.communities.length, 0);

      const updatedTo = User.load(toAddress.toHexString());
      assert.assertNotNull(updatedTo);
      assert.i32Equals(updatedTo!.communities.length, 1);
      assert.stringEquals(updatedTo!.communities[0], "13");

      log.success(
        "Community membership transferred when member badge is transferred",
        [],
      );
    });

    test("Should add member via batch mint of member badge", () => {
      const managerAddress = Address.fromString(DEFAULT_CREATOR_ADDRESS);
      const memberAddress = Address.fromString(
        "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
      );

      createAndSaveBadge("608", "Manager Badge");
      createAndSaveCommunity(
        "14",
        "608",
        managerAddress.toHexString(),
        "Test Community",
        "609",
      );

      const memberBadge = createAndSaveBadge("609", "Member Badge");
      memberBadge.community = "14";
      memberBadge.save();

      createAndSaveUser(memberAddress, new Array());

      handleTransferBatch(
        createTransferBatchEvent(
          Address.fromString("0x0000000000000000000000000000000000000000"),
          memberAddress,
          [BigInt.fromI32(609)],
          [BigInt.fromI32(1)],
        ),
      );

      assert.fieldEquals("Community", "14", "memberCount", "1");

      const member = User.load(memberAddress.toHexString());
      assert.assertNotNull(member);
      assert.i32Equals(member!.communities.length, 1);
      assert.stringEquals(member!.communities[0], "14");

      log.success("User added to community on member badge batch mint", []);
    });
  });
});
