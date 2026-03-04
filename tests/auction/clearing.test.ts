import { assert, describe, log, test } from "matchstick-as/assembly/index";
import { BigInt } from "@graphprotocol/graph-ts";

import { computeAuctionOutcome } from "../../src/utils/clearing";
import { sortOrders } from "../../src/utils/sortOrders";

// Order ID format: "auctionId-sellAmount-buyAmount-userId"
// sellAmount = bidding token amount, buyAmount = auctioning token amount

describe("sortOrders – tie-breakers", () => {
  test("higher sellAmount comes first when prices are equal", () => {
    // "1-200-100-2": price = 200/100 = 2.0
    // "1-100-50-1":  price = 100/50  = 2.0  (same price, lower sellAmount)
    // cross-mult: 200*50=10000 vs 100*100=10000 → tie on price
    // tie-breaker 1: sellAmount 200 > 100 → "1-200-100-2" sorts first
    let orderIds = ["1-100-50-1", "1-200-100-2"];
    let sorted = sortOrders(orderIds);
    assert.stringEquals(sorted[0], "1-200-100-2");
    assert.stringEquals(sorted[1], "1-100-50-1");
    log.success("sortOrders tie-breaker: higher sellAmount first", []);
  });

  test("lower userId comes first when price and sellAmount are equal", () => {
    // "1-100-50-3" and "1-100-50-1" have identical price and sellAmount
    // tie-breaker 2: userId 1 < 3 → "1-100-50-1" sorts first
    let orderIds = ["1-100-50-3", "1-100-50-1"];
    let sorted = sortOrders(orderIds);
    assert.stringEquals(sorted[0], "1-100-50-1");
    assert.stringEquals(sorted[1], "1-100-50-3");
    log.success("sortOrders tie-breaker: lower userId first", []);
  });
});

// Shared scenario used in the computeAuctionOutcome tests below.
// Orders are passed UNSORTED; computeAuctionOutcome sorts them internally.
//
//   Order A: "1-200-100-2" – sellAmount=200 BDT, buyAmount=100 AUT (lower price = 2.0)
//   Order B: "1-300-75-1"  – sellAmount=300 BDT, buyAmount=75 AUT  (higher price = 4.0)
//   totalAuctionSupply = 100 AUT
//
//   After internal sort (descending price): [B, A]
//   Processing B first: nextAUT = 0+75 = 75 < 100 → fully filled
//     cumulativeAUT = 75, cumulativeBDT = 300
//   Processing A:       nextAUT = 75+100 = 175 ≥ 100 → clearing order
//     remainingAUT = 100-75 = 25
//     partialBDT   = 200 * 25 / 100 = 50
//     finalBDT     = 300 + 50 = 350

