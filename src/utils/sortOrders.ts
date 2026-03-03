import { BigInt } from "@graphprotocol/graph-ts";
import { getValuesFromOrderId } from "./order";

/**
 * Compares two order IDs based on price (auctioningTokenAmount / biddingTokenAmount) in descending order.
 *
 *  Each order ID is expected to be in the format "auctionId-sellAmount-buyAmount-userId".
 *  The sellAmount represents the bidding token amount and the buyAmount represents the auctioning token amount.
 * The function uses cross-multiplication to compare prices without performing division, which avoids precision issues.
 * The sorting order is as follows:
 * 1. Price descending (higher price first)
 * 2. If prices are equal, then by bidding amount descending (higher bidding amount first)
 * 3. If both price and bidding amount are equal, then by user ID ascending (lower user ID first)
 *
 * @param aOrderId Order ID string in the format "auctionId-sellAmount-buyAmount-userId".
 * @param bOrderId Order ID string in the format "auctionId-sellAmount-buyAmount-userId".
 * @returns -1 if aOrderId should come before bOrderId, 1 if aOrderId should come after bOrderId, or 0 if they are considered equal in sorting order.
 */
function comparePriceDesc(aOrderId: string, bOrderId: string): i32 {
  const aOrder = getValuesFromOrderId(aOrderId);
  const bOrder = getValuesFromOrderId(bOrderId);

  let left = aOrder.sellAmount.times(bOrder.buyAmount);
  let right = bOrder.sellAmount.times(aOrder.buyAmount);

  // Higher price FIRST
  if (left.gt(right)) return -1;
  if (left.lt(right)) return 1;

  // Tie-breaker 1: larger bidding amount first
  if (aOrder.sellAmount.gt(bOrder.sellAmount)) return -1;
  if (aOrder.sellAmount.lt(bOrder.sellAmount)) return 1;

  // Tie-breaker 2: lower userId first
  if (aOrder.userId.lt(bOrder.userId)) return -1;
  if (aOrder.userId.gt(bOrder.userId)) return 1;

  return 0;
}

/**
 *  Sorts an array of order IDs in descending order based on price (auctioningTokenAmount / biddingTokenAmount).
 *
 * Each order ID is expected to be in the format "auctionId-sellAmount-buyAmount-userId".
 * The function modifies the input array in place and also returns it for convenience.
 * The sorting is done using the comparePriceDesc function, which ensures that orders with higher prices come first.
 *
 * @param orderIds Array of order ID strings to be sorted.
 * @returns The sorted array of order ID strings.
 */
export function sortOrders(orderIds: string[] | null): string[] {
  if (orderIds == null) return [];

  orderIds.sort(comparePriceDesc);

  return orderIds;
}

export default sortOrders;
