import {
  afterEach,
  assert,
  clearStore,
  describe,
  log,
  test,
} from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  Badge,
  Community,
  MemberJoinedActivity,
  User,
} from "../../generated/schema";
import { handleTransferSingle } from "../../src/society-protocol-badges";
import {
  generateMembershipId,
  upsertCommunityMembership,
} from "../../src/utils/community-membership";
import {
  createTransferSingleEvent,
  DEFAULT_CREATOR_ADDRESS,
  ZERO_ADDRESS,
} from "./society-protocol-badges-utils";

// ── helpers ───────────────────────────────────────────────────────────────────

function createAndSaveBadge(
  id: string,
  communityId: string | null = null,
  isManagerBadge: boolean = false,
): Badge {
  const badge = new Badge(id);
  badge.name = "Test Badge";
  badge.isOfficial = false;
  badge.isCommunity = communityId != null;
  badge.isProfile = false;
  badge.hookAddress = new Bytes(0);
  badge.createdAt = BigInt.fromI32(1683094249);
  badge.uri = "";
  badge.creatorAddress = ZERO_ADDRESS;
  badge.createdBy = ZERO_ADDRESS;
  badge.holdersCount = BigInt.zero();
  badge.minters = [];
  badge.burners = [];
  badge.transferers = [];
  if (communityId != null) {
    badge.community = communityId!;
  }
  badge.save();
  return badge;
}

function createAndSaveUser(
  address: Address,
  badges: string[],
  communities: string[] = [],
): User {
  const user = new User(address.toHexString());
  user.badges = badges;
  user.managedBadges = [];
  user.managedCommunities = [];
  user.communities = communities;
  user.save();
  return user;
}

function createAndSaveCommunity(
  communityId: string,
  managerBadgeId: string,
  memberCount: i32 = 0,
  memberBadgeId: string = "",
): Community {
  const community = new Community(communityId);
  community.name = "Test Community";
  community.managerAddress = DEFAULT_CREATOR_ADDRESS;
  community.manager = DEFAULT_CREATOR_ADDRESS;
  community.createdAt = BigInt.fromI32(1683094249);
  community.managerBadge = managerBadgeId;
  community.assistantBadge = managerBadgeId;
  community.memberBadge =
    memberBadgeId.length > 0 ? memberBadgeId : managerBadgeId;
  community.memberCount = BigInt.fromI32(memberCount);
  community.badgeCount = BigInt.zero();
  community.tierId = BigInt.zero();
  community.tierName = "unaffiliated";
  community.tierExpiresAt = BigInt.zero();
  community.save();
  return community;
}

function createAndSaveMemberJoinedActivity(
  userId: string,
  communityId: string,
  badgeId: string,
): MemberJoinedActivity {
  const id = userId + "-" + communityId + "-member-join";
  const activity = new MemberJoinedActivity(id);
  activity.community = communityId;
  activity.badge = badgeId;
  activity.user = userId;
  activity.timestamp = BigInt.fromI32(1683094249);
  activity.blockNumber = BigInt.fromI32(1);
  activity.txHash = new Bytes(0);
  activity.save();

  upsertCommunityMembership(userId, communityId, id);

  return activity;
}

// ── MemberJoinedActivity ──────────────────────────────────────────────────────

