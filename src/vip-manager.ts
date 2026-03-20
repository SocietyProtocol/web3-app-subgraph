import {
  TokensLocked,
  TokensUnlocked,
} from "../generated/SocietyVipManager/SocietyVipManager";
import { LockTransaction } from "../generated/schema";

export function handleTokensLocked(event: TokensLocked): void {
  let userId = event.params.user.toHex();
  let tx = new LockTransaction(event.transaction.hash.toHex());
  tx.userAddress = event.params.user;
  tx.user = userId;
  tx.amount = event.params.amount;
  tx.lockDate = event.block.timestamp;
  tx.unlockDate = event.params.unlockTime;
  tx.type = "lock";
  tx.save();
}

export function handleTokensUnlocked(event: TokensUnlocked): void {
  let userId = event.params.user.toHex();
  let tx = new LockTransaction(event.transaction.hash.toHex());
  tx.userAddress = event.params.user;
  tx.user = userId;
  tx.amount = event.params.amount;
  tx.lockDate = event.block.timestamp;
  tx.unlockDate = null;
  tx.type = "claim";
  tx.save();
}
