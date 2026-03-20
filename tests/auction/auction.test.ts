import {
  afterEach,
  assert,
  clearStore,
  describe,
  log,
  test,
} from "matchstick-as/assembly/index";
import { BigInt, Bytes } from "@graphprotocol/graph-ts";

import {
  createNewAuctionEvent,
  auctioningTokenContractAddress,
  biddingTokenContractAddress,
  mockAuctionDataFunctionCall,
  mockTokenSymbol,
  mockTokenDecimals,
  createNewUserEvent,
  createNewSellOrderEvent,
  createNewCancelOrderEvent,
  createNewClaimEvent,
} from "./utils";

import {
  entityTypes,
  TOKENS,
  encodedOrders,
  addresses,
  dates,
} from "./constants";
import { setupAuction1 } from "./test-setup";
import {
  handleCancellationSellOrder,
  handleClaimedFromOrder,
  handleNewAuction,
  handleNewAuctionUser,
  handleNewSellOrder,
} from "../../src/easy-auction";
import { AuctionDetail, AuctionUser } from "../../generated/schema";

describe("Can call mappings with custom events", () => {
  afterEach(() => {
    clearStore();
  });
  test("Can call handleNewAuctionUser with a custom NewUser event", () => {
    // Create a new user event
    let newUserEvent = createNewUserEvent(0x1, addresses.get("userAddress1"));

    // Add the user to the entity store by passing it to the handleNewAuctionUser handler
    handleNewAuctionUser(newUserEvent);

    // Assert that the user was added to the entity store
    assert.fieldEquals(entityTypes.get("AuctionUser"), "1", "id", "1");
    assert.fieldEquals(
      entityTypes.get("AuctionUser"),
      "1",
      "user",
      addresses.get("userAddress1").toLowerCase(),
    );
    log.success("handleNewAuctionUser adds user to the store", []);
  });

  test("Can call handleNewAuction with a custom NewAuction event", () => {
    // Add a user to the store
    let user = new AuctionUser("1");
    user.address = Bytes.fromHexString(addresses.get("userAddress1"));
    user.auctions = new Array();
    user.save();

    // Create a new auction event
    let newAuctionEvent = createNewAuctionEvent(
      0x1,
      addresses.get("auctioningTokenAddress"),
      addresses.get("biddingTokenAddress"),
      dates.get("orderCancellationEndDate1"),
      dates.get("auctionEndDate1"),
      0x1,
      TOKENS.get("1000"),
      TOKENS.get("2000"),
      TOKENS.get("1"),
      TOKENS.get("100"),
      addresses.get("zeroAddress"),
      "0x",
    );

    // Mock function calls which the handleAuction handler will make to the auction/token contracts
    mockAuctionDataFunctionCall(
      BigInt.fromString("1"),
      addresses.get("auctioningTokenAddress"),
      addresses.get("biddingTokenAddress"),
      dates.get("orderCancellationEndDate1"),
      dates.get("auctionEndDate1"),
      encodedOrders.get("initialAuctionOrder1"),
      TOKENS.get("1"),
      0,
      encodedOrders.get("startingOrder"),
      encodedOrders.get("zeroOrder"),
      0,
      false,
      false,
      0,
      TOKENS.get("100"),
    );

    mockTokenSymbol(auctioningTokenContractAddress, "AUT");
    mockTokenDecimals(auctioningTokenContractAddress, 18);

    mockTokenSymbol(biddingTokenContractAddress, "BDT");
    mockTokenDecimals(biddingTokenContractAddress, 18);

    // Add the auction to the entity store by passing it to the handleNewAuction handler
    handleNewAuction(newAuctionEvent);

    // Assertions
    assert.entityCount(entityTypes.get("AuctionDetail"), 1);
    log.success("Assert entity count", []);

    assert.fieldEquals(
      entityTypes.get("AuctionDetail"),
      "1",
      "exactOrder",
      "1-1000000000000000000000-2000000000000000000000-1",
    );
    log.success(
      "handleNewAuction adds a New Auction Detail entry to the store",
      [],
    );
  });

  test("Can call handleNewSellOrder and check if order is added to AuctionDetail order list", () => {
    // Add user 1 to the store
    let user = new AuctionUser("1");
    user.address = Bytes.fromHexString(addresses.get("userAddress1"));
    user.auctions = new Array();
    user.save();

    // Add user 2 to the store
    let user2 = new AuctionUser("2");
    user2.address = Bytes.fromHexString(addresses.get("userAddress2"));
    user2.auctions = new Array();
    user2.save();

    // Add a new auction to the store
    let newAuctionEvent = setupAuction1();
    handleNewAuction(newAuctionEvent);

    // Create a new sell order event
    let newSellOrderEvent = createNewSellOrderEvent(
      0x1,
      0x2,
      BigInt.fromString("1"),
      BigInt.fromString("2"),
    );
    handleNewSellOrder(newSellOrderEvent);

    let auctionDetail = AuctionDetail.load("1");
    assert.assertNotNull(auctionDetail);

    let orders = auctionDetail!.orders;
    // Expect the order to be added to the auctionDetail
    // Check that order id is `{auctionId}-{sellAmount}-{buyAmount}-{userId}`
    assert.stringEquals(orders![0], "1-2-1-2");
    log.success("handleNewSellOrder adds order to AuctionDetail", []);
  });

  test("Can call handleCancellationSellOrder and check if order is removed from AuctionDetail order list", () => {
    // Add user 1 to the store
    let user = new AuctionUser("1");
    user.address = Bytes.fromHexString(addresses.get("userAddress1"));
    user.auctions = new Array();
    user.save();

    // Add user 2 to the store
    let user2 = new AuctionUser("2");
    user2.address = Bytes.fromHexString(addresses.get("userAddress2"));
    user2.auctions = new Array();
    user2.save();

    // Add a new auction to the store
    let newAuctionEvent = setupAuction1();
    handleNewAuction(newAuctionEvent);

    // Create a new sell order event
    let newSellOrderEvent = createNewSellOrderEvent(
      0x1,
      0x2,
      BigInt.fromString("1"),
      BigInt.fromString("2"),
    );
    handleNewSellOrder(newSellOrderEvent);

    let auctionDetail = AuctionDetail.load("1");
    assert.assertNotNull(auctionDetail);

    let orders = auctionDetail!.orders;
    // Expect the order to be added to the auctionDetail
    // Check that order id is `{auctionId}-{sellAmount}-{buyAmount}-{userId}`
    assert.stringEquals(orders![0], "1-2-1-2");
    log.success("handleNewSellOrder adds order to AuctionDetail", []);

    // Create a new cancel sell order event
    let cancelSellOrderEvent = createNewCancelOrderEvent(
      0x1,
      0x2,
      BigInt.fromString("1"),
      BigInt.fromString("2"),
    );
    handleCancellationSellOrder(cancelSellOrderEvent);

    auctionDetail = AuctionDetail.load("1");
    orders = auctionDetail!.orders;
    // Expect the order to be removed from the auctionDetail
    assert.i32Equals(orders!.length, 0);
    log.success(
      "handleCancellationSellOrder removes order from AuctionDetail",
      [],
    );
  });

  test("Can call handleClaimedFromOrder and check if order is removed from AuctionDetail ordersWithoutClaimed list", () => {
    // Add user 1 to the store
    let user = new AuctionUser("1");
    user.address = Bytes.fromHexString(addresses.get("userAddress1"));
    user.auctions = new Array();
    user.save();

    // Add user 2 to the store
    let user2 = new AuctionUser("2");
    user2.address = Bytes.fromHexString(addresses.get("userAddress2"));
    user2.auctions = new Array();
    user2.save();

    // Add a new auction to the store
    let newAuctionEvent = setupAuction1();
    handleNewAuction(newAuctionEvent);

    // Create a new sell order event
    let newSellOrderEvent = createNewSellOrderEvent(
      0x1,
      0x2,
      BigInt.fromString("1"),
      BigInt.fromString("2"),
    );
    handleNewSellOrder(newSellOrderEvent);

    let auctionDetail = AuctionDetail.load("1");
    assert.assertNotNull(auctionDetail);

    let orders = auctionDetail!.ordersWithoutClaimed;
    // Expect the order to be added to the auctionDetail
    // Check that order id is `{auctionId}-{sellAmount}-{buyAmount}-{userId}`
    assert.stringEquals(orders![0], "1-2-1-2");
    log.success("handleNewSellOrder adds order to AuctionDetail", []);

    // Create a new claim event
    let claimEvent = createNewClaimEvent(
      0x1,
      0x2,
      BigInt.fromString("1"),
      BigInt.fromString("2"),
    );
    handleClaimedFromOrder(claimEvent);

    auctionDetail = AuctionDetail.load("1");
    orders = auctionDetail!.ordersWithoutClaimed;
    // Expect the order to be removed from the auctionDetail
    assert.i32Equals(orders!.length, 0);
    log.success("handleClaimedFromOrder removes order from AuctionDetail", []);
  });
});