describe("MemberJoinedActivity", () => {
  afterEach(() => {
    clearStore();
  });

  test("Should create one MemberJoinedActivity when member badge is minted to a new member", () => {
    const member = Address.fromString(
      "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
    );

    createAndSaveBadge("100", "10"); // member badge linked to community "10"
    createAndSaveCommunity("10", "999", 0, "100"); // manager badge "999" ≠ "100"
    createAndSaveUser(member, []);

    handleTransferSingle(
      createTransferSingleEvent(
        Address.fromString(ZERO_ADDRESS),
        member,
        BigInt.fromI32(100),
        BigInt.fromI32(1),
      ),
    );

    assert.entityCount("MemberJoinedActivity", 1);
    assert.entityCount("BadgeMintedActivity", 1); // badge mint always recorded
    assert.fieldEquals("Community", "10", "memberCount", "1");

    log.success(
      "MemberJoinedActivity and BadgeMintedActivity both created on member badge mint",
      [],
    );
  });

  test("Should NOT create MemberJoinedActivity when badge does not exist", () => {
    const member = Address.fromString(
      "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
    );
    createAndSaveUser(member, []);

    handleTransferSingle(
      createTransferSingleEvent(
        Address.fromString(ZERO_ADDRESS),
        member,
        BigInt.fromI32(999),
        BigInt.fromI32(1),
      ),
    );

    assert.entityCount("MemberJoinedActivity", 0);

    log.success("No MemberJoinedActivity when badge not found", []);
  });

  test("Should NOT create MemberJoinedActivity when badge has no community", () => {
    const member = Address.fromString(
      "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
    );

    createAndSaveBadge("200"); // no community linked
    createAndSaveUser(member, []);

    handleTransferSingle(
      createTransferSingleEvent(
        Address.fromString(ZERO_ADDRESS),
        member,
        BigInt.fromI32(200),
        BigInt.fromI32(1),
      ),
    );

    assert.entityCount("MemberJoinedActivity", 0);

    log.success("No MemberJoinedActivity when badge has no community", []);
  });

  test("Should NOT create MemberJoinedActivity on duplicate mint (alreadyHasBadge guard)", () => {
    const member = Address.fromString(
      "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
    );

    createAndSaveBadge("101", "11");
    createAndSaveCommunity("11", "998");
    createAndSaveUser(member, ["101"]); // user already holds badge "101"

    handleTransferSingle(
      createTransferSingleEvent(
        Address.fromString(ZERO_ADDRESS),
        member,
        BigInt.fromI32(101),
        BigInt.fromI32(1),
      ),
    );

    assert.entityCount("MemberJoinedActivity", 0);

    log.success(
      "No MemberJoinedActivity on duplicate mint (alreadyHasBadge)",
      [],
    );
  });
});

// ── BadgeMintedActivity ───────────────────────────────────────────────────────

describe("BadgeMintedActivity", () => {
  afterEach(() => {
    clearStore();
  });

  test("Should create BadgeMintedActivity when manager badge is minted (no MemberJoinedActivity)", () => {
    const manager = Address.fromString(
      "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
    );

    // Badge "300" IS the manager badge of community "30"
    createAndSaveBadge("300", "30");
    createAndSaveCommunity("30", "300");
    createAndSaveUser(manager, []);

    handleTransferSingle(
      createTransferSingleEvent(
        Address.fromString(ZERO_ADDRESS),
        manager,
        BigInt.fromI32(300),
        BigInt.fromI32(1),
      ),
    );

    assert.entityCount("BadgeMintedActivity", 1);
    assert.entityCount("MemberJoinedActivity", 0); // manager badge does not trigger member join

    log.success(
      "BadgeMintedActivity created when manager badge minted, no MemberJoinedActivity",
      [],
    );
  });

  test("Should add community to user.managedCommunities when manager badge is minted", () => {
    const manager = Address.fromString(
      "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
    );

    createAndSaveBadge("301", "31");
    createAndSaveCommunity("31", "301");
    createAndSaveUser(manager, []);

    handleTransferSingle(
      createTransferSingleEvent(
        Address.fromString(ZERO_ADDRESS),
        manager,
        BigInt.fromI32(301),
        BigInt.fromI32(1),
      ),
    );

    const updatedManager = User.load(manager.toHexString());
    assert.assertNotNull(updatedManager);
    assert.i32Equals(updatedManager!.managedCommunities.length, 1);
    assert.stringEquals(updatedManager!.managedCommunities[0], "31");
    assert.fieldEquals(
      "Community",
      "31",
      "managerAddress",
      DEFAULT_CREATOR_ADDRESS,
    );

    log.success(
      "managedCommunities and community.managerAddress updated when manager badge minted",
      [],
    );
  });

  test("Should not double-add community to managedCommunities on repeated manager badge mint", () => {
    const manager = Address.fromString(
      "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
    );

    createAndSaveBadge("302", "32");
    createAndSaveCommunity("32", "302");
    const mgr = createAndSaveUser(manager, []);
    // Pre-populate managedCommunities (as handleCommunityCreated would have)
    const managed = mgr.managedCommunities;
    managed.push("32");
    mgr.managedCommunities = managed;
    mgr.save();

    handleTransferSingle(
      createTransferSingleEvent(
        Address.fromString(ZERO_ADDRESS),
        manager,
        BigInt.fromI32(302),
        BigInt.fromI32(1),
      ),
    );

    const updatedManager = User.load(manager.toHexString());
    assert.assertNotNull(updatedManager);
    assert.i32Equals(updatedManager!.managedCommunities.length, 1); // not 2

    log.success(
      "managedCommunities not duplicated on repeated manager badge mint",
      [],
    );
  });

  test("Should NOT create BadgeMintedActivity when badge has no community", () => {
    const user = Address.fromString(
      "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
    );

    createAndSaveBadge("303"); // no community
    createAndSaveUser(user, []);

    handleTransferSingle(
      createTransferSingleEvent(
        Address.fromString(ZERO_ADDRESS),
        user,
        BigInt.fromI32(303),
        BigInt.fromI32(1),
      ),
    );

    assert.entityCount("BadgeMintedActivity", 0);

    log.success("No BadgeMintedActivity when badge has no community", []);
  });
});

