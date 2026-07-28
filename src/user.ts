import { User } from "../generated/schema";

export const findOrCreateUser = (userId: string): User => {
  let user = User.load(userId);

  if (user == null) {
    user = new User(userId);
    user.badges = [];
    user.managedBadges = [];
    user.managedCommunities = [];
    user.communities = [];
    user.save();
  }

  return user;
};
