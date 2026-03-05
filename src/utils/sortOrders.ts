import { getValuesFromOrderId } from "./order";

/**
 * Compares two order IDs based on their price (sellAmount / buyAmount) in descending order.
 * Each order ID is expected to be in the format "auctionId-sellAmount-buyAmount-userId".
 *  The function calculates the price for each order and compares them to determine their order in the sorted list.
 *  If two orders have the same price, it uses tie-breakers: first by larger sell amount, then by lower user ID.
 *
 * @param aOrderId - The first order ID to compare.
 * @param bOrderId - The second order ID to compare.
 * @returns -1 if aOrderId should come before bOrderId, 1 if bOrderId should come before aOrderId, or 0 if they are considered equal in sorting order.
 */
function comparePriceDesc(aOrderId: string, bOrderId: string): i32 {
  const aOrder = getValuesFromOrderId(aOrderId);
  const bOrder = getValuesFromOrderId(bOrderId);

  // Handle invalid order IDs defensively: sort invalid IDs last instead of throwing.
  if (aOrder == null && bOrder == null) {
    return 0;
  }
  if (aOrder == null) {
    return 1; // aOrderId is invalid, so it should come after bOrderId
  }
  if (bOrder == null) {
    return -1; // bOrderId is invalid, so it should come after aOrderId
  }

  let left = aOrder.sellAmount.times(bOrder.buyAmount);
  let right = bOrder.sellAmount.times(aOrder.buyAmount);

  // Higher price FIRST
  if (left.gt(right)) return -1;
  if (left.lt(right)) return 1;

  // Tie-breaker 1: larger sell amount first
  if (aOrder.sellAmount.gt(bOrder.sellAmount)) return -1;
  if (aOrder.sellAmount.lt(bOrder.sellAmount)) return 1;

  // Tie-breaker 2: lower userId first
  if (aOrder.userId.lt(bOrder.userId)) return -1;
  if (aOrder.userId.gt(bOrder.userId)) return 1;

  return 0;
}

/**
 *  Sorts an array of order IDs in descending order based on price (sellAmount / buyAmount).
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