// ── MemberLeftActivity ────────────────────────────────────────────────────────

describe("MemberLeftActivity", () => {
  afterEach(() => {
    clearStore();
  });

  test("Should create one MemberLeftActivity when member badge is burned by a member", () => {
    const member = Address.fromString(
      "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
    );

    createAndSaveBadge("400", "40"); // member badge, community "40"
    const community = createAndSaveCommunity("40", "999", 0, "400");
    community.memberCount = BigInt.fromI32(1);
    community.save();

    const user = createAndSaveUser(member, ["400"], ["40"]);

    handleTransferSingle(
      createTransferSingleEvent(
        member,
        Address.fromString(ZERO_ADDRESS),
        BigInt.fromI32(400),
        BigInt.fromI32(1),
      ),
    );

    assert.entityCount("MemberLeftActivity", 1);
    assert.fieldEquals("Community", "40", "memberCount", "0");

    log.success("MemberLeftActivity created on member badge burn", []);
  });

  test("Should NOT create MemberLeftActivity when badge has no community", () => {
    const member = Address.fromString(
      "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
    );

    createAndSaveBadge("401"); // no community
    createAndSaveUser(member, ["401"]);

    handleTransferSingle(
      createTransferSingleEvent(
        member,
        Address.fromString(ZERO_ADDRESS),
        BigInt.fromI32(401),
        BigInt.fromI32(1),
      ),
    );

    assert.entityCount("MemberLeftActivity", 0);

    log.success("No MemberLeftActivity when badge has no community", []);
  });

  test("Should NOT create MemberLeftActivity when user was not a member", () => {
    const member = Address.fromString(
      "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
    );

    createAndSaveBadge("402", "41");
    createAndSaveCommunity("41", "998");
    createAndSaveUser(member, ["402"]); // holds badge but NOT in communities array

    handleTransferSingle(
      createTransferSingleEvent(
        member,
        Address.fromString(ZERO_ADDRESS),
        BigInt.fromI32(402),
        BigInt.fromI32(1),
      ),
    );

    assert.entityCount("MemberLeftActivity", 0);

    log.success(
      "No MemberLeftActivity when user was not a community member",
      [],
    );
  });

  test("Should remove CommunityMembership pointer when member badge is burned", () => {
    const member = Address.fromString(
      "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
    );
    const memberId = member.toHexString();

    createAndSaveBadge("403", "42");
    const community = createAndSaveCommunity("42", "997", 0, "403");
    community.memberCount = BigInt.fromI32(1);
    community.save();
    createAndSaveUser(member, ["403"], ["42"]);
    createAndSaveMemberJoinedActivity(memberId, "42", "403");

    handleTransferSingle(
      createTransferSingleEvent(
        member,
        Address.fromString(ZERO_ADDRESS),
        BigInt.fromI32(403),
        BigInt.fromI32(1),
      ),
    );

    assert.entityCount("MemberLeftActivity", 1);
    // CommunityMembership pointer should be cleared after leaving
    assert.entityCount("CommunityMembership", 0);

    log.success("CommunityMembership removed when member badge burned", []);
  });
});

