// For understanding the code better, I use the following assumptions
// AUT - Test Auctioning Token. The auctioneer wants to sell this token
// BDT - Test Bidding Token. The auctioneer wants to buy this token

// While initiating an auction, the exactOrder/initialOrder sellAmount corresponds to AUT and buyAmount corresponds to BDT
// While placing an order, the sellAmount corresponds to BDT and buyAmount corresponds to AUT

import {
  Address,
  BigInt,
  BigDecimal,
  dataSource,
  store,
  Bytes,
  log,
} from "@graphprotocol/graph-ts";
import { ERC20Contract } from "../generated/EasyAuction/ERC20Contract";
import { AuctionDetail, AuctionUser } from "../generated/schema";
import {
  EasyAuction,
  AuctionCleared,
  CancellationSellOrder,
  ClaimedFromOrder,
  NewAuction,
  NewSellOrder,
  NewUser,
  OwnershipTransferred,
  UserRegistration,
} from "../generated/EasyAuction/EasyAuction";
import { Order } from "../generated/schema";
import { getChainHexFromName, getChainIdFromName } from "./utils/getChainId";
import { getTokenList } from "./legitTokens";
import { findOrCreateUser } from "./user";
import { computeAuctionOutcome } from "./utils/clearing";
import { getValuesFromOrderId, OrderValues } from "./utils/order";

const ZERO = BigInt.zero();
const ONE = BigInt.fromI32(1);
const TEN = BigInt.fromString("10");
const ZERO_BD = BigDecimal.zero();

export function handleAuctionCleared(event: AuctionCleared): void {
  log.info("Handling AuctionCleared for auction ID: {}", [
    event.params.auctionId.toString(),
  ]);
  const auctioningTokensSold = event.params.soldAuctioningTokens;
  const auctionId = event.params.auctionId;
  const biddingTokensSold = event.params.soldBiddingTokens;

  let auctionDetails = AuctionDetail.load(auctionId.toString());
  if (!auctionDetails) {
    return;
  }
  const decimalAuctioningToken = auctionDetails.decimalsAuctioningToken;
  const decimalBiddingToken = auctionDetails.decimalsBiddingToken;

  const addressAuctioningToken = auctionDetails.addressAuctioningToken;
  const addressBiddingToken = auctionDetails.addressBiddingToken;

  auctionDetails.currentClearingOrderBuyAmount = auctioningTokensSold;
  auctionDetails.currentClearingOrderSellAmount = biddingTokensSold;
  const pricePoint = convertToPricePoint(
    biddingTokensSold,
    auctioningTokensSold,
    decimalAuctioningToken.toI32(),
    decimalBiddingToken.toI32(),
  );
  auctionDetails.currentClearingPrice = pricePoint.get("price");
  auctionDetails.currentVolume = pricePoint.get("volume");
  auctionDetails.currentBiddingAmount = biddingTokensSold;
  auctionDetails.interestScore = pricePoint
    .get("volume")
    .div(TEN.pow(<u8>decimalBiddingToken.toI32()).toBigDecimal());
  if (!pricePoint.get("price").equals(ZERO.toBigDecimal())) {
    auctionDetails.usdAmountTraded = getUsdAmountTraded(
      addressBiddingToken,
      addressAuctioningToken,
      biddingTokensSold,
      pricePoint.get("price"),
    );
  }

  auctionDetails.save();
}

