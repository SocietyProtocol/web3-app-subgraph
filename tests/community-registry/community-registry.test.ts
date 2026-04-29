import {
  afterEach,
  assert,
  clearStore,
  describe,
  log,
  mockIpfsFile,
  test,
} from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { Badge, Community, User } from "../../generated/schema";
import {
  handleCommunityBadgeCreated,
  handleCommunityCreated,
  handleCommunityDetailsUpdated,
} from "../../src/community-registry";
import {
  createCommunityBadgeCreatedEvent,
  createCommunityCreatedEvent,
  createCommunityDetailsUpdatedEvent,
  DEFAULT_CREATOR_ADDRESS,
} from "./community-registry-utils";

// ── helpers ──────────────────────────────────────────────────────────────────

function createAndSaveBadge(
  id: string,
  isCommunity: boolean = false,
  imageUrl: string | null = null,
  uri: string = "",
): Badge {
  const badge = new Badge(id);
  badge.name = "Test Badge";
  badge.isOfficial = false;
  badge.isCommunity = isCommunity;
  badge.isProfile = false;
  badge.hookAddress = new Bytes(0);
  badge.createdAt = BigInt.fromI32(1683094249);
  badge.uri = uri;
  badge.imageUrl = imageUrl;
  badge.creatorAddress = DEFAULT_CREATOR_ADDRESS;
  badge.createdBy = DEFAULT_CREATOR_ADDRESS;
  badge.holdersCount = BigInt.zero();
  badge.minters = [];
  badge.burners = [];
  badge.transferers = [];
  badge.save();
  return badge;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("CommunityRegistry Mappings", () => {
  afterEach(() => {
    clearStore();
  });

  describe("handleCommunityBadgeCreated", () => {
    test("Should link badge to community", () => {
      createAndSaveBadge("10", true);

      handleCommunityBadgeCreated(
        createCommunityBadgeCreatedEvent(BigInt.fromI32(1), BigInt.fromI32(10)),
      );

      assert.fieldEquals("Badge", "10", "communityId", "1");

      log.success("Badge linked to community on CommunityBadgeCreated", []);
    });

    test("Should link multiple badges to the same community", () => {
      createAndSaveBadge("10", true);
      createAndSaveBadge("12", false);

      handleCommunityBadgeCreated(
        createCommunityBadgeCreatedEvent(BigInt.fromI32(1), BigInt.fromI32(10)),
      );
      handleCommunityBadgeCreated(
        createCommunityBadgeCreatedEvent(BigInt.fromI32(1), BigInt.fromI32(12)),
      );

      assert.fieldEquals("Badge", "10", "communityId", "1");
      assert.fieldEquals("Badge", "12", "communityId", "1");

      log.success(
        "Multiple badges linked to community on CommunityBadgeCreated",
        [],
      );
    });

    test("Should not crash when Badge entity does not exist", () => {
      // Should not crash — just a no-op on the badge
      handleCommunityBadgeCreated(
        createCommunityBadgeCreatedEvent(BigInt.fromI32(2), BigInt.fromI32(20)),
      );

      assert.notInStore("Badge", "20");

      log.success(
        "handleCommunityBadgeCreated does not crash when Badge is absent",
        [],
      );
    });
  });

  describe("handleCommunityCreated", () => {
    test("Should create Community entity with manager and member badge", () => {
      // communityId=10, so managerBadge=10 (same sequential ID by contract design)
      createAndSaveBadge("10", true);
      createAndSaveBadge("11", false);

      const creatorAddress = Address.fromString(DEFAULT_CREATOR_ADDRESS);
      handleCommunityCreated(
        createCommunityCreatedEvent(
          BigInt.fromI32(10),
          creatorAddress,
          BigInt.fromI32(11),
        ),
      );

      assert.fieldEquals("Community", "10", "managerBadge", "10");
      assert.fieldEquals("Community", "10", "memberBadge", "11");
      assert.fieldEquals(
        "Community",
        "10",
        "managerAddress",
        creatorAddress.toHexString(),
      );
      assert.fieldEquals("Community", "10", "memberCount", "0");
      assert.fieldEquals("Community", "10", "tier", "unaffiliated");
      assert.fieldEquals("Community", "10", "tierRank", "0");

      log.success(
        "Community entity created with correct manager and member badge on CommunityCreated",
        [],
      );
    });

    test("Should add communityId to manager.managedCommunities", () => {
      createAndSaveBadge("20", true);
      createAndSaveBadge("21", false);

      const creatorAddress = Address.fromString(DEFAULT_CREATOR_ADDRESS);
      handleCommunityCreated(
        createCommunityCreatedEvent(
          BigInt.fromI32(20),
          creatorAddress,
          BigInt.fromI32(21),
        ),
      );

      const manager = User.load(creatorAddress.toHexString());
      assert.assertNotNull(manager);
      assert.i32Equals(manager!.managedCommunities.length, 1);
      assert.stringEquals(manager!.managedCommunities[0], "20");

      log.success(
        "communityId added to manager.managedCommunities on CommunityCreated",
        [],
      );
    });

    test("Should link member badge to community", () => {
      createAndSaveBadge("30", true);
      createAndSaveBadge("31", false);

      handleCommunityCreated(
        createCommunityCreatedEvent(
          BigInt.fromI32(30),
          Address.fromString(DEFAULT_CREATOR_ADDRESS),
          BigInt.fromI32(31),
        ),
      );

      assert.fieldEquals("Badge", "31", "communityId", "30");

      log.success("Member badge linked to community on CommunityCreated", []);
    });

    test("Should use communityId as managerBadgeId (contract design: same sequential ID)", () => {
      createAndSaveBadge("99", true); // manager badge id = communityId = 99
      createAndSaveBadge("30", false);

      handleCommunityCreated(
        createCommunityCreatedEvent(
          BigInt.fromI32(99),
          Address.fromString(DEFAULT_CREATOR_ADDRESS),
          BigInt.fromI32(30),
        ),
      );

      assert.fieldEquals("Community", "99", "managerBadge", "99");
      assert.fieldEquals("Community", "99", "memberBadge", "30");
      assert.fieldEquals("Badge", "99", "communityId", "99");
      assert.fieldEquals("Badge", "30", "communityId", "99");

      log.success("communityId used as managerBadgeId (contract design)", []);
    });

    test("Should not crash and still create Community when member Badge entity is absent", () => {
      createAndSaveBadge("40", true);

      // member badge entity absent from store — communityId=40 → managerBadge=40
      handleCommunityCreated(
        createCommunityCreatedEvent(
          BigInt.fromI32(40),
          Address.fromString(DEFAULT_CREATOR_ADDRESS),
          BigInt.fromI32(41),
        ),
      );

      assert.fieldEquals("Community", "40", "managerBadge", "40");
      assert.fieldEquals("Community", "40", "memberBadge", "41");

      log.success(
        "Community created even when member Badge entity is absent",
        [],
      );
    });

    test("Should clone imageUrl from manager badge to community", () => {
      createAndSaveBadge("70", true, "https://example.com/community.png");
      createAndSaveBadge("71", false);

      handleCommunityCreated(
        createCommunityCreatedEvent(
          BigInt.fromI32(70),
          Address.fromString(DEFAULT_CREATOR_ADDRESS),
          BigInt.fromI32(71),
        ),
      );

      assert.fieldEquals(
        "Community",
        "70",
        "imageUrl",
        "https://example.com/community.png",
      );

      log.success("imageUrl cloned from manager badge to community", []);
    });

    test("Should read tier from manager badge URI metadata", () => {
      const ipfsHash = "QmCommunityMetadata";
      mockIpfsFile(
        ipfsHash,
        "tests/community-registry/ipfs-mocks/valid-community-metadata.json",
      );

      createAndSaveBadge("80", true, null, "ipfs://" + ipfsHash);
      createAndSaveBadge("81", false);

      handleCommunityCreated(
        createCommunityCreatedEvent(
          BigInt.fromI32(80),
          Address.fromString(DEFAULT_CREATOR_ADDRESS),
          BigInt.fromI32(81),
        ),
      );

      assert.fieldEquals("Community", "80", "tier", "gold");
      assert.fieldEquals("Community", "80", "tierRank", "1000000");

      log.success("tier read from manager badge URI metadata", []);
    });

    test("Should set tierRank based on tier: bronze=100, silver=10000, gold=1000000, unaffiliated=0", () => {
      const ipfsHashGold = "QmTierGold";
      const ipfsHashSilver = "QmTierSilver";
      const ipfsHashBronze = "QmTierBronze";
      const ipfsHashUnaffiliated = "QmTierUnaffiliated";

      mockIpfsFile(
        ipfsHashGold,
        "tests/community-registry/ipfs-mocks/valid-community-metadata.json",
      );
      mockIpfsFile(
        ipfsHashSilver,
        "tests/community-registry/ipfs-mocks/tier-silver-metadata.json",
      );
      mockIpfsFile(
        ipfsHashBronze,
        "tests/community-registry/ipfs-mocks/tier-bronze-metadata.json",
      );

      // gold
      createAndSaveBadge("200", true, null, "ipfs://" + ipfsHashGold);
      createAndSaveBadge("201", false);
      handleCommunityCreated(
        createCommunityCreatedEvent(
          BigInt.fromI32(200),
          Address.fromString(DEFAULT_CREATOR_ADDRESS),
          BigInt.fromI32(201),
        ),
      );
      assert.fieldEquals("Community", "200", "tier", "gold");
      assert.fieldEquals("Community", "200", "tierRank", "1000000");

      // silver
      createAndSaveBadge("202", true, null, "ipfs://" + ipfsHashSilver);
      createAndSaveBadge("203", false);
      handleCommunityCreated(
        createCommunityCreatedEvent(
          BigInt.fromI32(202),
          Address.fromString(DEFAULT_CREATOR_ADDRESS),
          BigInt.fromI32(203),
        ),
      );
      assert.fieldEquals("Community", "202", "tier", "silver");
      assert.fieldEquals("Community", "202", "tierRank", "10000");

      // bronze
      createAndSaveBadge("204", true, null, "ipfs://" + ipfsHashBronze);
      createAndSaveBadge("205", false);
      handleCommunityCreated(
        createCommunityCreatedEvent(
          BigInt.fromI32(204),
          Address.fromString(DEFAULT_CREATOR_ADDRESS),
          BigInt.fromI32(205),
        ),
      );
      assert.fieldEquals("Community", "204", "tier", "bronze");
      assert.fieldEquals("Community", "204", "tierRank", "100");

      // unaffiliated (no URI / no metadata)
      createAndSaveBadge("206", true);
      createAndSaveBadge("207", false);
      handleCommunityCreated(
        createCommunityCreatedEvent(
          BigInt.fromI32(206),
          Address.fromString(DEFAULT_CREATOR_ADDRESS),
          BigInt.fromI32(207),
        ),
      );
      assert.fieldEquals("Community", "206", "tier", "unaffiliated");
      assert.fieldEquals("Community", "206", "tierRank", "0");

      log.success("tierRank correctly mapped for all tiers", []);
    });

    test("Should set name and description from getCommunityDetails", () => {
      createAndSaveBadge("90", true);
      createAndSaveBadge("91", false);

      handleCommunityCreated(
        createCommunityCreatedEvent(
          BigInt.fromI32(90),
          Address.fromString(DEFAULT_CREATOR_ADDRESS),
          BigInt.fromI32(91),
          "My Community",
          "A great community",
        ),
      );

      assert.fieldEquals("Community", "90", "name", "My Community");
      assert.fieldEquals("Community", "90", "description", "A great community");

      log.success(
        "name and description set from getCommunityDetails contract call",
        [],
      );
    });
  });

  describe("handleCommunityDetailsUpdated", () => {
    test("Should update Community name and description", () => {
      createAndSaveBadge("50", true);
      createAndSaveBadge("51", false);

      handleCommunityCreated(
        createCommunityCreatedEvent(
          BigInt.fromI32(50),
          Address.fromString(DEFAULT_CREATOR_ADDRESS),
          BigInt.fromI32(51),
        ),
      );

      handleCommunityDetailsUpdated(
        createCommunityDetailsUpdatedEvent(
          BigInt.fromI32(50),
          "New Name",
          "Updated description",
        ),
      );

      assert.fieldEquals("Community", "50", "name", "New Name");
      assert.fieldEquals(
        "Community",
        "50",
        "description",
        "Updated description",
      );

      log.success(
        "Community name and description updated on CommunityDetailsUpdated",
        [],
      );
    });

    test("Should do nothing when Community entity does not exist", () => {
      handleCommunityDetailsUpdated(
        createCommunityDetailsUpdatedEvent(
          BigInt.fromI32(999),
          "Ghost",
          "Ghost description",
        ),
      );

      assert.notInStore("Community", "999");

      log.success(
        "handleCommunityDetailsUpdated is a no-op when Community is absent",
        [],
      );
    });

    test("Should allow multiple updates to the same community", () => {
      createAndSaveBadge("60", true);
      createAndSaveBadge("61", false);

      handleCommunityCreated(
        createCommunityCreatedEvent(
          BigInt.fromI32(60),
          Address.fromString(DEFAULT_CREATOR_ADDRESS),
          BigInt.fromI32(61),
        ),
      );

      handleCommunityDetailsUpdated(
        createCommunityDetailsUpdatedEvent(
          BigInt.fromI32(60),
          "First Update",
          "Desc 1",
        ),
      );
      assert.fieldEquals("Community", "60", "name", "First Update");

      handleCommunityDetailsUpdated(
        createCommunityDetailsUpdatedEvent(
          BigInt.fromI32(60),
          "Second Update",
          "Desc 2",
        ),
      );
      assert.fieldEquals("Community", "60", "name", "Second Update");
      assert.fieldEquals("Community", "60", "description", "Desc 2");

      log.success("Community details can be updated multiple times", []);
    });
  });

  describe("Full CommunityRegistry flow", () => {
    test("Should handle CommunityCreated + CommunityBadgeCreated + CommunityDetailsUpdated", () => {
      const creatorAddress = Address.fromString(DEFAULT_CREATOR_ADDRESS);
      // communityId=100 → managerBadge=100 (contract design: same sequential ID)
      createAndSaveBadge("100", true);
      createAndSaveBadge("101", false);

      handleCommunityCreated(
        createCommunityCreatedEvent(
          BigInt.fromI32(100),
          creatorAddress,
          BigInt.fromI32(101),
        ),
      );
      // CommunityBadgeCreated can still link extra badges after creation
      handleCommunityBadgeCreated(
        createCommunityBadgeCreatedEvent(
          BigInt.fromI32(100),
          BigInt.fromI32(101),
        ),
      );
      handleCommunityDetailsUpdated(
        createCommunityDetailsUpdatedEvent(
          BigInt.fromI32(100),
          "Final Name",
          "Great community",
        ),
      );

      assert.fieldEquals("Community", "100", "managerBadge", "100");
      assert.fieldEquals("Community", "100", "memberBadge", "101");
      assert.fieldEquals("Community", "100", "name", "Final Name");
      assert.fieldEquals("Community", "100", "description", "Great community");
      assert.fieldEquals(
        "Community",
        "100",
        "managerAddress",
        creatorAddress.toHexString(),
      );
      assert.fieldEquals("Badge", "100", "communityId", "100");
      assert.fieldEquals("Badge", "101", "communityId", "100");

      log.success("Full CommunityRegistry flow completed correctly", []);
    });
  });
});
