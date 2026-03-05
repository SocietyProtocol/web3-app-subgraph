import { BigDecimal, BigInt, log } from "@graphprotocol/graph-ts";
import { getValuesFromOrderId } from "./order";
import { sortOrders } from "./sortOrders";

let TEN = BigInt.fromI32(10);

export class ClearingResult {
  orderId: string | null;
  lastValidOrderId: string | null; // last valid (non-null, non-zero-buyAmount) order seen
  cumulativeBDT: BigInt; // fully filled BDT (before marginal)
  cumulativeAUT: BigInt; // fully filled AUT (before marginal)

  constructor(
    orderId: string | null,
    lastValidOrderId: string | null,
    cumulativeBDT: BigInt,
    cumulativeAUT: BigInt,
  ) {
    this.orderId = orderId;
    this.lastValidOrderId = lastValidOrderId;
    this.cumulativeBDT = cumulativeBDT;
    this.cumulativeAUT = cumulativeAUT;
  }
}

export class AuctionOutcome {
  price: BigDecimal;
  auctioningVolume: BigInt; // AUT
  biddingVolume: BigInt; // BDT

  constructor(
    price: BigDecimal,
    auctioningVolume: BigInt,
    biddingVolume: BigInt,
  ) {
    this.price = price;
    this.auctioningVolume = auctioningVolume;
    this.biddingVolume = biddingVolume;
  }
}

export function findClearingOrder(
  orderIds: string[],
  totalAuctionSupply: BigInt,
): ClearingResult {
  let cumulativeBDT = BigInt.zero();
  let cumulativeAUT = BigInt.zero();
  let lastValidOrderId: string | null = null;

  for (let i = 0; i < orderIds.length; i++) {
    let orderId = orderIds[i];
    let order = getValuesFromOrderId(orderId);

    if (order == null) {
      log.warning("findClearingOrder: skipping invalid order ID {}", [orderId]);
      continue;
    }

    if (order.buyAmount.isZero()) {
      log.warning("findClearingOrder: skipping order {} with buyAmount == 0", [
        orderId,
      ]);
      continue;
    }

    lastValidOrderId = orderId;
    let nextAUT = cumulativeAUT.plus(order.buyAmount);

    // Clearing happens here
    if (nextAUT.ge(totalAuctionSupply)) {
      return new ClearingResult(
        orderId,
        lastValidOrderId,
        cumulativeBDT,
        cumulativeAUT,
      );
    }

    cumulativeBDT = cumulativeBDT.plus(order.sellAmount);
    cumulativeAUT = nextAUT;
  }

  return new ClearingResult(
    null,
    lastValidOrderId,
    cumulativeBDT,
    cumulativeAUT,
  );
}

export function isAuctionFunded(
  cumulativeBDT: BigInt,
  minFundingThreshold: BigInt,
): boolean {
  return cumulativeBDT.ge(minFundingThreshold);
}

export function computeOrderPrice(
  orderId: string,
  decimalsAuctionToken: i32,
  decimalsBiddingToken: i32,
): BigDecimal {
  let order = getValuesFromOrderId(orderId);

  if (order == null) {
    log.warning("computeOrderPrice: invalid order ID {}", [orderId]);
    return BigDecimal.zero();
  }

  let numerator = order.sellAmount
    .toBigDecimal()
    .div(TEN.pow(decimalsBiddingToken as u8).toBigDecimal());

  let denominator = order.buyAmount
    .toBigDecimal()
    .div(TEN.pow(decimalsAuctionToken as u8).toBigDecimal());

  if (denominator.equals(BigDecimal.zero())) {
    return BigDecimal.zero();
  }

  return numerator.div(denominator);
}

/**
 * Computes the auction outcome (clearing price and volumes) for the given orders.
 *
 * Orders are sorted internally by descending price before processing, so callers
 * do not need to pre-sort the input array.
 */
export function computeAuctionOutcome(
  orderIds: string[],
  totalAuctionSupply: BigInt,
  minFundingThreshold: BigInt,
  decimalsAuctionToken: i32,
  decimalsBiddingToken: i32,
): AuctionOutcome {
  let sorted = sortOrders(orderIds);
  let result = findClearingOrder(sorted, totalAuctionSupply);

  if (result.orderId == null) {
    // Auction is undersubscribed: total demand < totalAuctionSupply.
    // Return the actual cumulative volumes at the last valid order's price
    // so live metrics show a meaningful value rather than all zeros.
    if (result.lastValidOrderId == null) {
      return new AuctionOutcome(
        BigDecimal.zero(),
        BigInt.zero(),
        BigInt.zero(),
      );
    }

    if (!isAuctionFunded(result.cumulativeBDT, minFundingThreshold)) {
      return new AuctionOutcome(
        BigDecimal.zero(),
        BigInt.zero(),
        BigInt.zero(),
      );
    }

    let price = computeOrderPrice(
      result.lastValidOrderId as string,
      decimalsAuctionToken,
      decimalsBiddingToken,
    );

    return new AuctionOutcome(
      price,
      result.cumulativeAUT,
      result.cumulativeBDT,
    );
  }

  let marginalOrder = getValuesFromOrderId(result.orderId as string);

  if (marginalOrder == null) {
    log.warning("computeAuctionOutcome: invalid marginal order ID {}", [
      result.orderId as string,
    ]);
    return new AuctionOutcome(BigDecimal.zero(), BigInt.zero(), BigInt.zero());
  }

  // Guard against invalid orders with zero buyAmount to avoid division by zero
  if (marginalOrder.buyAmount.isZero()) {
    log.warning(
      "computeAuctionOutcome: marginal order {} has buyAmount == 0; treating auction as non-clearing",
      [result.orderId as string],
    );
    return new AuctionOutcome(BigDecimal.zero(), BigInt.zero(), BigInt.zero());
  }

  // Remaining AUT to fill
  let remainingAUT = totalAuctionSupply.minus(result.cumulativeAUT);

  // Partial BDT from marginal order
  let partialBDT = marginalOrder.sellAmount
    .times(remainingAUT)
    .div(marginalOrder.buyAmount);

  let finalBDT = result.cumulativeBDT.plus(partialBDT);

  if (!isAuctionFunded(finalBDT, minFundingThreshold)) {
    return new AuctionOutcome(BigDecimal.zero(), BigInt.zero(), BigInt.zero());
  }

  // Compute clearing price
  let price = computeOrderPrice(
    result.orderId as string,
    decimalsAuctionToken,
    decimalsBiddingToken,
  );

  return new AuctionOutcome(
    price,
    totalAuctionSupply, // full AUT sold
    finalBDT, // actual BDT collected
  );
}