export function handleCancellationSellOrder(
  event: CancellationSellOrder,
): void {
  log.info("Handling CancellationSellOrder for auction ID: {}", [
    event.params.auctionId.toString(),
  ]);
  let auctionId = event.params.auctionId;
  let sellAmount = event.params.sellAmount;
  let buyAmount = event.params.buyAmount;
  let userId = event.params.userId;
  let auctionDetails = AuctionDetail.load(auctionId.toString());
  if (!auctionDetails) {
    return;
  }
  let orderIdsToDelete: Map<string, string> = new Map();
  // Remove order from the list orders
  let orders: string[] = [];
  if (auctionDetails.orders) {
    orders = auctionDetails.orders!;
  }
  let orderId = getOrderEntityId(auctionId, sellAmount, buyAmount, userId);
  let index = orders.indexOf(orderId);
  if (index > -1) {
    let removedOrder = orders.splice(index, 1);
    orderIdsToDelete.set(removedOrder[0], removedOrder[0]);
  }
  auctionDetails.orders = orders;
  // Remove order from the list ordersWithoutClaimed
  let ordersWithoutClaimed: string[] = [];
  if (auctionDetails.ordersWithoutClaimed) {
    ordersWithoutClaimed = auctionDetails.ordersWithoutClaimed!;
  }
  index = ordersWithoutClaimed.indexOf(orderId);
  if (index > -1) {
    let removedOrder = ordersWithoutClaimed.splice(index, 1);
    orderIdsToDelete.set(removedOrder[0], removedOrder[0]);
  }
  auctionDetails.ordersWithoutClaimed = ordersWithoutClaimed;

  // Remove order from the list ordersWithoutDeleted
  orderIdsToDelete.values().forEach((orderId) => {
    store.remove("Order", orderId);
  });

  updateClearingOrderAndVolume(auctionDetails);

  log.info(
    "Sell order cancelled with Order ID: {} for auction ID: {}, new clearing price updated: {}",
    [
      orderId,
      auctionId.toString(),
      auctionDetails.currentClearingPrice.toString(),
    ],
  );
}

// Remove claimed orders
export function handleClaimedFromOrder(event: ClaimedFromOrder): void {
  log.info("Handling ClaimedFromOrder for auction ID: {}", [
    event.params.auctionId.toString(),
  ]);
  let auctionId = event.params.auctionId;
  let sellAmount = event.params.sellAmount;
  let buyAmount = event.params.buyAmount;
  let userId = event.params.userId;
  let auctionDetails = AuctionDetail.load(auctionId.toString());
  if (!auctionDetails) {
    return;
  }
  // Remove order from the list of orders in the ordersWithoutClaimed array
  let ordersWithoutClaimed: string[] = [];
  if (auctionDetails.ordersWithoutClaimed) {
    ordersWithoutClaimed = auctionDetails.ordersWithoutClaimed!;
  }
  let orderId = getOrderEntityId(auctionId, sellAmount, buyAmount, userId);
  // If orderId is present in the ordersWithoutClaimed array, remove it
  let index = ordersWithoutClaimed.indexOf(orderId);
  if (index > -1) {
    ordersWithoutClaimed.splice(index, 1);
  }
  auctionDetails.ordersWithoutClaimed = ordersWithoutClaimed;
  auctionDetails.save();
}