describe("handleNewAuctionUser — address management", () => {
  afterEach(() => {
    clearStore();
  });

  test("stores the canonical address from the NewUser event, not transaction.from", () => {
    // userAddress2 is distinct from any address newMockEventWithParams uses as
    // transaction.from, so this confirms we read event.params.userAddress.
    let newUserEvent = createNewUserEvent(0x5, addresses.get("userAddress2"));
    handleNewAuctionUser(newUserEvent);

    assert.fieldEquals(
      "AuctionUser",
      "5",
      "address",
      addresses.get("userAddress2").toLowerCase(),
    );
    log.success("handleNewAuctionUser stores event.params.userAddress", []);
  });

  test("corrects a stale fallback address when a NewUser event arrives later", () => {
    // Simulate findOrCreateAuctionUser having been called with transaction.from
    // (an incorrect sender address) before the corresponding NewUser event was indexed.
    let staleAddress = addresses.get("userAddress1");
    let preCreated = new AuctionUser("7");
    preCreated.address = Bytes.fromHexString(staleAddress);
    preCreated.auctions = new Array();
    preCreated.save();

    assert.fieldEquals(
      "AuctionUser",
      "7",
      "address",
      staleAddress.toLowerCase(),
    );

    // The NewUser event now arrives with the real, authoritative address.
    let realAddress = addresses.get("userAddress2");
    handleNewAuctionUser(createNewUserEvent(0x7, realAddress));

    assert.fieldEquals(
      "AuctionUser",
      "7",
      "address",
      realAddress.toLowerCase(),
    );
    log.success("handleNewAuctionUser corrects stale fallback address", []);
  });
});

