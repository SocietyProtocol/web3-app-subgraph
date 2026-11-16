import { Address, BigInt, ethereum, Bytes } from "@graphprotocol/graph-ts";
import {
  createMockedFunction,
  newMockEventWithParams,
} from "matchstick-as/assembly/index";
import {
  BadgeCreated,
  BadgeModified,
  BadgePermissions,
  HookUpdated,
  ProfileCreated,
  TransferBatch,
  TransferSingle,
  URI,
  UserInvited,
} from "../../generated/SocietyProtocolBadges/SocietyProtocolBadges";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const societyProtocolBadgesContractAddress = Address.fromString(
  "0x0000000000000000000000000000000000000001",
);

export const DEFAULT_CREATOR_ADDRESS =
  "0x5eA1474CeFA1ea5986327F97932B587deD802CF7";

export function createBadgeCreatedEvent(
  id: BigInt,
  name: string,
  isOfficial: boolean,
  timestamp: BigInt,
  isCommunity: boolean = false,
  creator: Address = Address.fromString(DEFAULT_CREATOR_ADDRESS),
  uri: string = "",
): BadgeCreated {
  // Mock the uri(uint256) contract call so handleBadgeCreated can resolve it
  createMockedFunction(
    societyProtocolBadgesContractAddress,
    "uri",
    "uri(uint256):(string)",
  )
    .withArgs([ethereum.Value.fromUnsignedBigInt(id)])
    .returns([ethereum.Value.fromString(uri)]);

  let badgeCreatedEvent = changetype<BadgeCreated>(
    newMockEventWithParams([
      new ethereum.EventParam("id", ethereum.Value.fromUnsignedBigInt(id)),
      new ethereum.EventParam("name", ethereum.Value.fromString(name)),
      new ethereum.EventParam(
        "isOfficial",
        ethereum.Value.fromBoolean(isOfficial),
      ),
      new ethereum.EventParam(
        "isCommunityBadge",
        ethereum.Value.fromBoolean(isCommunity),
      ),
      new ethereum.EventParam("creator", ethereum.Value.fromAddress(creator)),
    ]),
  );

  badgeCreatedEvent.address = societyProtocolBadgesContractAddress;
  badgeCreatedEvent.block.timestamp = timestamp;

  return badgeCreatedEvent;
}

export function createHookUpdatedEvent(id: BigInt, hook: Address): HookUpdated {
  let hookUpdatedEvent = changetype<HookUpdated>(
    newMockEventWithParams([
      new ethereum.EventParam("id", ethereum.Value.fromUnsignedBigInt(id)),
      new ethereum.EventParam("hook", ethereum.Value.fromAddress(hook)),
    ]),
  );

  hookUpdatedEvent.address = societyProtocolBadgesContractAddress;

  return hookUpdatedEvent;
}

export function createProfileCreatedEvent(
  id: BigInt,
  userAddress: Address,
): ProfileCreated {
  let profileCreatedEvent = changetype<ProfileCreated>(
    newMockEventWithParams([
      new ethereum.EventParam("user", ethereum.Value.fromAddress(userAddress)),
      new ethereum.EventParam("id", ethereum.Value.fromUnsignedBigInt(id)),
    ]),
  );

  profileCreatedEvent.address = societyProtocolBadgesContractAddress;

  return profileCreatedEvent;
}

export function createURIEvent(id: BigInt, value: string): URI {
  let uriEvent = changetype<URI>(
    newMockEventWithParams([
      new ethereum.EventParam("value", ethereum.Value.fromString(value)),
      new ethereum.EventParam("id", ethereum.Value.fromUnsignedBigInt(id)),
    ]),
  );

  uriEvent.address = societyProtocolBadgesContractAddress;

  return uriEvent;
}

/**
 * Mocks `balanceOf(account, id)` on the badges contract. The handlers read it
 * after a burn or transfer to tell whether the sender still holds a copy.
 */
export function mockBalanceOf(
  account: Address,
  id: BigInt,
  balance: BigInt,
): void {
  createMockedFunction(
    societyProtocolBadgesContractAddress,
    "balanceOf",
    "balanceOf(address,uint256):(uint256)",
  )
    .withArgs([
      ethereum.Value.fromAddress(account),
      ethereum.Value.fromUnsignedBigInt(id),
    ])
    .returns([ethereum.Value.fromUnsignedBigInt(balance)]);
}

function mockSenderBalance(from: Address, id: BigInt, remaining: BigInt): void {
  if (from.toHexString() != ZERO_ADDRESS) {
    mockBalanceOf(from, id, remaining);
  }
}

/**
 * `remainingFromBalance` is the sender's balance after the event; zero (the
 * default) means the sender gave up their last copy.
 */