export function handleNewAuction(event: NewAuction): void {
  log.info("Handling NewAuction for auction ID: {}", [
    event.params.auctionId.toString(),
  ]);
  let eventTimeStamp = event.block.timestamp;
  let sellAmount = event.params._auctionedSellAmount;
  let buyAmount = event.params._minBuyAmount;
  let userId = event.params.userId;
  let auctionId = event.params.auctionId;
  let addressAuctioningToken = event.params._auctioningToken;
  let addressBiddingToken = event.params._biddingToken;
  let allowListSigner = event.params.allowListData;
  let allowListContract = event.params.allowListContract;

  let entityId = getOrderEntityId(auctionId, sellAmount, buyAmount, userId);
  let user = AuctionUser.load(userId.toString());
  if (!user) {
    return;
  }
  let biddingERC20Contract = ERC20Contract.bind(addressBiddingToken);
  let auctioningERC20Contract = ERC20Contract.bind(addressAuctioningToken);
  let auctionContract = EasyAuction.bind(event.address);
  let isAtomicClosureAllowed = auctionContract.auctionData(auctionId).value11;

  // Use try_* methods to handle contracts that don't properly implement ERC20
  let symbolAuctioningTokenResult = auctioningERC20Contract.try_symbol();
  let symbolAuctioningToken = symbolAuctioningTokenResult.reverted
    ? "UNKNOWN"
    : symbolAuctioningTokenResult.value;

  let decimalAuctioningTokenResult = auctioningERC20Contract.try_decimals();
  let decimalAuctioningToken = decimalAuctioningTokenResult.reverted
    ? 18
    : decimalAuctioningTokenResult.value;

  let symbolBiddingTokenResult = biddingERC20Contract.try_symbol();
  let symbolBiddingToken = symbolBiddingTokenResult.reverted
    ? "UNKNOWN"
    : symbolBiddingTokenResult.value;

  let decimalBiddingTokenResult = biddingERC20Contract.try_decimals();
  let decimalBiddingToken = decimalBiddingTokenResult.reverted
    ? 18
    : decimalBiddingTokenResult.value;
  let pricePoint = convertToPricePoint(
    sellAmount,
    buyAmount,
    decimalBiddingToken,
    decimalAuctioningToken,
  );

  let isPrivateAuction = !allowListContract.equals(
    Address.fromString("0x0000000000000000000000000000000000000000"),
  );

  let order = new Order(entityId);
  order.auctionId = auctionId;
  order.buyAmount = buyAmount;
  order.sellAmount = sellAmount;
  order.auctionUser = userId.toString();
  order.userAddress = user.address;
  order.volume = pricePoint.get("volume");
  order.price = ONE.divDecimal(pricePoint.get("price"));
  order.timestamp = eventTimeStamp;
  order.save();
  let auctionDetails = new AuctionDetail(auctionId.toString());
  auctionDetails.auctionId = auctionId;
  auctionDetails.exactOrder = order.id;
  auctionDetails.symbolAuctioningToken = symbolAuctioningToken;
  auctionDetails.symbolBiddingToken = symbolBiddingToken;
  auctionDetails.addressAuctioningToken = addressAuctioningToken;
  auctionDetails.addressBiddingToken = addressBiddingToken;
  auctionDetails.decimalsAuctioningToken = BigInt.fromString(
    `${decimalAuctioningToken}`,
  );
  auctionDetails.decimalsBiddingToken = BigInt.fromString(
    `${decimalBiddingToken}`,
  );
  auctionDetails.endTimeTimestamp = event.params.auctionEndDate;
  auctionDetails.orderCancellationEndDate =
    event.params.orderCancellationEndDate;
  auctionDetails.startingTimeStamp = eventTimeStamp;
  auctionDetails.minimumBiddingAmountPerOrder =
    event.params.minimumBiddingAmountPerOrder;
  auctionDetails.minFundingThreshold = event.params.minFundingThreshold;
  auctionDetails.allowListManager = event.params.allowListContract;
  auctionDetails.allowListSigner = allowListSigner;
  auctionDetails.currentClearingPrice = ONE.divDecimal(pricePoint.get("price"));
  auctionDetails.currentBiddingAmount = BigInt.zero();
  auctionDetails.isAtomicClosureAllowed = isAtomicClosureAllowed;
  auctionDetails.isPrivateAuction = isPrivateAuction;
  auctionDetails.interestScore = BigDecimal.fromString("0");
  auctionDetails.usdAmountTraded = BigDecimal.fromString("0");
  auctionDetails.chainId = getChainHexFromName(dataSource.network());
  auctionDetails.currentVolume = BigDecimal.fromString("0");
  auctionDetails.currentClearingOrderSellAmount = BigInt.zero();
  auctionDetails.currentClearingOrderBuyAmount = BigInt.zero();
  auctionDetails.orders = [];
  auctionDetails.ordersWithoutClaimed = [];
  auctionDetails.save();
}

