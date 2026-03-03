import { BigInt } from "@graphprotocol/graph-ts";

/**
 * Represents the parsed components of an order ID string.
 * Each order ID is expected to be in the format "auctionId-sellAmount-buyAmount-userId".
 */
export class OrderValues {
  auctionId: string;
  sellAmount: BigInt;
  buyAmount: BigInt;
  userId: BigInt;

  constructor(
    auctionId: string,
    sellAmount: BigInt,
    buyAmount: BigInt,
    userId: BigInt,
  ) {
    this.auctionId = auctionId;
    this.sellAmount = sellAmount;
    this.buyAmount = buyAmount;
    this.userId = userId;
  }
}

/**
 * Extracts the auction ID, sell amount, buy amount, and user ID from a given order ID string.
 * Each order ID is expected to be in the format "auctionId-sellAmount-buyAmount-userId".
 * The function splits the order ID string by the "-" delimiter and converts the sell amount, buy amount, and user ID into BigInt types for further processing.
 *
 * @param orderId - The order ID string to parse.
 * @returns An {@link OrderValues} instance containing the auction ID as a string, and the sell amount, buy amount, and user ID as BigInt types.
 * @throws If the order ID format is invalid (e.g., missing parts or non-numeric values for amounts and user ID), the function may throw an error during parsing.
 */
export function getValuesFromOrderId(orderId: string): OrderValues {
  let parts = orderId.split("-");

  return new OrderValues(
    parts[0],
    BigInt.fromString(parts[1]),
    BigInt.fromString(parts[2]),
    BigInt.fromString(parts[3]),
  );
}