describe("computeAuctionOutcome", () => {
  test("partial fill: biddingVolume is correctly computed for the marginal order", () => {
    let orderIds = ["1-200-100-2", "1-300-75-1"]; // intentionally unsorted
    let totalAuctionSupply = BigInt.fromI32(100);
    let minFundingThreshold = BigInt.fromI32(100); // 350 ≥ 100 → funded

    let outcome = computeAuctionOutcome(
      orderIds,
      totalAuctionSupply,
      minFundingThreshold,
      0,
      0,
    );

    assert.stringEquals(outcome.biddingVolume.toString(), "350");
    assert.stringEquals(outcome.auctioningVolume.toString(), "100");
    log.success(
      "computeAuctionOutcome partial fill: biddingVolume = 350, auctioningVolume = 100",
      [],
    );
  });

  test("minFundingThreshold: returns zero outcome when finalBDT is below threshold", () => {
    let orderIds = ["1-200-100-2", "1-300-75-1"]; // intentionally unsorted
    let totalAuctionSupply = BigInt.fromI32(100);
    let minFundingThreshold = BigInt.fromI32(500); // 350 < 500 → not funded

    let outcome = computeAuctionOutcome(
      orderIds,
      totalAuctionSupply,
      minFundingThreshold,
      0,
      0,
    );

    assert.stringEquals(outcome.biddingVolume.toString(), "0");
    assert.stringEquals(outcome.auctioningVolume.toString(), "0");
    assert.stringEquals(outcome.price.toString(), "0");
    log.success(
      "computeAuctionOutcome not funded: zero outcome when finalBDT < threshold",
      [],
    );
  });

  test("minFundingThreshold: returns full outcome when finalBDT exactly equals threshold", () => {
    let orderIds = ["1-200-100-2", "1-300-75-1"]; // intentionally unsorted
    let totalAuctionSupply = BigInt.fromI32(100);
    let minFundingThreshold = BigInt.fromI32(350); // 350 == 350 → exactly funded

    let outcome = computeAuctionOutcome(
      orderIds,
      totalAuctionSupply,
      minFundingThreshold,
      0,
      0,
    );

    assert.stringEquals(outcome.biddingVolume.toString(), "350");
    assert.stringEquals(outcome.auctioningVolume.toString(), "100");
    log.success(
      "computeAuctionOutcome funded at threshold: full outcome when finalBDT == threshold",
      [],
    );
  });

  // Undersubscribed auction scenario.
  // Orders are passed UNSORTED; computeAuctionOutcome sorts them internally.
  //
  //   Order A: "1-300-80-2"  – sellAmount=300 BDT, buyAmount=80 AUT (lower price = 3.75, last after sort)
  //   Order B: "1-400-80-1"  – sellAmount=400 BDT, buyAmount=80 AUT (higher price = 5.0, first after sort)
  //   totalAuctionSupply = 200 AUT
  //
  //   After internal sort (descending price): [B, A]
  //   Total AUT demanded = 80 + 80 = 160 < 200 → undersubscribed (orderId == null)
  //   cumulativeBDT = 400 + 300 = 700, cumulativeAUT = 160
  //   Clearing price = last order A price = 300/80 = 3.75

  test("undersubscribed: returns actual volumes and last-order price when demand < supply", () => {
    let orderIds = ["1-300-80-2", "1-400-80-1"]; // intentionally unsorted
    let totalAuctionSupply = BigInt.fromI32(200); // higher than total demand of 160
    let minFundingThreshold = BigInt.fromI32(100); // 700 ≥ 100 → funded

    let outcome = computeAuctionOutcome(
      orderIds,
      totalAuctionSupply,
      minFundingThreshold,
      0,
      0,
    );

    assert.stringEquals(outcome.biddingVolume.toString(), "700");
    assert.stringEquals(outcome.auctioningVolume.toString(), "160");
    // price = 300/80 = 3.75
    assert.stringEquals(outcome.price.toString(), "3.75");
    log.success(
      "computeAuctionOutcome undersubscribed: actual volumes and last-order price returned",
      [],
    );
  });

  test("undersubscribed: returns zeros when no orders exist", () => {
    let orderIds: string[] = [];
    let totalAuctionSupply = BigInt.fromI32(100);
    let minFundingThreshold = BigInt.fromI32(0);

    let outcome = computeAuctionOutcome(
      orderIds,
      totalAuctionSupply,
      minFundingThreshold,
      0,
      0,
    );

    assert.stringEquals(outcome.biddingVolume.toString(), "0");
    assert.stringEquals(outcome.auctioningVolume.toString(), "0");
    assert.stringEquals(outcome.price.toString(), "0");
    log.success(
      "computeAuctionOutcome undersubscribed empty: zero outcome for empty order list",
      [],
    );
  });

  test("undersubscribed: returns zeros when cumulativeBDT is below minFundingThreshold", () => {
    let orderIds = ["1-300-80-2", "1-400-80-1"]; // intentionally unsorted
    let totalAuctionSupply = BigInt.fromI32(200); // higher than total demand of 160
    let minFundingThreshold = BigInt.fromI32(800); // 700 < 800 → not funded

    let outcome = computeAuctionOutcome(
      orderIds,
      totalAuctionSupply,
      minFundingThreshold,
      0,
      0,
    );

    assert.stringEquals(outcome.biddingVolume.toString(), "0");
    assert.stringEquals(outcome.auctioningVolume.toString(), "0");
    assert.stringEquals(outcome.price.toString(), "0");
    log.success(
      "computeAuctionOutcome undersubscribed not funded: zero outcome when BDT < threshold",
      [],
    );
  });
});