describe("isTargetAuction / AUCTION_ID_FILTER", () => {
  afterEach(() => {
    clearStore();
  });

  // NOTE: The "skip non-target auction" branch (when AUCTION_ID_FILTER != "0")
  // cannot be exercised in this suite. AUCTION_ID_FILTER is a compile-time
  // constant written by scripts/prepare.js into src/auction-config.ts, which
  // defaults to "0" (index everything). Testing the skip path would require a
  // separate build produced by running `AUCTION_ID=<n> npm run prepare` before
  // compiling the test wasm.

  test("all auctions are indexed when AUCTION_ID_FILTER is '0'", () => {
    // Pre-create user 1 (required by handleNewAuction when filter is "0").
    let user = new AuctionUser("1");
    user.address = Bytes.fromHexString(addresses.get("userAddress1"));
    user.auctions = new Array();
    user.save();

    // Auction ID 9 — would be skipped if the filter were set to "1".
    let newAuctionEvent = createNewAuctionEvent(
      0x9,
      addresses.get("auctioningTokenAddress"),
      addresses.get("biddingTokenAddress"),
      dates.get("orderCancellationEndDate1"),
      dates.get("auctionEndDate1"),
      0x1,
      TOKENS.get("1000"),
      TOKENS.get("2000"),
      TOKENS.get("1"),
      TOKENS.get("100"),
      addresses.get("zeroAddress"),
      "0x",
    );

    mockAuctionDataFunctionCall(
      BigInt.fromString("9"),
      addresses.get("auctioningTokenAddress"),
      addresses.get("biddingTokenAddress"),
      dates.get("orderCancellationEndDate1"),
      dates.get("auctionEndDate1"),
      encodedOrders.get("initialAuctionOrder1"),
      TOKENS.get("1"),
      0,
      encodedOrders.get("startingOrder"),
      encodedOrders.get("zeroOrder"),
      0,
      false,
      false,
      0,
      TOKENS.get("100"),
    );

    mockTokenSymbol(auctioningTokenContractAddress, "AUT");
    mockTokenDecimals(auctioningTokenContractAddress, 18);
    mockTokenSymbol(biddingTokenContractAddress, "BDT");
    mockTokenDecimals(biddingTokenContractAddress, 18);

    handleNewAuction(newAuctionEvent);

    assert.entityCount("AuctionDetail", 1);
    assert.fieldEquals("AuctionDetail", "9", "auctionId", "9");
    log.success("all auctions indexed when AUCTION_ID_FILTER is '0'", []);
  });
});
