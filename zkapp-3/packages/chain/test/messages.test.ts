import { Character, PrivateKey, Provable, PublicKey, Field } from "o1js";
import {
  AgentID,
  Message,
  MessageDetails,
  Messages,
  SecurityCode,
  ERRORS,
} from "../src/messages";
import { TestingAppChain } from "@proto-kit/sdk";
import { Balances } from "@proto-kit/library";

let appChain: any;
let spyMasterPrivateKey: PrivateKey;
let spyMaster: PublicKey;

describe("messages", () => {
  beforeAll(async () => {
    appChain = TestingAppChain.fromRuntime({
      Balances,
      Messages,
    });
    spyMasterPrivateKey = PrivateKey.random();
    spyMaster = spyMasterPrivateKey.toPublicKey();
    appChain.configurePartial({
      Runtime: {
        Balances: {},
        Messages: {
          owner: spyMaster,
        },
      },
    });
    await appChain.start();
    appChain.setSigner(spyMasterPrivateKey);
  }, 1_000_000);

  it("should create a new agent", async () => {
    const messages = appChain.runtime.resolve("Messages");

    const agentID = AgentID.from(42);
    const securityCode = SecurityCode.fromString("07");

    const tx = await appChain.transaction(spyMaster, () => {
      messages.newAgent(agentID, securityCode);
    });

    await tx.sign();
    await tx.send();
    let _ = await appChain.produceBlock();

    // Fetch created agent
    const agentData = await appChain.query.runtime.Messages.mapAgent.get(
      AgentID.from(42)
    );
    expect(agentData).toBeDefined();
    expect(agentData?.securityCode).toStrictEqual(securityCode);

    // Fetch undefined agent
    const agentData2 = await appChain.query.runtime.Messages.mapAgent.get(
      AgentID.from(0)
    );
    expect(agentData2).toBeUndefined();
  });

  it("should revert if agent does not exist", async () => {
    const messages = appChain.runtime.resolve("Messages");

    const agentID = AgentID.from(99);
    const securityCode = SecurityCode.fromString("07");

    const message = Message.fromString("validmessage");
    const messageDetails = MessageDetails.from(agentID, message, securityCode);
    const messageNumber = Field(1);

    const tx = await appChain.transaction(spyMaster, () => {
      messages.addMessage(messageNumber, messageDetails);
    });
    await tx.sign();
    await tx.send();

    const block = await appChain.produceBlock();
    expect(block?.transactions[0].status.toBoolean()).toBe(false);
    expect(block?.transactions[0].statusMessage).toBe(
      ERRORS.AGENT_DOES_NOT_EXIST
    );
  });

  it("should revert if invalid security code", async () => {
    const messages = appChain.runtime.resolve("Messages");

    const agentID = AgentID.from(42);
    const securityCode = SecurityCode.fromString("07");
    const wrongSecurityCode = SecurityCode.fromString("08");

    let tx = await appChain.transaction(spyMaster, () => {
      messages.newAgent(agentID, securityCode);
    });
    await tx.sign();
    await tx.send();
    await appChain.produceBlock();

    const message = Message.fromString("validmessage");
    const messageDetails = MessageDetails.from(
      agentID,
      message,
      wrongSecurityCode
    );
    const messageNumber = Field(1);

    tx = await appChain.transaction(spyMaster, () => {
      messages.addMessage(messageNumber, messageDetails);
    });
    await tx.sign();
    await tx.send();

    const block = await appChain.produceBlock();
    expect(block?.transactions[0].status.toBoolean()).toBe(false);
    expect(block?.transactions[0].statusMessage).toBe(
      ERRORS.SECURITY_CODE_MISMATCH
    );
  });

  it("should revert if invalid security code length", async () => {
    const messages = appChain.runtime.resolve("Messages");

    const agentID = AgentID.from(42);
    const securityCode = new SecurityCode({
      code: Provable.Array(Character, 1).fromFields(
        "0".split("").map((c) => Character.fromString(c).toField())
      ),
    });

    let tx = await appChain.transaction(spyMaster, () => {
      messages.newAgent(agentID, securityCode);
    });

    await tx.sign();
    await tx.send();
    const block = await appChain.produceBlock();

    expect(block?.transactions[0].status.toBoolean()).toBe(false);
    expect(block?.transactions[0].statusMessage).toBe(
        ERRORS.INVALID_LENGTH_SECURITY_CODE
      );
  });

  it("should revert is message number is not greater than stored message number", async () => {
    const messages = appChain.runtime.resolve("Messages");

    const agentID = AgentID.from(42);
    const securityCode = SecurityCode.fromString("07");

    let tx = await appChain.transaction(spyMaster, () => {
      messages.newAgent(agentID, securityCode);
    });
    await tx.sign();
    await tx.send();
    await appChain.produceBlock();

    const message = Message.fromString("validmessage");
    const messageDetails = MessageDetails.from(agentID, message, securityCode);
    const messageNumber = Field(1);
    const messageNumber2 = Field(0);

    tx = await appChain.transaction(spyMaster, () => {
      messages.addMessage(messageNumber, messageDetails);
    });
    await tx.sign();
    await tx.send();
    await appChain.produceBlock();

    tx = await appChain.transaction(spyMaster, () => {
      messages.addMessage(messageNumber2, messageDetails);
    });
    await tx.sign();
    await tx.send();
    const block = await appChain.produceBlock();

    expect(block?.transactions[0].status.toBoolean()).toBe(false);
    expect(block?.transactions[0].statusMessage).toBe(
        ERRORS.MESSAGE_NUMBER_NOT_GREATER
      );
  });

  it("should should update the state", async () => {
    const messages = appChain.runtime.resolve("Messages");

    const agentID = AgentID.from(42);
    const securityCode = SecurityCode.fromString("07");

    let tx = await appChain.transaction(spyMaster, () => {
      messages.newAgent(agentID, securityCode);
    });
    await tx.sign();
    await tx.send();
    await appChain.produceBlock();

    const message = Message.fromString("validmessage");
    const messageDetails = MessageDetails.from(agentID, message, securityCode);
    const messageNumber = Field(1);

    tx = await appChain.transaction(spyMaster, () => {
      messages.addMessage(messageNumber, messageDetails);
    });
    await tx.sign();
    await tx.send();

    await appChain.produceBlock();

    const agentData = await appChain.query.runtime.Messages.mapAgent.get(
      AgentID.from(agentID)
    );
    expect(agentData).toBeDefined();
    expect(agentData?.message).toStrictEqual(message);
  }, 1_000_000);
});
