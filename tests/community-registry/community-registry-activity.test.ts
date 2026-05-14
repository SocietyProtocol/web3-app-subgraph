import {
  afterEach,
  assert,
  clearStore,
  describe,
  log,
  test,
} from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { Badge, Community } from "../../generated/schema";
import {
  handleCommunityBadgeCreated,
  handleCommunityCreated,
  handleCommunityDetailsUpdated,
} from "../../src/community-registry";
import { generateActivityId } from "../../src/utils/community-membership";
import {
  createCommunityBadgeCreatedEvent,
  createCommunityCreatedEvent,
  createCommunityDetailsUpdatedEvent,
  DEFAULT_CREATOR_ADDRESS,
} from "./community-registry-utils";

// ── helpers ───────────────────────────────────────────────────────────────────

function createAndSaveBadge(
  id: string,
  linkedCommunity: string | null = null,
): Badge {
  const badge = new Badge(id);
  badge.name = "Test Badge";
  badge.isOfficial = false;
  badge.isCommunity = linkedCommunity != null;
  badge.isProfile = false;
  badge.hookAddress = new Bytes(0);
  badge.createdAt = BigInt.fromI32(1683094249);
  badge.uri = "";
  badge.creatorAddress = DEFAULT_CREATOR_ADDRESS;
  badge.createdBy = DEFAULT_CREATOR_ADDRESS;
  badge.holdersCount = BigInt.zero();
  badge.minters = [];
  badge.burners = [];
  badge.transferers = [];
  if (linkedCommunity != null) {
    badge.community = linkedCommunity!;
  }
  badge.save();
  return badge;
}

function createAndSaveCommunity(
  communityId: string,
  managerBadgeId: string,
  managerAddress: string,
): Community {
  const community = new Community(communityId);
  community.name = "Test Community";
  community.managerAddress = managerAddress;
  community.manager = managerAddress;
  community.createdAt = BigInt.fromI32(1683094249);
  community.managerBadge = managerBadgeId;
  community.assistantBadge = managerBadgeId;
  community.memberBadge = managerBadgeId;
  community.memberCount = BigInt.zero();
  community.badgeCount = BigInt.zero();
  community.tierId = BigInt.zero();
  community.tierName = "unaffiliated";
  community.tierExpiresAt = BigInt.zero();
  community.save();
  return community;
}

// ── CommunityCreatedActivity ──────────────────────────────────────────────────

describe("CommunityCreatedActivity", () => {
  afterEach(() => {
    clearStore();
  });

  test("Should create one CommunityCreatedActivity on handleCommunityCreated", () => {
    createAndSaveBadge("1");
    createAndSaveBadge("2");

    handleCommunityCreated(
      createCommunityCreatedEvent(
        BigInt.fromI32(1),
        Address.fromString(DEFAULT_CREATOR_ADDRESS),
        BigInt.fromI32(100),
        BigInt.fromI32(2),
      ),
    );

    assert.entityCount("CommunityCreatedActivity", 1);

    log.success(
      "CommunityCreatedActivity created on handleCommunityCreated",
      [],
    );
  });

  test("Activity community field matches the created community", () => {
    createAndSaveBadge("10");
    createAndSaveBadge("11");

    handleCommunityCreated(
      createCommunityCreatedEvent(
        BigInt.fromI32(10),
        Address.fromString(DEFAULT_CREATOR_ADDRESS),
        BigInt.fromI32(110),
        BigInt.fromI32(11),
      ),
    );

    assert.entityCount("CommunityCreatedActivity", 1);
    // Verify the community referenced by the activity exists and is correct
    assert.fieldEquals("Community", "10", "id", "10");
    assert.fieldEquals(
      "Community",
      "10",
      "managerAddress",
      Address.fromString(DEFAULT_CREATOR_ADDRESS).toHexString(),
    );

    log.success("CommunityCreatedActivity community field is correct", []);
  });
});

// ── CommunityDetailsUpdatedActivity ──────────────────────────────────────────

