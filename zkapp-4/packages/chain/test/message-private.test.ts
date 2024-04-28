import "reflect-metadata";
import { TestingAppChain } from "@proto-kit/sdk";
import { Bool, UInt64, PrivateKey, PublicKey, Field } from "o1js";
import { log } from "@proto-kit/common";
import {
  AgentID,
  Message,
  AgentDetails,
  MessageDetails,
  Messages,
  SecurityCode,
} from "../src/message";
import {
  AgentTxInfo,
  MessageBoxPrivate,
  ProcessMessageOutput,
  ProcessMessageProgram,
  ProcessMessageProof,
} from "../src/message-private";

describe("MessageBoxPrivate Tests", () => {
  let appChain: any;
  let agentPrivateKey: PrivateKey;
  let agentPublicKey: PublicKey;
  let messageBoxPrivate: MessageBoxPrivate;

  beforeAll(async () => {
    appChain = TestingAppChain.fromRuntime({
      MessageBoxPrivate,
    });

    appChain.configurePartial({
      Runtime: {
        MessageBoxPrivate: {},
        Balances: {},
      },
    });

    await appChain.start();

    agentPrivateKey = PrivateKey.random();
    agentPublicKey = agentPrivateKey.toPublicKey();

    appChain.setSigner(agentPrivateKey);

    messageBoxPrivate = appChain.runtime.resolve("MessageBoxPrivate");

  });

  it("should handle valid private messages correctly", async () => {
    const agentID = new AgentID(1);
    const securityCode = "AB"; // Simplified for the example
    const message = "Hello World!";

    const agentDetails = new AgentDetails({
      lastReceived: Field(0),
      message: Message.fromString(message),
      securityCode: SecurityCode.fromString(securityCode),
    });

    // Simulating adding the agent
    await appChain.transaction(agentPublicKey, () => {
      messageBoxPrivate.newAgent(
        agentID,
        SecurityCode.fromString(securityCode)
      );
    });

    const dummyProofData = { valid: true };

    const proof = new ProcessMessageProof({
      publicInput: agentDetails,
      publicOutput: new ProcessMessageOutput({
        messageNumber: new Field(1),
        agentID: agentID,
      }),
      proof: dummyProofData,
      maxProofsVerified: 1,
    });

    // Processing the message privately
    const tx = await appChain.transaction(agentPublicKey, () => {
      messageBoxPrivate.processMessagePrivately(proof);
    });

    await tx.sign();
    await tx.send();

    const block = await appChain.produceBlock();
    const updatedAgentDetails =
      await appChain.query.runtime.MessageBoxPrivate.mapAgent.get(agentID);

    // Validate the transaction was successful and the state was updated correctly
    expect(block?.transactions[0].status.toBoolean()).toBe(true);
    expect(updatedAgentDetails?.lastReceived.equals(Field(1))).toBe(true);
  });
});
