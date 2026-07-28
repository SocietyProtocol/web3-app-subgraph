import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import { Badge } from "../../generated/schema";
import { findOrCreateUser } from "../user";

export function findOrCreateBadge(badgeId: string, creator: string): Badge {
  let badge = Badge.load(badgeId);

  if (badge == null) {
    const createdByUser = findOrCreateUser(creator);
    badge = new Badge(badgeId);
    badge.creatorAddress = creator;
    badge.createdBy = createdByUser.id;
    badge.name = "";
    badge.isOfficial = false;
    badge.isCommunity = false;
    badge.isProfile = false;
    badge.hookAddress = new Bytes(0);
    badge.createdAt = BigInt.zero();
    badge.uri = "";
    badge.holdersCount = BigInt.zero();
    badge.minters = [];
    badge.burners = [];
    badge.transferers = [];
    badge.save();
  }

  return badge;
}

export function bigIntArrayToStringArray(arr: Array<BigInt>): string[] {
  const result: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    result.push(arr[i].toString());
  }
  return result;
}