export function convertToPricePoint(
  sellAmount: BigInt,
  buyAmount: BigInt,
  decimalsBuyToken: number,
  decimalsSellToken: number,
): Map<string, BigDecimal> {
  if (buyAmount.equals(ZERO)) {
    let pricePoint = new Map<string, BigDecimal>();
    pricePoint.set("price", BigDecimal.fromString("0"));
    pricePoint.set("volume", BigDecimal.fromString("1"));

    return pricePoint;
  }
  let bidByAuctionDecimal = TEN.pow(<u8>decimalsBuyToken).divDecimal(
    TEN.pow(<u8>decimalsSellToken).toBigDecimal(),
  );

  let price: BigDecimal = sellAmount
    .divDecimal(buyAmount.toBigDecimal())
    .times(bidByAuctionDecimal);
  let volume: BigDecimal = sellAmount.divDecimal(
    TEN.pow(<u8>decimalsSellToken).toBigDecimal(),
  );

  let pricePoint = new Map<string, BigDecimal>();
  pricePoint.set("price", price);
  pricePoint.set("volume", volume);

  return pricePoint;
}

/**
 *	@dev This function is called when a new sell order is placed
 *  OrderID is generated by concatenating auctionId, sellAmount, buyAmount and userId
 */
export function handleNewSellOrder(event: NewSellOrder): void {
  log.info("Handling NewSellOrder for auction ID: {}", [
    event.params.auctionId.toString(),
  ]);
  let auctionId = event.params.auctionId;
  let sellAmount = event.params.sellAmount;
  let buyAmount = event.params.buyAmount;
  let userId = event.params.userId;

  let user = AuctionUser.load(userId.toString());
  if (!user) {
    // User should have been created and initialized (including address)
    // in a separate handler (e.g. handleNewAuctionUser). If it's missing,
    // we cannot safely proceed.
    return;
  }

  let auctionDetails = AuctionDetail.load(auctionId.toString());
  if (!auctionDetails) {
    return;
  }

  let entityId = getOrderEntityId(auctionId, sellAmount, buyAmount, userId);
  let pricePoint = convertToPricePoint(
    sellAmount,
    buyAmount,
    auctionDetails.decimalsAuctioningToken.toI32(),
    auctionDetails.decimalsBiddingToken.toI32(),
  );

  let order = new Order(entityId);
  order.auctionId = auctionId;
  order.buyAmount = buyAmount;
  order.sellAmount = sellAmount;
  order.auctionUser = userId.toString();
  order.userAddress = user.address;
  order.price = pricePoint.get("price");
  order.volume = pricePoint.get("volume");
  order.timestamp = event.block.timestamp;
  order.save();

  let orders: string[] = [];
  if (auctionDetails.orders) {
    orders = auctionDetails.orders!;
  }
  orders.push(order.id);
  auctionDetails.orders = orders;

  let ordersWithoutClaimed: string[] = [];
  if (auctionDetails.ordersWithoutClaimed) {
    ordersWithoutClaimed = auctionDetails.ordersWithoutClaimed!;
  }
  ordersWithoutClaimed.push(order.id);
  auctionDetails.ordersWithoutClaimed = ordersWithoutClaimed;

  // Check if auctionId is present in userAuctions list. If not, add it.
  let userAuctions = user.auctions;
  if (!userAuctions.includes(auctionId.toString())) {
    userAuctions.push(auctionId.toString());
    user.auctions = userAuctions;
  }
  user.save();
  auctionDetails.save();

  updateClearingOrderAndVolume(auctionDetails);

  log.info(
    "New sell order placed with Order ID: {} for auction ID: {}, new clearing price updated: {}",
    [
      order.id,
      auctionId.toString(),
      auctionDetails.currentClearingPrice.toString(),
    ],
  );
}

export function handleNewAuctionUser(event: NewUser): void {
  log.info("Handling NewUser for user ID: {}", [
    event.params.userId.toString(),
  ]);
  let userId = event.params.userId;
  let userAddress = event.params.userAddress;
  let user = new AuctionUser(userId.toString());
  user.address = userAddress;
  const internalUser = findOrCreateUser(userAddress.toHexString());
  user.user = internalUser.id;
  user.auctions = new Array();
  user.save();
}

export function handleOwnershipTransferred(event: OwnershipTransferred): void {}

export function handleUserRegistration(event: UserRegistration): void {}

