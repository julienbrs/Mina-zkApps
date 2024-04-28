import { Bool, Struct, Field, UInt64 } from 'o1js';
import { runtimeModule, runtimeMethod, state } from '@proto-kit/module';
import { assert, StateMap } from '@proto-kit/protocol';
import { PublicKey } from 'o1js';

import { Experimental, Provable } from 'o1js';
import {
  AgentID,
  Message,
  AgentDetails,
  MessageDetails,
  Messages,
} from './message';

// Extend Message with private handling
export class ProcessMessageOutput extends Struct({
  messageNumber: Field,
  agentID: AgentID,
}) {}

export const ProcessMessageProgram = Experimental.ZkProgram({
  publicInput: AgentDetails,
  publicOutput: ProcessMessageOutput,

  methods: {
    checkMessage: {
      privateInputs: [MessageDetails],
      method(agentDetails: AgentDetails, messageDetails: MessageDetails) {
        // Process message in a way that ensures the details are not exposed
        const validMessage: Bool = agentDetails.securityCode.areEquals(messageDetails.securityCode)
          .and(messageDetails.message.calculateLength().lessThanOrEqual(Field.from(12)));

        assert(validMessage, "Invalid or unauthorized message");
        return new ProcessMessageOutput({
          messageNumber: agentDetails.lastReceived.add(Field.from(1)),
          agentID: messageDetails.agentID,
        });
      },
    },
  },
});

export class ProcessMessageProof extends Experimental.ZkProgram.Proof(ProcessMessageProgram) {}

export class AgentTxInfo extends Struct({
  blockHeight: UInt64,
  msgSenderPubKey: PublicKey,
  msgTxNonce: UInt64,
}) {}

@runtimeModule()
export class MessageBoxPrivate extends Messages {
  @state() public agentTxInfo = StateMap.from<AgentID, AgentTxInfo>(AgentID, AgentTxInfo);

  public override updateMapAgent(agentID: AgentID, agentDetails: AgentDetails): void {
    const agentTxInfo = new AgentTxInfo({
      blockHeight: this.network.block.height,
      msgSenderPubKey: this.transaction.sender.value,
      msgTxNonce: this.transaction.nonce.value,
    });

    // Store additional transaction details
    this.agentTxInfo.set(agentID, agentTxInfo);
    super.updateMapAgent(agentID, agentDetails);
  }

  @runtimeMethod()
  public override addMessage(
    _: Field, // Message number is not directly handled here but through proofs
    messageDetails: MessageDetails
  ): void {
    assert(Bool(false), 'Shoudln\'t be called here');
  }

  @runtimeMethod()
  public processMessagePrivately(proof: ProcessMessageProof): void {
    const proofOutput: ProcessMessageOutput = proof.publicOutput;

    // Check for the agent existence
    const agent: AgentDetails = this.isAgentKnown(proofOutput.agentID);

    // Verify the zero-knowledge proof
    proof.verify();

    // Update the agent's last message number and details
    const newAgentDetails = new AgentDetails({
      lastReceived: proofOutput.messageNumber,
      message: agent.message, // keep the last message as is
      securityCode: agent.securityCode,
    });

    this.updateMapAgent(proofOutput.agentID, newAgentDetails);
  }
}