describe("CommunityDetailsUpdatedActivity", () => {
  afterEach(() => {
    clearStore();
  });

  test("Should create one CommunityDetailsUpdatedActivity when community exists", () => {
    createAndSaveBadge("1");
    createAndSaveBadge("2");

    handleCommunityCreated(
      createCommunityCreatedEvent(
        BigInt.fromI32(1),
        Address.fromString(DEFAULT_CREATOR_ADDRESS),
        BigInt.fromI32(100),
        BigInt.fromI32(2),
      ),
    );
    handleCommunityDetailsUpdated(
      createCommunityDetailsUpdatedEvent(
        BigInt.fromI32(1),
        "New Name",
        "New Desc",
      ),
    );

    assert.entityCount("CommunityDetailsUpdatedActivity", 1);

    log.success(
      "CommunityDetailsUpdatedActivity created on DetailsUpdated",
      [],
    );
  });

  test("Should NOT create activity when Community entity does not exist", () => {
    handleCommunityDetailsUpdated(
      createCommunityDetailsUpdatedEvent(BigInt.fromI32(999), "Ghost", ""),
    );

    assert.entityCount("CommunityDetailsUpdatedActivity", 0);

    log.success("No activity when community not found on DetailsUpdated", []);
  });

  test("Activity community field matches the updated community", () => {
    createAndSaveBadge("20");
    createAndSaveBadge("21");

    handleCommunityCreated(
      createCommunityCreatedEvent(
        BigInt.fromI32(20),
        Address.fromString(DEFAULT_CREATOR_ADDRESS),
        BigInt.fromI32(120),
        BigInt.fromI32(21),
      ),
    );
    handleCommunityDetailsUpdated(
      createCommunityDetailsUpdatedEvent(
        BigInt.fromI32(20),
        "Updated Name",
        "Updated Desc",
      ),
    );

    assert.entityCount("CommunityDetailsUpdatedActivity", 1);
    assert.fieldEquals("Community", "20", "name", "Updated Name");

    log.success(
      "CommunityDetailsUpdatedActivity references the right community",
      [],
    );
  });
});

// ── CommunityBadgeLinkedActivity ──────────────────────────────────────────────