// ── BadgeBurnedActivity ───────────────────────────────────────────────────────

describe("BadgeBurnedActivity", () => {
  afterEach(() => {
    clearStore();
  });

  test("Should create one BadgeBurnedActivity when manager badge is burned", () => {
    const manager = Address.fromString(
      "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
    );

    // Badge "500" IS the manager badge of community "50"
    createAndSaveBadge("500", "50");
    createAndSaveCommunity("50", "500");
    createAndSaveUser(manager, ["500"]);

    handleTransferSingle(
      createTransferSingleEvent(
        manager,
        Address.fromString(ZERO_ADDRESS),
        BigInt.fromI32(500),
        BigInt.fromI32(1),
      ),
    );

    assert.entityCount("BadgeBurnedActivity", 1);
    assert.entityCount("MemberLeftActivity", 0); // not a member badge

    log.success("BadgeBurnedActivity created when manager badge burned", []);
  });

  test("Should create BadgeBurnedActivity when member badge is burned", () => {
    const member = Address.fromString(
      "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
    );

    createAndSaveBadge("501", "51");
    const community = createAndSaveCommunity("51", "999", 1, "501");
    community.save();
    createAndSaveUser(member, ["501"], ["51"]);

    handleTransferSingle(
      createTransferSingleEvent(
        member,
        Address.fromString(ZERO_ADDRESS),
        BigInt.fromI32(501),
        BigInt.fromI32(1),
      ),
    );

    assert.entityCount("BadgeBurnedActivity", 1);
    assert.entityCount("MemberLeftActivity", 1);

    log.success("BadgeBurnedActivity created when member badge burned", []);
  });

  test("Should create BadgeBurnedActivity for non-manager community badge even when user is not in community", () => {
    const holder = Address.fromString(
      "0xf3dBd9F4C902c7183E0fd22bFdbAF5ed330845c4",
    );

    createAndSaveBadge("502", "52");
    createAndSaveCommunity("52", "998");
    createAndSaveUser(holder, ["502"], []); // holder has badge but is not in user.communities

    handleTransferSingle(
      createTransferSingleEvent(
        holder,
        Address.fromString(ZERO_ADDRESS),
        BigInt.fromI32(502),
        BigInt.fromI32(1),
      ),
    );

    assert.entityCount("BadgeBurnedActivity", 1);
    assert.entityCount("MemberLeftActivity", 0);

    log.success(
      "BadgeBurnedActivity created for non-manager community badge burn without member leave",
      [],
    );
  });
});

// ── ManagerChangedActivity ────────────────────────────────────────────────────

