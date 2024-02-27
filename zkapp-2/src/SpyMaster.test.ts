import {
  SpyMaster,
  Message,
  validateMessage,
  MAX_BATCH_SIZE,
} from './SpyMaster';
import {
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  Poseidon,
  Gadgets,
} from 'o1js';

let proofsEnabled = false;

// Highest number in list is equal to amount of messages
function generateValidMessages(amount: number): Message[] {
  const messages: Message[] = [];

  for (let i = 1; i <= amount; i++) {
    const agentId = i % 3001;
    const xLocation = (i * 2) % 15001;
    const yLocation = ((i * 3) % 15001) + 5000;
    const checkSum = agentId + xLocation + yLocation;

    messages.push({
      number: Field(i),
      agentID: Field(agentId),
      agentXLocation: Field(xLocation),
      agentYLocation: Field(yLocation),
      checkSum: Field(checkSum),
    });
  }

  return messages;
}

describe('unit tests', () => {
  let deployerAccount: PublicKey,
    deployerKey: PrivateKey,
    zkAppAddress: PublicKey,
    zkAppPrivateKey: PrivateKey,
    zkApp: SpyMaster;

  beforeAll(async () => {
    if (proofsEnabled) await SpyMaster.compile();
  });

  beforeEach(() => {
    const Local = Mina.LocalBlockchain({ proofsEnabled });
    Mina.setActiveInstance(Local);
    ({ privateKey: deployerKey, publicKey: deployerAccount } =
      Local.testAccounts[0]);
    zkAppPrivateKey = PrivateKey.random();
    zkAppAddress = zkAppPrivateKey.toPublicKey();
    zkApp = new SpyMaster(zkAppAddress);
  });

  async function localDeploy() {
    const txn = await Mina.transaction(deployerAccount, () => {
      AccountUpdate.fundNewAccount(deployerAccount);
      zkApp.deploy();
    });
    await txn.prove();
    // this tx needs .sign(), because `deploy()` adds an account update that requires signature authorization
    await txn.sign([deployerKey, zkAppPrivateKey]).send();
  }

  describe('validateMessage function', () => {
    it('should return true for a message with agentID 0', () => {
      const message = new Message({
        number: Field(1),
        agentID: Field(0), // agentID is 0, should be valid
        agentXLocation: Field(1000),
        agentYLocation: Field(6000),
        checkSum: Field(7000),
      });

      expect(validateMessage(message).toBoolean()).toBe(true);
    });

    it('should return true for a message with a correct checksum', () => {
      const agentId = 1;
      const xLocation = 2000;
      const yLocation = 7000;
      const checkSum = agentId + xLocation + yLocation;
      const message = new Message({
        number: Field(2),
        agentID: Field(agentId),
        agentXLocation: Field(xLocation),
        agentYLocation: Field(yLocation),
        checkSum: Field(checkSum),
      });

      expect(validateMessage(message).toBoolean()).toBe(true);
    });

    it('should return false for a message with an incorrect checksum', () => {
      const message = new Message({
        number: Field(3),
        agentID: Field(1),
        agentXLocation: Field(2000),
        agentYLocation: Field(7000),
        checkSum: Field(9999), // Incorrect checksum
      });

      expect(validateMessage(message).toBoolean()).toBe(false);
    });

    it('should return false for a message with agentID out of valid range', () => {
      const message = new Message({
        number: Field(4),
        agentID: Field(3001), // out of valid range
        agentXLocation: Field(1000),
        agentYLocation: Field(6000),
        checkSum: Field(10001),
      });

      expect(validateMessage(message).toBoolean()).toBe(false);
    });

    it('should return false for a message with agentXLocation out of valid range', () => {
      const message = new Message({
        number: Field(5),
        agentID: Field(1),
        agentXLocation: Field(15001), // out of valid range
        agentYLocation: Field(6000),
        checkSum: Field(21002),
      });

      expect(validateMessage(message).toBoolean()).toBe(false);
    });

    it('should return false for a message with agentYLocation out of valid range', () => {
      const message = new Message({
        number: Field(6),
        agentID: Field(1),
        agentXLocation: Field(1000),
        agentYLocation: Field(20001), // out of valid range
        checkSum: Field(21002),
      });

      expect(validateMessage(message).toBoolean()).toBe(false);
    });

    it('should return false for a message where agentYLocation is not greater than agentXLocation', () => {
      const message = new Message({
        number: Field(7),
        agentID: Field(1),
        agentXLocation: Field(7000),
        agentYLocation: Field(7000), // Not greater than agentXLocation
        checkSum: Field(14001),
      });

      expect(validateMessage(message).toBoolean()).toBe(false);
    });
  });

  describe('addMessageToBatch', () => {
    it('emit dispatched event for each valid message added', async () => {
      await localDeploy();
      const messages = generateValidMessages(5);

      let actionState = await zkApp.actionState.getAndRequireEquals();
      const actionBefore = await zkApp.reducer.getActions({
        fromActionState: actionState,
      });
      expect(actionBefore.length).toBe(0);

      for (const message of messages) {
        const txn = await Mina.transaction(zkAppAddress, () => {
          zkApp.addMessageToBatch(message);
        });
        await txn.prove();
        await txn.sign([deployerKey, zkAppPrivateKey]).send();

        const eventsFetched = await zkApp.fetchEvents();
        expect(eventsFetched.length).toBeGreaterThan(0);
        const lastEvent = eventsFetched[eventsFetched.length - 1];
        expect(lastEvent.type).toEqual('dispatched');
        expect(lastEvent.event.data).toEqual(message.number);
      }

      actionState = await zkApp.actionState.getAndRequireEquals();
      const actionAfter = await zkApp.reducer.getActions({
        fromActionState: actionState,
      });
      expect(actionAfter.length).toBe(5);
    });

    it('emit dispatched event for invalid message', async () => {
      await localDeploy();
      const invalidMessage = new Message({
        number: Field(3),
        agentID: Field(1),
        agentXLocation: Field(2000),
        agentYLocation: Field(7000),
        checkSum: Field(9999), // Incorrect checksum
      });

      const txn = await Mina.transaction(zkAppAddress, () => {
        zkApp.addMessageToBatch(invalidMessage);
      });
      await txn.prove();
      await txn.sign([deployerKey, zkAppPrivateKey]).send();

      const eventsFetched = await zkApp.fetchEvents();
      expect(eventsFetched.length).toBe(1);
    });
  });

  describe('processBatch', () => {
    it('updates highestNumber correctly after processing a batch of messages and emits processed event', async () => {
      await localDeploy();

      const messages = generateValidMessages(10);
      for (const message of messages) {
        const txn = await Mina.transaction(zkAppAddress, () => {
          zkApp.addMessageToBatch(message);
        });
        await txn.prove();
        await txn.sign([deployerKey, zkAppPrivateKey]).send();
      }

      const processTxn = await Mina.transaction(zkAppAddress, () => {
        zkApp.processBatch();
      });
      await processTxn.prove();
      await processTxn.sign([deployerKey, zkAppPrivateKey]).send();

      const highestNumber = await zkApp.highestNumber.get();
      expect(highestNumber).toEqual(Field(10));

      /* Events validation */
      const eventsFetched = await zkApp.fetchEvents();
      expect(eventsFetched.some((event) => event.type === 'processed')).toBe(
        true
      );
      const processedEvent = eventsFetched.find(
        (event) => event.type === 'processed'
      );
      expect(processedEvent).toBeDefined();
      expect(processedEvent!.event.data).toEqual(Field(10)); // eslint-disable-line
    });

    it('should not process any messages if there are no messages in the batch', async () => {
      await localDeploy();
      const processTxn = await Mina.transaction(zkAppAddress, () => {
        zkApp.processBatch();
      });
      await processTxn.prove();
      await processTxn.sign([deployerKey, zkAppPrivateKey]).send();

      const highestNumber = await zkApp.highestNumber.get();
      expect(highestNumber).toEqual(Field(0));
    });

    it('should not process more than 50 messages in a single batch', async () => {
      await localDeploy();

      const messages = generateValidMessages(MAX_BATCH_SIZE + 1);
      for (const message of messages) {
        const txn = await Mina.transaction(zkAppAddress, () => {
          zkApp.addMessageToBatch(message);
        });
        await txn.prove();
        await txn.sign([deployerKey, zkAppPrivateKey]).send();
      }

      expect(
        Mina.transaction(zkAppAddress, () => {
          zkApp.processBatch();
        })
      ).rejects.toThrowError(
        `reducer.reduce: Exceeded the maximum number of lists of actions, ${MAX_BATCH_SIZE}.\nUse the optional \`maxTransactionsWithActions\` argument to increase this number.`
      );

      const highestNumber = await zkApp.highestNumber.get();
      expect(highestNumber).toEqual(Field(0));
    });

    it('a duplicate message with invalid agentID should still be processed', async () => {
      await localDeploy();

      const message = new Message({
        number: Field(1),
        agentID: Field(1),
        agentXLocation: Field(1000),
        agentYLocation: Field(6000),
        checkSum: Field(7001),
      });

      const duplicateMessage = new Message({
        number: Field(1),
        agentID: Field(3001), // out of valid range
        agentXLocation: Field(1000),
        agentYLocation: Field(6000),
        checkSum: Field(7001),
      });

      let messages = [message, duplicateMessage];
      messages = messages.concat(generateValidMessages(4));

      for (const message of messages) {
        const txn = await Mina.transaction(zkAppAddress, () => {
          zkApp.addMessageToBatch(message);
        });
        await txn.prove();
        await txn.sign([deployerKey, zkAppPrivateKey]).send();
      }

      const processTxn = await Mina.transaction(zkAppAddress, () => {
        zkApp.processBatch();
      });
      await processTxn.prove();
      await processTxn.sign([deployerKey, zkAppPrivateKey]).send();

      const highestNumber = await zkApp.highestNumber.get();
      expect(highestNumber).toEqual(Field(4));
    });

    it('should work after multiple processBatch calls', async () => {
      await localDeploy();

      const messages = generateValidMessages(10);
      for (const message of messages) {
        const txn = await Mina.transaction(zkAppAddress, () => {
          zkApp.addMessageToBatch(message);
        });
        await txn.prove();
        await txn.sign([deployerKey, zkAppPrivateKey]).send();
      }

      let processTxn = await Mina.transaction(zkAppAddress, () => {
        zkApp.processBatch();
      });
      await processTxn.prove();
      await processTxn.sign([deployerKey, zkAppPrivateKey]).send();

      let highestNumber = await zkApp.highestNumber.get();
      expect(highestNumber).toEqual(Field(10));

      let newMessages = generateValidMessages(15).slice(10);
      for (const message of newMessages) {
        const txn = await Mina.transaction(zkAppAddress, () => {
          zkApp.addMessageToBatch(message);
        });
        await txn.prove();
        await txn.sign([deployerKey, zkAppPrivateKey]).send();
      }

      processTxn = await Mina.transaction(zkAppAddress, () => {
        zkApp.processBatch();
      });
      await processTxn.prove();
      await processTxn.sign([deployerKey, zkAppPrivateKey]).send();

      highestNumber = await zkApp.highestNumber.get();
      expect(highestNumber).toEqual(Field(15));
    });

    it("should process batch of messages with last one being invalid", async () => {
      await localDeploy();

      const messages = generateValidMessages(5);
      for (const message of messages) {
        const txn = await Mina.transaction(zkAppAddress, () => {
          zkApp.addMessageToBatch(message);
        });
        await txn.prove();
        await txn.sign([deployerKey, zkAppPrivateKey]).send();
      }

      const invalidMessage = new Message({
        number: Field(6),
        agentID: Field(3001), // out of valid range
        agentXLocation: Field(1000),
        agentYLocation: Field(6000),
        checkSum: Field(7001),
      });

      const txn = await Mina.transaction(zkAppAddress, () => {
        zkApp.addMessageToBatch(invalidMessage);
      });
      await txn.prove();
      await txn.sign([deployerKey, zkAppPrivateKey]).send();

      const processTxn = await Mina.transaction(zkAppAddress, () => {
        zkApp.processBatch();
      });
      await processTxn.prove();
      await processTxn.sign([deployerKey, zkAppPrivateKey]).send();

      const highestNumber = await zkApp.highestNumber.get();
      expect(highestNumber).toEqual(Field(5));  // Last message is invalid, so highestNumber should be 5
    });
  });
});
