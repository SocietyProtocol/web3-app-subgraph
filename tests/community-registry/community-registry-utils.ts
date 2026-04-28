import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";
import {
  createMockedFunction,
  newMockEventWithParams,
} from "matchstick-as/assembly/index";
import {
  CommunityBadgeCreated,
  CommunityCreated,
  CommunityDetailsUpdated,
} from "../../generated/CommunityRegistry/CommunityRegistry";

export const COMMUNITY_REGISTRY_ADDRESS = Address.fromString(
  "0x84ffd2805af9d0946e02Fe19Cd1eE58228669B0e",
);

export const DEFAULT_CREATOR_ADDRESS =
  "0x5eA1474CeFA1ea5986327F97932B587deD802CF7";

export function createCommunityBadgeCreatedEvent(
  communityId: BigInt,
  badgeId: BigInt,
): CommunityBadgeCreated {
  const event = changetype<CommunityBadgeCreated>(
    newMockEventWithParams([
      new ethereum.EventParam(
        "communityId",
        ethereum.Value.fromUnsignedBigInt(communityId),
      ),
      new ethereum.EventParam(
        "badgeId",
        ethereum.Value.fromUnsignedBigInt(badgeId),
      ),
    ]),
  );
  event.address = COMMUNITY_REGISTRY_ADDRESS;
  return event;
}

export function createCommunityCreatedEvent(
  communityId: BigInt,
  creator: Address,
  memberBadgeId: BigInt,
  name: string = "",
  description: string = "",
): CommunityCreated {
  // Mock the getCommunityDetails view call so handleCommunityCreated can read
  // name and description at index time.
  createMockedFunction(
    COMMUNITY_REGISTRY_ADDRESS,
    "getCommunityDetails",
    "getCommunityDetails(uint256):((string,string,uint256,address,uint256))",
  )
    .withArgs([ethereum.Value.fromUnsignedBigInt(communityId)])
    .returns([
      ethereum.Value.fromTuple(
        changetype<ethereum.Tuple>([
          ethereum.Value.fromString(name),
          ethereum.Value.fromString(description),
          ethereum.Value.fromUnsignedBigInt(memberBadgeId),
          ethereum.Value.fromAddress(Address.zero()),
          ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0)),
        ]),
      ),
    ]);

  const event = changetype<CommunityCreated>(
    newMockEventWithParams([
      new ethereum.EventParam(
        "communityId",
        ethereum.Value.fromUnsignedBigInt(communityId),
      ),
      new ethereum.EventParam("creator", ethereum.Value.fromAddress(creator)),
      new ethereum.EventParam(
        "memberBadgeId",
        ethereum.Value.fromUnsignedBigInt(memberBadgeId),
      ),
    ]),
  );
  event.address = COMMUNITY_REGISTRY_ADDRESS;
  return event;
}

export function createCommunityDetailsUpdatedEvent(
  communityId: BigInt,
  name: string,
  description: string,
): CommunityDetailsUpdated {
  const event = changetype<CommunityDetailsUpdated>(
    newMockEventWithParams([
      new ethereum.EventParam(
        "communityId",
        ethereum.Value.fromUnsignedBigInt(communityId),
      ),
      new ethereum.EventParam("name", ethereum.Value.fromString(name)),
      new ethereum.EventParam(
        "description",
        ethereum.Value.fromString(description),
      ),
    ]),
  );
  event.address = COMMUNITY_REGISTRY_ADDRESS;
  return event;
}