describe("ManagerChangedActivity", () => {
  afterEach(() => {
    clearStore();
  });

  test("Should create one ManagerChangedActivity when manager badge is transferred", () => {
    const fromManager = Address.fromString(
      "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
    );
    const toManager = Address.fromString(
      "0xf3dBd9F4C902c7183E0fd22bFdbAF5ed330845c4",
    );

    // Badge "600" is the manager badge of community "60"
    createAndSaveBadge("600", "60");
    createAndSaveCommunity("60", "600", 0);

    const fromUser = createAndSaveUser(fromManager, ["600"]);
    const fromManaged = fromUser.managedCommunities;
    fromManaged.push("60");
    fromUser.managedCommunities = fromManaged;
    fromUser.save();

    createAndSaveUser(toManager, []);

    handleTransferSingle(
      createTransferSingleEvent(
        fromManager,
        toManager,
        BigInt.fromI32(600),
        BigInt.fromI32(1),
      ),
    );

    assert.entityCount("ManagerChangedActivity", 1);
    assert.fieldEquals(
      "Community",
      "60",
      "managerAddress",
      toManager.toHexString(),
    );

    log.success("ManagerChangedActivity created on manager badge transfer", []);
  });

  test("Should NOT create ManagerChangedActivity when badge has no community", () => {
    const fromManager = Address.fromString(
      "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
    );
    const toManager = Address.fromString(
      "0xf3dBd9F4C902c7183E0fd22bFdbAF5ed330845c4",
    );

    createAndSaveBadge("601"); // no community
    createAndSaveUser(fromManager, ["601"]);
    createAndSaveUser(toManager, []);

    handleTransferSingle(
      createTransferSingleEvent(
        fromManager,
        toManager,
        BigInt.fromI32(601),
        BigInt.fromI32(1),
      ),
    );

    assert.entityCount("ManagerChangedActivity", 0);

    log.success("No ManagerChangedActivity when badge has no community", []);
  });
});

// ── MemberTransferredActivity ─────────────────────────────────────────────────

describe("MemberTransferredActivity", () => {
  afterEach(() => {
    clearStore();
  });

  test("Should create one MemberTransferredActivity when member badge is transferred", () => {
    const fromMember = Address.fromString(
      "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
    );
    const toMember = Address.fromString(
      "0xf3dBd9F4C902c7183E0fd22bFdbAF5ed330845c4",
    );

    // Badge "700" is a MEMBER badge (not the manager badge) of community "70"
    createAndSaveBadge("700", "70");
    createAndSaveCommunity("70", "999", 0, "700"); // manager badge "999" ≠ "700"

    const fromUser = createAndSaveUser(fromMember, ["700"], ["70"]);
    const community = Community.load("70")!;
    community.memberCount = BigInt.fromI32(1);
    community.save();

    createAndSaveUser(toMember, []);

    handleTransferSingle(
      createTransferSingleEvent(
        fromMember,
        toMember,
        BigInt.fromI32(700),
        BigInt.fromI32(1),
      ),
    );

    assert.entityCount("MemberTransferredActivity", 1);
    assert.entityCount("ManagerChangedActivity", 0);

    const updatedFromUser = User.load(fromMember.toHexString());
    assert.assertNotNull(updatedFromUser);
    assert.i32Equals(updatedFromUser!.communities.length, 0);

    const updatedToUser = User.load(toMember.toHexString());
    assert.assertNotNull(updatedToUser);
    assert.i32Equals(updatedToUser!.communities.length, 1);

    log.success(
      "MemberTransferredActivity created on member badge transfer",
      [],
    );
  });

  test("Should NOT create MemberTransferredActivity when recipient already holds badge", () => {
    const fromMember = Address.fromString(
      "0x5eA1474CeFA1ea5986327F97932B587deD802CF7",
    );
    const toMember = Address.fromString(
      "0xf3dBd9F4C902c7183E0fd22bFdbAF5ed330845c4",
    );

    createAndSaveBadge("701", "71");
    createAndSaveCommunity("71", "998");
    createAndSaveUser(fromMember, ["701"]);
    createAndSaveUser(toMember, ["701"]); // already holds badge

    handleTransferSingle(
      createTransferSingleEvent(
        fromMember,
        toMember,
        BigInt.fromI32(701),
        BigInt.fromI32(1),
      ),
    );

    assert.entityCount("MemberTransferredActivity", 0);

    log.success(
      "No MemberTransferredActivity when recipient already holds badge",
      [],
    );
  });
});