export function getOrderEntityId(
  auctionId: BigInt,
  sellAmount: BigInt,
  buyAmount: BigInt,
  userId: BigInt,
): string {
  return `${auctionId.toString()}-${sellAmount.toString()}-${buyAmount.toString()}-${userId.toString()}`;
}

function getUsdAmountTraded(
  addressBiddingToken: Bytes,
  addressAuctioningToken: Bytes,
  currentBiddingAmount: BigInt,
  currentClearingPrice: BigDecimal,
): BigDecimal {
  const legitTokensList = getTokenList(
    getChainIdFromName(dataSource.network()),
  );
  if (!legitTokensList) {
    return ZERO.toBigDecimal();
  }

  // Check if bidding token is a legit token
  let isBiddingTokenLegit = legitTokensList.tokenAddressList.includes(
    addressBiddingToken.toHexString().toLowerCase(),
  );
  if (isBiddingTokenLegit) {
    return currentBiddingAmount.toBigDecimal();
  }

  // Check if auctioning token is a legit token
  let isAuctioningTokenLegit = legitTokensList.tokenAddressList.includes(
    addressAuctioningToken.toHexString().toLowerCase(),
  );
  if (isAuctioningTokenLegit) {
    return currentBiddingAmount.toBigDecimal().div(currentClearingPrice);
  }
  return ZERO.toBigDecimal();
}

export function updateClearingOrderAndVolume(auction: AuctionDetail): void {
  if (!auction) return;

  if (!auction.orders || auction.orders!.length == 0) {
    auction.currentClearingPrice = ZERO_BD;
    auction.currentVolume = ZERO_BD;
    auction.currentBiddingAmount = ZERO;
    auction.currentClearingOrderSellAmount = ZERO;
    auction.currentClearingOrderBuyAmount = ZERO;
    auction.interestScore = ZERO_BD;
    auction.usdAmountTraded = ZERO_BD;
    auction.save();
    return;
  }

  let exactOrder = getValuesFromOrderId(auction.exactOrder);

  if (exactOrder == null) {
    auction.currentClearingPrice = ZERO_BD;
    auction.currentVolume = ZERO_BD;
    auction.currentBiddingAmount = ZERO;
    auction.currentClearingOrderSellAmount = ZERO;
    auction.currentClearingOrderBuyAmount = ZERO;
    auction.interestScore = ZERO_BD;
    auction.usdAmountTraded = ZERO_BD;
    auction.save();
    return;
  }

  let outcome = computeAuctionOutcome(
    auction.orders!,
    exactOrder.sellAmount,
    auction.minFundingThreshold,
    auction.decimalsAuctioningToken.toI32(),
    auction.decimalsBiddingToken.toI32(),
  );

  auction.currentClearingPrice = outcome.price;

  // convert AUT raw volume → normalized decimal
  auction.currentVolume = outcome.auctioningVolume
    .toBigDecimal()
    .div(TEN.pow(<u8>auction.decimalsAuctioningToken.toI32()).toBigDecimal());

  auction.currentBiddingAmount = outcome.biddingVolume;

  // interestScore = normalized BDT collected
  auction.interestScore = outcome.biddingVolume
    .toBigDecimal()
    .div(TEN.pow(<u8>auction.decimalsBiddingToken.toI32()).toBigDecimal());

  // Keep clearing order amounts in sync (BDT collected / AUT sold)
  auction.currentClearingOrderSellAmount = outcome.biddingVolume;
  auction.currentClearingOrderBuyAmount = outcome.auctioningVolume;

  if (!outcome.price.equals(ZERO_BD)) {
    auction.usdAmountTraded = getUsdAmountTraded(
      auction.addressBiddingToken,
      auction.addressAuctioningToken,
      outcome.biddingVolume,
      outcome.price,
    );
  } else {
    // When there is no valid price (e.g. not funded / no clearing),
    // ensure usdAmountTraded does not leak a stale non-zero value.
    auction.usdAmountTraded = ZERO_BD;
  }

  auction.save();
}
