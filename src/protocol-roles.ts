import { Badge, User } from "../generated/schema";

const ROLE_NONE = "NONE";
const ROLE_GOVERNOR = "GOVERNOR";
const ROLE_CONTRIBUTOR = "CONTRIBUTOR";
const ROLE_CORE_TEAM = "CORE_TEAM";
const ROLE_ADVISOR = "ADVISOR";
const ROLE_MODERATOR = "MODERATOR";

export function protocolRoleFromBadgeName(name: string): string {
  if (name == "Governor") {
    return ROLE_GOVERNOR;
  }
  if (name == "Contributor") {
    return ROLE_CONTRIBUTOR;
  }
  if (name == "Core Team") {
    return ROLE_CORE_TEAM;
  }
  if (name == "Advisor") {
    return ROLE_ADVISOR;
  }
  if (name == "Moderator") {
    return ROLE_MODERATOR;
  }
  return ROLE_NONE;
}

export function applyBadgeProtocolRole(badge: Badge): void {
  badge.protocolRole = protocolRoleFromBadgeName(badge.name);
}

export function rebuildUserProtocolRoles(user: User): void {
  const roles = new Array<string>();
  const badgeIds = user.badges;

  for (let i = 0; i < badgeIds.length; i++) {
    const badge = Badge.load(badgeIds[i]);
    if (badge == null) {
      continue;
    }
    const role = badge.protocolRole;
    if (role == ROLE_NONE) {
      continue;
    }
    let exists = false;
    for (let j = 0; j < roles.length; j++) {
      if (roles[j] == role) {
        exists = true;
        break;
      }
    }
    if (!exists) {
      roles.push(role);
    }
  }

  user.protocolRoles = roles;
  user.protocolRoleCount = roles.length;
}