describe("CommunityBadgeLinkedActivity", () => {
  afterEach(() => {
    clearStore();
  });

  test("Should create one CommunityBadgeLinkedActivity when a new badge is linked", () => {
    createAndSaveBadge("1");
    createAndSaveBadge("2");

    handleCommunityCreated(
      createCommunityCreatedEvent(
        BigInt.fromI32(1),
        Address.fromString(DEFAULT_CREATOR_ADDRESS),
        BigInt.fromI32(100),
        BigInt.fromI32(2),
      ),
    );

    createAndSaveBadge("3");
    handleCommunityBadgeCreated(
      createCommunityBadgeCreatedEvent(BigInt.fromI32(1), BigInt.fromI32(3)),
    );

    // 2 from community creation (manager + member) + 1 from CommunityBadgeCreated
    assert.entityCount("CommunityBadgeLinkedActivity", 3);

    log.success(
      "CommunityBadgeLinkedActivity created when new badge linked",
      [],
    );
  });

  test("Activity badge field matches the linked badge", () => {
    createAndSaveBadge("30");
    createAndSaveBadge("31");

    handleCommunityCreated(
      createCommunityCreatedEvent(
        BigInt.fromI32(30),
        Address.fromString(DEFAULT_CREATOR_ADDRESS),
        BigInt.fromI32(130),
        BigInt.fromI32(31),
      ),
    );

    createAndSaveBadge("32");
    handleCommunityBadgeCreated(
      createCommunityBadgeCreatedEvent(BigInt.fromI32(30), BigInt.fromI32(32)),
    );

    // 2 from community creation (manager + member) + 1 from CommunityBadgeCreated
    assert.entityCount("CommunityBadgeLinkedActivity", 3);
    // Badge 32 was linked — verify it now points to community 30
    assert.fieldEquals("Badge", "32", "community", "30");

    log.success("CommunityBadgeLinkedActivity badge field is correct", []);
  });

  test("Should NOT create activity when badge entity does not exist", () => {
    createAndSaveBadge("1");
    createAndSaveBadge("2");

    handleCommunityCreated(
      createCommunityCreatedEvent(
        BigInt.fromI32(1),
        Address.fromString(DEFAULT_CREATOR_ADDRESS),
        BigInt.fromI32(100),
        BigInt.fromI32(2),
      ),
    );

    handleCommunityBadgeCreated(
      createCommunityBadgeCreatedEvent(BigInt.fromI32(1), BigInt.fromI32(999)),
    );

    // 2 from community creation (manager + member); badge 999 absent → no extra activity
    assert.entityCount("CommunityBadgeLinkedActivity", 2);

    log.success("No activity when badge entity not found", []);
  });

  test("Should NOT create activity when badge is already linked to the community", () => {
    createAndSaveBadge("40");
    createAndSaveBadge("41");

    handleCommunityCreated(
      createCommunityCreatedEvent(
        BigInt.fromI32(40),
        Address.fromString(DEFAULT_CREATOR_ADDRESS),
        BigInt.fromI32(140),
        BigInt.fromI32(41),
      ),
    );

    // Badge "41" is already linked to community "40" after handleCommunityCreated
    handleCommunityBadgeCreated(
      createCommunityBadgeCreatedEvent(BigInt.fromI32(40), BigInt.fromI32(41)),
    );

    // 2 from community creation (manager + member); badge 41 already linked → no extra activity
    assert.entityCount("CommunityBadgeLinkedActivity", 2);

    log.success("No activity when badge already linked to community", []);
  });

  test("Should create activities for multiple distinct badges linked to the same community", () => {
    createAndSaveBadge("50");
    createAndSaveBadge("51");

    handleCommunityCreated(
      createCommunityCreatedEvent(
        BigInt.fromI32(50),
        Address.fromString(DEFAULT_CREATOR_ADDRESS),
        BigInt.fromI32(150),
        BigInt.fromI32(51),
      ),
    );

    createAndSaveBadge("52");
    handleCommunityBadgeCreated(
      createCommunityBadgeCreatedEvent(BigInt.fromI32(50), BigInt.fromI32(52)),
    );

    assert.fieldEquals("Badge", "52", "community", "50");
    // 2 from community creation (manager + member) + 1 from CommunityBadgeCreated
    assert.entityCount("CommunityBadgeLinkedActivity", 3);

    log.success(
      "CommunityBadgeLinkedActivity created for each newly linked badge",
      [],
    );
  });

  test("Should create CommunityBadgeLinkedActivity for each badge linked on community creation", () => {
    createAndSaveBadge("60"); // manager
    createAndSaveBadge("61"); // member
    createAndSaveBadge("62"); // assistant

    handleCommunityCreated(
      createCommunityCreatedEvent(
        BigInt.fromI32(60),
        Address.fromString(DEFAULT_CREATOR_ADDRESS),
        BigInt.fromI32(62),
        BigInt.fromI32(61),
      ),
    );

    // Manager (60), assistant (62), and member (61) all linked → 3 activities
    assert.entityCount("CommunityBadgeLinkedActivity", 3);
    assert.fieldEquals("Badge", "60", "community", "60");
    assert.fieldEquals("Badge", "62", "community", "60");
    assert.fieldEquals("Badge", "61", "community", "60");

    log.success(
      "CommunityBadgeLinkedActivity created for all badges linked on community creation",
      [],
    );
  });
});

// ── Initial mint activities on handleCommunityCreated ─────────────────────────

