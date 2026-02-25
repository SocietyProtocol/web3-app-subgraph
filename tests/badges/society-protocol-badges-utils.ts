import { Address, BigInt, ethereum, Bytes } from "@graphprotocol/graph-ts";
import { newMockEventWithParams } from "matchstick-as/assembly/index";
import {
  BadgeCreated,
  HookUpdated,
  ProfileCreated,
  TransferBatch,
  TransferSingle,
  URI,
} from "../../generated/SocietyProtocolBadges/SocietyProtocolBadges";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const societyProtocolBadgesContractAddress = Address.fromString(
  "0x0000000000000000000000000000000000000001",
);

export function createBadgeCreatedEvent(
  id: BigInt,
  name: string,
  isOfficial: boolean,
  timestamp: BigInt,
): BadgeCreated {
  let badgeCreatedEvent = changetype<BadgeCreated>(
    newMockEventWithParams([
      new ethereum.EventParam("id", ethereum.Value.fromUnsignedBigInt(id)),
      new ethereum.EventParam("name", ethereum.Value.fromString(name)),
      new ethereum.EventParam(
        "isOfficial",
        ethereum.Value.fromBoolean(isOfficial),
      ),
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

export function createTransferSingleEvent(
  from: Address,
  to: Address,
  id: BigInt,
  value: BigInt,
): TransferSingle {
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
): TransferBatch {
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
