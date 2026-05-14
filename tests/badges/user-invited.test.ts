import {
  afterEach,
  assert,
  clearStore,
  describe,
  log,
  test,
} from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { User } from "../../generated/schema";
import { handleUserInvited } from "../../src/society-protocol-badges";
import {
  createUserInvitedEvent,
  DEFAULT_CREATOR_ADDRESS,
} from "./society-protocol-badges-utils";

const INVITER_ADDRESS = DEFAULT_CREATOR_ADDRESS;
const INVITEE_ADDRESS = "0xAaBbCcDdEeFf00112233445566778899aAbBcCdD";

describe("handleUserInvited", () => {
  afterEach(() => {
    clearStore();
  });

  test("Should set invitedBy on the invitee", () => {
    handleUserInvited(
      createUserInvitedEvent(
        Address.fromString(INVITER_ADDRESS),
        Address.fromString(INVITEE_ADDRESS),
      ),
    );

    assert.fieldEquals(
      "User",
      INVITEE_ADDRESS.toLowerCase(),
      "invitedBy",
      INVITER_ADDRESS.toLowerCase(),
    );

    log.success("invitedBy set on invitee after UserInvited", []);
  });

  test("Should create User entities for both inviter and invitee", () => {
    handleUserInvited(
      createUserInvitedEvent(
        Address.fromString(INVITER_ADDRESS),
        Address.fromString(INVITEE_ADDRESS),
      ),
    );

    assert.entityCount("User", 2);
    assert.fieldEquals(
      "User",
      INVITER_ADDRESS.toLowerCase(),
      "id",
      INVITER_ADDRESS.toLowerCase(),
    );
    assert.fieldEquals(
      "User",
      INVITEE_ADDRESS.toLowerCase(),
      "id",
      INVITEE_ADDRESS.toLowerCase(),
    );

    log.success("User entities created for both inviter and invitee", []);
  });

  test("Should overwrite invitedBy on a second invite to the same invitee", () => {
    const secondInviter = "0x1111111111111111111111111111111111111111";

    handleUserInvited(
      createUserInvitedEvent(
        Address.fromString(INVITER_ADDRESS),
        Address.fromString(INVITEE_ADDRESS),
        BigInt.fromI32(1),
      ),
    );

    handleUserInvited(
      createUserInvitedEvent(
        Address.fromString(secondInviter),
        Address.fromString(INVITEE_ADDRESS),
        BigInt.fromI32(2),
      ),
    );

    // Second event overwrites — mapping always sets invitedBy to latest inviter
    assert.fieldEquals(
      "User",
      INVITEE_ADDRESS.toLowerCase(),
      "invitedBy",
      secondInviter.toLowerCase(),
    );

    log.success("Second UserInvited overwrites invitedBy on invitee", []);
  });

  test("Should handle inviter and invitee being the same address", () => {
    handleUserInvited(
      createUserInvitedEvent(
        Address.fromString(INVITER_ADDRESS),
        Address.fromString(INVITER_ADDRESS),
      ),
    );

    assert.fieldEquals(
      "User",
      INVITER_ADDRESS.toLowerCase(),
      "invitedBy",
      INVITER_ADDRESS.toLowerCase(),
    );

    log.success("Self-invite handled without crash", []);
  });

  test("Should not affect inviter.invitedBy", () => {
    handleUserInvited(
      createUserInvitedEvent(
        Address.fromString(INVITER_ADDRESS),
        Address.fromString(INVITEE_ADDRESS),
      ),
    );

    const inviter = User.load(INVITER_ADDRESS.toLowerCase());
    assert.assertNotNull(inviter);
    assert.assertNull(inviter!.invitedBy);

    log.success("inviter.invitedBy is not modified by UserInvited", []);
  });
});
