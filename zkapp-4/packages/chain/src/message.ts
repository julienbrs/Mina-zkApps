import {
  runtimeModule,
  state,
  runtimeMethod,
  RuntimeModule,
} from "@proto-kit/module";
import { StateMap, assert } from "@proto-kit/protocol";
import {
  Bool,
  Character,
  Provable,
  PublicKey,
  Struct,
  Field,
  UInt64,
} from "o1js";

/// Constants
export const MAX_MESSAGE_LENGTH = 12;
export const SECURITY_CODE_LENGTH = 2;
export const DEFAULT_MESSAGE = "000000000000";

export const ERRORS = {
  AGENT_DOES_NOT_EXIST: "Agent does not exist",
  MESSAGE_NUMBER_NOT_GREATER:
    "Message number is not greater than last message number",
  SECURITY_CODE_MISMATCH: "Security Code does not match",
  INVALID_LENGTH_MESSAGE: "Message length exceeded",
  INVALID_LENGTH_SECURITY_CODE: "Security code length exceeded",
  PERMISSION_DENIED: "Sender is not the owner",
};

export class AgentID extends Field {}
export class SecurityCode extends Struct({
  code: Provable.Array(Character, SECURITY_CODE_LENGTH),
}) {
  public static fromString(s: string) {
    return new SecurityCode({
      code: Provable.Array(Character, SECURITY_CODE_LENGTH).fromFields(
        s.split("").map((c) => Character.fromString(c).toField())
      ),
    });
  }
  areEquals(x: SecurityCode): Bool {
    return this.code[0].equals(x.code[0]).and(this.code[1].equals(x.code[1]));
  }
  isValidLength() {
    assert(
      Bool(this.code.length === SECURITY_CODE_LENGTH),
      ERRORS.INVALID_LENGTH_SECURITY_CODE
    );
  }
}
export class Message extends Struct({
  message: Provable.Array(Character, MAX_MESSAGE_LENGTH),
}) {
  public static fromString(s: string) {
    assert(Bool(s.length <= MAX_MESSAGE_LENGTH), ERRORS.INVALID_LENGTH_MESSAGE);
    return new Message({
      message: Provable.Array(Character, s.length).fromFields(
        s.split("").map((c) => Character.fromString(c).toField())
      ),
    });
  }

  public calculateLength(): Field {
    return Field(this.message.length);
  }

}

export class MessageDetails extends Struct({
  agentID: AgentID,
  message: Message,
  securityCode: SecurityCode,
}) {
  public static from(
    agentID: AgentID,
    message: Message,
    securityCode: SecurityCode
  ) {
    return new MessageDetails({ agentID, message, securityCode });
  }
}

export class AgentDetails extends Struct({
  lastReceived: Field,
  message: Message,
  securityCode: SecurityCode,
}) {
  static create(
    lastReceived: Field,
    message: Message,
    securityCode: SecurityCode
  ) {
    return new AgentDetails({ lastReceived, message, securityCode });
  }
}

export class AgentTxInfo extends Struct({
  blockHeight: UInt64,
  msgSenderPubKey: PublicKey,
  msgTxNonce: UInt64,
}) {}

@runtimeModule()
export class Messages extends RuntimeModule<{ owner: PublicKey }> {
  @state() public mapAgent = StateMap.from<AgentID, AgentDetails>(
    AgentID,
    AgentDetails
  );
  @state() public agentTxInfo = StateMap.from<AgentID, AgentTxInfo>(
    AgentID,
    AgentTxInfo
  );

  // Internal function
  public updateMapAgent(agentID: AgentID, agentDetails: AgentDetails): void {
    this.mapAgent.set(
      agentID,
      agentDetails
    );
  }

  protected isAgentKnown(agentID: AgentID): AgentDetails {
    const { isSome, value } = this.mapAgent.get(agentID);
    assert(isSome, ERRORS.AGENT_DOES_NOT_EXIST);
    return value;
  }

  @runtimeMethod()
  public newAgent(agentID: AgentID, securityCode: SecurityCode): void {
    assert(
      this.transaction.sender.value.equals(this.config.owner),
      ERRORS.PERMISSION_DENIED
    );
    securityCode.isValidLength();
    const messageDetails = AgentDetails.create(
      Field(0),
      Message.fromString(DEFAULT_MESSAGE),
      securityCode
    );
    this.mapAgent.set(agentID, messageDetails);
    this.agentTxInfo.set(
      agentID,
      new AgentTxInfo({
        blockHeight: new UInt64(this.network.block.height),
        msgSenderPubKey: new PublicKey(this.transaction.sender),
        msgTxNonce: new UInt64(this.transaction.nonce),
      })
    );
  }

  @runtimeMethod()
  public addMessage(
    messageNumber: Field,
    { agentID, message, securityCode }: MessageDetails
  ): void {
    /// [VALIDATE]
    // Check if security code and message length are valid
    securityCode.isValidLength();
    const { isSome, value: agentData } = this.mapAgent.get(agentID);
    // Check if agent exists
    assert(isSome, ERRORS.AGENT_DOES_NOT_EXIST);

    // Check if message number is greater than last received
    assert(
      messageNumber.greaterThan(agentData.lastReceived),
      ERRORS.MESSAGE_NUMBER_NOT_GREATER
    );
    // Check if security code matches
    assert(
      securityCode.areEquals(agentData.securityCode),
      ERRORS.SECURITY_CODE_MISMATCH
    );
    /// [UPDATE] the agent state
    this.updateMapAgent(
      agentID,
      AgentDetails.create(
        messageNumber,
        message,
        agentData.securityCode
      )
    );

    this.agentTxInfo.set(
      agentID,
      new AgentTxInfo({
        blockHeight: new UInt64(this.network.block.height),
        msgSenderPubKey: new PublicKey(this.transaction.sender),
        msgTxNonce: new UInt64(this.transaction.nonce),
      })
    );
  }
}
