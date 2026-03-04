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
//   Order B: "1-300-80-2" – sellAmount=300 BDT, buyAmount=80 AUT (higher price = 3.75, sorted first)
//   Order A: "1-200-60-1" – sellAmount=200 BDT, buyAmount=60 AUT (lower price ≈ 3.33, marginal/clearing order)
//   totalAuctionSupply = 100 AUT
//
//   After internal sort (price desc): [B, A]
//   Processing order B first:   nextAUT = 0+80 = 80 < 100 → fully filled
//     cumulativeAUT = 80, cumulativeBDT = 300
//   Processing order A:         nextAUT = 80+60 = 140 ≥ 100 → clearing order
//     remainingAUT = 100-80 = 20
//     partialBDT   = 200 * 20 / 60 = 66 (integer division)
//     finalBDT     = 300 + 66 = 366

describe("computeAuctionOutcome", () => {
  test("partial fill: biddingVolume is correctly computed for the marginal order", () => {
    let orderIds = ["1-200-60-1", "1-300-80-2"]; // intentionally unsorted
    let totalAuctionSupply = BigInt.fromI32(100);
    let minFundingThreshold = BigInt.fromI32(100); // 366 ≥ 100 → funded

    let outcome = computeAuctionOutcome(
      orderIds,
      totalAuctionSupply,
      minFundingThreshold,
      0,
      0,
    );

    assert.stringEquals(outcome.biddingVolume.toString(), "366");
    assert.stringEquals(outcome.auctioningVolume.toString(), "100");
    log.success(
      "computeAuctionOutcome partial fill: biddingVolume = 366, auctioningVolume = 100",
      [],
    );
  });

  test("minFundingThreshold: returns zero outcome when finalBDT is below threshold", () => {
    let orderIds = ["1-200-60-1", "1-300-80-2"]; // intentionally unsorted
    let totalAuctionSupply = BigInt.fromI32(100);
    let minFundingThreshold = BigInt.fromI32(500); // 366 < 500 → not funded

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
    let orderIds = ["1-200-60-1", "1-300-80-2"]; // intentionally unsorted
    let totalAuctionSupply = BigInt.fromI32(100);
    let minFundingThreshold = BigInt.fromI32(366); // 366 == 366 → exactly funded

    let outcome = computeAuctionOutcome(
      orderIds,
      totalAuctionSupply,
      minFundingThreshold,
      0,
      0,
    );

    assert.stringEquals(outcome.biddingVolume.toString(), "366");
    assert.stringEquals(outcome.auctioningVolume.toString(), "100");
    log.success(
      "computeAuctionOutcome funded at threshold: full outcome when finalBDT == threshold",
      [],
    );
  });

  // Undersubscribed auction scenario.
  // Orders are passed UNSORTED; computeAuctionOutcome sorts them internally.
  //
  //   Order H: "1-400-80-1" – sellAmount=400 BDT, buyAmount=80 AUT (higher price = 5.0, sorted first)
  //   Order L: "1-300-80-2" – sellAmount=300 BDT, buyAmount=80 AUT (lower price = 3.75, sorted last)
  //   totalAuctionSupply = 200 AUT
  //
  //   After internal sort (price desc): [H, L]
  //   Total AUT demanded = 80 + 80 = 160 < 200 → undersubscribed (orderId == null)
  //   cumulativeBDT = 400 + 300 = 700, cumulativeAUT = 160
  //   Clearing price = last order L price = 300/80 = 3.75

  test("undersubscribed: returns actual volumes and last-order price when demand < supply", () => {
    let orderIds = ["1-400-80-1", "1-300-80-2"]; // intentionally unsorted
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

  test("zero-buyAmount orders are ignored and do not inflate biddingVolume", () => {
    // Order Z: "1-999-0-9" – sellAmount=999 BDT, buyAmount=0 AUT → must be skipped
    // After internal sort: Z sorts first (price=∞), then B (3.75), then A (≈3.33)
    // Z is skipped; B fills 80, A is marginal (same result as partial fill baseline)
    let orderIds = ["1-999-0-9", "1-200-60-1", "1-300-80-2"]; // intentionally unsorted
    let totalAuctionSupply = BigInt.fromI32(100);
    let minFundingThreshold = BigInt.fromI32(100); // 366 ≥ 100 → funded

    let outcome = computeAuctionOutcome(
      orderIds,
      totalAuctionSupply,
      minFundingThreshold,
      0,
      0,
    );

    // Z's sellAmount (999) must NOT be counted; result must equal the baseline
    assert.stringEquals(outcome.biddingVolume.toString(), "366");
    assert.stringEquals(outcome.auctioningVolume.toString(), "100");
    log.success(
      "computeAuctionOutcome: zero-buyAmount order ignored, biddingVolume = 366",
      [],
    );
  });

  test("undersubscribed: returns zeros when cumulativeBDT is below minFundingThreshold", () => {
    let orderIds = ["1-400-80-1", "1-300-80-2"]; // intentionally unsorted
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