describe("Initial mint activities on CommunityCreated", () => {
  afterEach(() => {
    clearStore();
  });

  test("Should create BadgeMintedActivity for both badges on community creation", () => {
    createAndSaveBadge("1");
    createAndSaveBadge("2");

    handleCommunityCreated(
      createCommunityCreatedEvent(
        BigInt.fromI32(1),
        Address.fromString(DEFAULT_CREATOR_ADDRESS),
        BigInt.fromI32(100),
        BigInt.fromI32(2),
      ),
    );

    assert.entityCount("BadgeMintedActivity", 2);

    log.success(
      "BadgeMintedActivity created for manager and member badge on community creation",
      [],
    );
  });

  test("Manager badge BadgeMintedActivity fields are correct", () => {
    createAndSaveBadge("10");
    createAndSaveBadge("11");

    const event = createCommunityCreatedEvent(
      BigInt.fromI32(10),
      Address.fromString(DEFAULT_CREATOR_ADDRESS),
      BigInt.fromI32(110),
      BigInt.fromI32(11),
    );
    handleCommunityCreated(event);

    const activityId = generateActivityId(
      event.transaction.hash,
      event.logIndex.toString(),
      "manager-mint",
    );
    assert.fieldEquals("BadgeMintedActivity", activityId, "community", "10");
    assert.fieldEquals("BadgeMintedActivity", activityId, "badge", "10");
    assert.fieldEquals(
      "BadgeMintedActivity",
      activityId,
      "user",
      Address.fromString(DEFAULT_CREATOR_ADDRESS).toHexString(),
    );

    log.success("Manager badge BadgeMintedActivity fields are correct", []);
  });

  test("Member badge BadgeMintedActivity fields are correct", () => {
    createAndSaveBadge("20");
    createAndSaveBadge("21");

    const event = createCommunityCreatedEvent(
      BigInt.fromI32(20),
      Address.fromString(DEFAULT_CREATOR_ADDRESS),
      BigInt.fromI32(120),
      BigInt.fromI32(21),
    );
    handleCommunityCreated(event);

    const activityId = generateActivityId(
      event.transaction.hash,
      event.logIndex.toString(),
      "member-mint",
    );
    assert.fieldEquals("BadgeMintedActivity", activityId, "community", "20");
    assert.fieldEquals("BadgeMintedActivity", activityId, "badge", "21");
    assert.fieldEquals(
      "BadgeMintedActivity",
      activityId,
      "user",
      Address.fromString(DEFAULT_CREATOR_ADDRESS).toHexString(),
    );

    log.success("Member badge BadgeMintedActivity fields are correct", []);
  });

  test("Should create MemberJoinedActivity for creator on community creation", () => {
    createAndSaveBadge("30");
    createAndSaveBadge("31");

    handleCommunityCreated(
      createCommunityCreatedEvent(
        BigInt.fromI32(30),
        Address.fromString(DEFAULT_CREATOR_ADDRESS),
        BigInt.fromI32(130),
        BigInt.fromI32(31),
      ),
    );

    assert.entityCount("MemberJoinedActivity", 1);

    log.success(
      "MemberJoinedActivity created for creator on community creation",
      [],
    );
  });

  test("MemberJoinedActivity fields reference correct community, badge, user", () => {
    createAndSaveBadge("40");
    createAndSaveBadge("41");

    const event = createCommunityCreatedEvent(
      BigInt.fromI32(40),
      Address.fromString(DEFAULT_CREATOR_ADDRESS),
      BigInt.fromI32(140),
      BigInt.fromI32(41),
    );
    handleCommunityCreated(event);

    const activityId = generateActivityId(
      event.transaction.hash,
      event.logIndex.toString(),
      "member-join",
    );
    assert.fieldEquals("MemberJoinedActivity", activityId, "community", "40");
    assert.fieldEquals("MemberJoinedActivity", activityId, "badge", "41");
    assert.fieldEquals(
      "MemberJoinedActivity",
      activityId,
      "user",
      Address.fromString(DEFAULT_CREATOR_ADDRESS).toHexString(),
    );

    log.success(
      "MemberJoinedActivity fields are correct on community creation",
      [],
    );
  });

  test("Only manager BadgeMintedActivity when member badge entity is absent", () => {
    createAndSaveBadge("50"); // communityId = 50 → managerBadgeId = 50; member badge 51 absent

    handleCommunityCreated(
      createCommunityCreatedEvent(
        BigInt.fromI32(50),
        Address.fromString(DEFAULT_CREATOR_ADDRESS),
        BigInt.fromI32(150),
        BigInt.fromI32(51),
      ),
    );

    assert.entityCount("BadgeMintedActivity", 1);
    assert.entityCount("MemberJoinedActivity", 0);

    log.success(
      "Only manager BadgeMintedActivity created when member badge is absent",
      [],
    );
  });
});