export function createTransferSingleEvent(
  from: Address,
  to: Address,
  id: BigInt,
  value: BigInt,
  remainingFromBalance: BigInt = BigInt.zero(),
): TransferSingle {
  mockSenderBalance(from, id, remainingFromBalance);
  let transferSingleEvent = changetype<TransferSingle>(
    newMockEventWithParams([
      new ethereum.EventParam(
        "operator",
        ethereum.Value.fromAddress(
          Address.fromString("0x0000000000000000000000000000000000000001"),
        ),
      ),
      new ethereum.EventParam("from", ethereum.Value.fromAddress(from)),
      new ethereum.EventParam("to", ethereum.Value.fromAddress(to)),
      new ethereum.EventParam("id", ethereum.Value.fromUnsignedBigInt(id)),
      new ethereum.EventParam(
        "value",
        ethereum.Value.fromUnsignedBigInt(value),
      ),
    ]),
  );

  transferSingleEvent.address = societyProtocolBadgesContractAddress;

  return transferSingleEvent;
}

export function createTransferBatchEvent(
  from: Address,
  to: Address,
  ids: Array<BigInt>,
  values: Array<BigInt>,
  remainingFromBalance: BigInt = BigInt.zero(),
): TransferBatch {
  for (let i = 0; i < ids.length; i++) {
    mockSenderBalance(from, ids[i], remainingFromBalance);
  }
  let transferBatchEvent = changetype<TransferBatch>(
    newMockEventWithParams([
      new ethereum.EventParam(
        "operator",
        ethereum.Value.fromAddress(
          Address.fromString("0x0000000000000000000000000000000000000001"),
        ),
      ),
      new ethereum.EventParam("from", ethereum.Value.fromAddress(from)),
      new ethereum.EventParam("to", ethereum.Value.fromAddress(to)),
      new ethereum.EventParam(
        "ids",
        ethereum.Value.fromUnsignedBigIntArray(ids),
      ),
      new ethereum.EventParam(
        "values",
        ethereum.Value.fromUnsignedBigIntArray(values),
      ),
    ]),
  );

  transferBatchEvent.address = societyProtocolBadgesContractAddress;

  return transferBatchEvent;
}

export function createBadgePermissionsEvent(
  id: BigInt,
  minters: Array<BigInt>,
  transferers: Array<BigInt>,
  burners: Array<BigInt>,
  editors: Array<Address> = [],
): BadgePermissions {
  let badgePermissionsEvent = changetype<BadgePermissions>(
    newMockEventWithParams([
      new ethereum.EventParam("id", ethereum.Value.fromUnsignedBigInt(id)),
      new ethereum.EventParam(
        "minters",
        ethereum.Value.fromUnsignedBigIntArray(minters),
      ),
      new ethereum.EventParam(
        "transferers",
        ethereum.Value.fromUnsignedBigIntArray(transferers),
      ),
      new ethereum.EventParam(
        "burners",
        ethereum.Value.fromUnsignedBigIntArray(burners),
      ),
      new ethereum.EventParam(
        "editors",
        ethereum.Value.fromAddressArray(editors),
      ),
    ]),
  );

  badgePermissionsEvent.address = societyProtocolBadgesContractAddress;

  return badgePermissionsEvent;
}

export function createBadgeModifiedEvent(
  id: BigInt,
  name: string,
  isOfficial: boolean,
  isCommunity: boolean = false,
  metadataURI: string = "",
): BadgeModified {
  let badgeModifiedEvent = changetype<BadgeModified>(
    newMockEventWithParams([
      new ethereum.EventParam("id", ethereum.Value.fromUnsignedBigInt(id)),
      new ethereum.EventParam("name", ethereum.Value.fromString(name)),
      new ethereum.EventParam(
        "isOfficial",
        ethereum.Value.fromBoolean(isOfficial),
      ),
      new ethereum.EventParam(
        "isCommunityBadge",
        ethereum.Value.fromBoolean(isCommunity),
      ),
      new ethereum.EventParam(
        "metadataURI",
        ethereum.Value.fromString(metadataURI),
      ),
    ]),
  );

  badgeModifiedEvent.address = societyProtocolBadgesContractAddress;

  return badgeModifiedEvent;
}

export function createUserInvitedEvent(
  inviter: Address,
  invitee: Address,
  nonce: BigInt = BigInt.fromI32(1),
): UserInvited {
  let event = changetype<UserInvited>(
    newMockEventWithParams([
      new ethereum.EventParam("inviter", ethereum.Value.fromAddress(inviter)),
      new ethereum.EventParam("invitee", ethereum.Value.fromAddress(invitee)),
      new ethereum.EventParam(
        "nonce",
        ethereum.Value.fromUnsignedBigInt(nonce),
      ),
    ]),
  );

  event.address = societyProtocolBadgesContractAddress;

  return event;
}
