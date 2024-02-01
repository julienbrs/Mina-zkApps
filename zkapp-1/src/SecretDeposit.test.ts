import {
  SecretDeposit,
  MyMerkleWitness,
  messagesHeight,
  nullifierMsg,
  maxAddressesCount,
} from './SecretDeposit';
import {
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  Poseidon,
  MerkleMap,
  MerkleTree,
  Nullifier,
  Gadgets,
} from 'o1js';

let proofsEnabled = false;

const initTrees = (): {
  addressesMap: MerkleMap;
  nullifierMap: MerkleMap;
  secretMessagesTree: MerkleTree;
} => ({
  addressesMap: new MerkleMap(),
  nullifierMap: new MerkleMap(),
  secretMessagesTree: new MerkleTree(messagesHeight),
});

const getRandomValidMessage = (): Field => {
  // Take a random private key, hash it to get random bytes, shift it and add valid flags
  const randomField = Poseidon.hash(PrivateKey.random().toFields());
  const msg = Gadgets.and(randomField, Field(0b100000), 254);
  return msg;
};

describe('SecretDeposit', () => {
  let deployerAccount: PublicKey,
    deployerKey: PrivateKey,
    zkAppAddress: PublicKey,
    zkAppPrivateKey: PrivateKey,
    zkApp: SecretDeposit,
    accounts: {
      publicKey: PublicKey;
      privateKey: PrivateKey;
    }[],
    lastAccountIndex: number;

  beforeAll(async () => {
    if (proofsEnabled) await SecretDeposit.compile();
  });

  beforeEach(() => {
    const Local = Mina.LocalBlockchain({ proofsEnabled });
    Mina.setActiveInstance(Local);
    ({ privateKey: deployerKey, publicKey: deployerAccount } =
      Local.testAccounts[0]);
    zkAppPrivateKey = PrivateKey.random();
    zkAppAddress = zkAppPrivateKey.toPublicKey();
    zkApp = new SecretDeposit(zkAppAddress);
    accounts = Local.testAccounts;
    lastAccountIndex = 0;
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

  const generateAccount = async (): Promise<{
    privateKey: PrivateKey;
    publicKey: PublicKey;
    key: Field;
  }> => {
    lastAccountIndex++;
    if (lastAccountIndex > 10) {
      throw new Error('Too many accounts');
    }
    const acc = accounts[lastAccountIndex];
    return {
      privateKey: acc.privateKey,
      publicKey: acc.publicKey,
      key: Poseidon.hash(acc.publicKey.toFields()),
    };
  };

  const addAccount = async (
    account: {
      privateKey: PrivateKey;
      publicKey: PublicKey;
      key: Field;
    },
    addressesMap: MerkleMap
  ) => {
    const emptyWitness = addressesMap.getWitness(account.key);
    const txn = await Mina.transaction(deployerAccount, () => {
      zkApp.addAddress(emptyWitness);
    });
    await txn.prove();
    await txn.sign([deployerKey]).send();
    addressesMap.set(account.key, Field(1));
  };

  const depositMessage = async (
    account: {
      privateKey: PrivateKey;
      publicKey: PublicKey;
      key: Field;
    },
    addressesMap: MerkleMap,
    nullifierMap: MerkleMap,
    secretMessagesTree: MerkleTree,
    sender: {
      privateKey: PrivateKey;
      publicKey: PublicKey;
      key: Field;
    },
    message: Field
  ) => {
    const addressAllowedWitness = addressesMap.getWitness(account.key);
    const nullifier = Nullifier.fromJSON(
      Nullifier.createTestNullifier(nullifierMsg, account.privateKey)
    );
    const nullifierEmptyWitness = nullifierMap.getWitness(nullifier.key());
    const nextEmptyIndex = zkApp.secretMessagesCount.get();
    const messageEmptyWitness = new MyMerkleWitness(
      secretMessagesTree.getWitness(nextEmptyIndex.toBigInt())
    );

    // deposit transaction
    const txn = await Mina.transaction(sender.publicKey, () => {
      zkApp.depositMessage(
        nullifier,
        nullifierEmptyWitness,
        addressAllowedWitness,
        message,
        messageEmptyWitness
      );
    });
    await txn.prove();
    await txn.sign([sender.privateKey]).send();

    secretMessagesTree.setLeaf(nextEmptyIndex.toBigInt(), message);
    nullifierMap.set(nullifier.key(), Field(1));
  };

  it('deploy', async () => {
    const { addressesMap, nullifierMap, secretMessagesTree } = initTrees();
    await localDeploy();
    // Verify initial states
    expect(zkApp.addressCount.get()).toEqual(Field(0));
    expect(zkApp.secretMessagesCount.get()).toEqual(Field(0));
    expect(zkApp.adminPublicKey.get()).toEqual(deployerAccount);
    // Verify initial trees roots
    expect(zkApp.addressesRoot.get()).toEqual(addressesMap.getRoot());
    expect(zkApp.nullifierRoot.get()).toEqual(nullifierMap.getRoot());
    expect(zkApp.secretMessagesRoot.get()).toEqual(
      secretMessagesTree.getRoot()
    );

    // MerkleTree height just enough for `maxAddressesCount` deposits
    expect(secretMessagesTree.leafCount).toBeGreaterThanOrEqual(
      maxAddressesCount
    );
    expect(secretMessagesTree.leafCount).toBeLessThan(2 * maxAddressesCount);
  });

  it('addAddress: add new address successfully', async () => {
    await localDeploy();
    const account = await generateAccount();
    const { addressesMap } = initTrees();

    // Get empty witness for the account
    const emptyWitness = addressesMap.getWitness(account.key);
    expect(emptyWitness.computeRootAndKey(Field(0))[0]).toEqual(
      addressesMap.getRoot()
    );
    expect(emptyWitness.computeRootAndKey(Field(0))[1]).toEqual(account.key);
    const addressCount = zkApp.addressCount.get();
    expect(addressCount).toEqual(Field(0));

    // add transaction
    const txn = await Mina.transaction(deployerAccount, () => {
      zkApp.addAddress(emptyWitness);
    });
    await txn.prove();
    await txn.sign([deployerKey]).send();

    addressesMap.set(account.key, Field(1));
    expect(addressesMap.getRoot()).toEqual(zkApp.addressesRoot.get());
    expect(zkApp.addressCount.get()).toEqual(addressCount.add(Field(1)));
  });

  it('addAddress: add new address but not admin fail', async () => {
    await localDeploy();
    const sender = await generateAccount();
    const account = await generateAccount();
    const { addressesMap } = initTrees();
    const emptyWitness = addressesMap.getWitness(account.key);

    expect(deployerAccount).not.toEqual(sender.publicKey);
    expect(async () => {
      const txn = await Mina.transaction(sender.publicKey, () => {
        zkApp.addAddress(emptyWitness);
      });
      await txn.prove();
      await txn.sign([sender.privateKey]).send();
    }).rejects.toThrow();

    expect(addressesMap.get(account.key)).toEqual(Field(0));
    expect(addressesMap.getRoot()).toEqual(zkApp.addressesRoot.get());
    expect(zkApp.addressCount.get()).toEqual(Field(0));
  });

  it('addAddress: add already allowed address fail', async () => {
    await localDeploy();
    const account = await generateAccount();
    const { addressesMap } = initTrees();
    // Add account to the tree
    await addAccount(account, addressesMap);
    const addressCount = zkApp.addressCount.get();

    // Try to add again should fail
    const notEmptyWitness = addressesMap.getWitness(account.key);
    expect(async () => {
      const txn = await Mina.transaction(deployerAccount, () => {
        zkApp.addAddress(notEmptyWitness);
      });
      await txn.prove();
      await txn.sign([deployerKey]).send();
    }).rejects.toThrow();
    expect(addressesMap.get(account.key)).toEqual(addressCount);
  });

  it('depositMessage: deposit message successfully', async () => {
    await localDeploy();
    const { addressesMap, nullifierMap, secretMessagesTree } = initTrees();
    const account = await generateAccount();
    await addAccount(account, addressesMap);

    // Get allowed witness for the account
    const addressAllowedWitness = addressesMap.getWitness(account.key);

    // Generate nullifier for the account
    const nullifier = Nullifier.fromJSON(
      Nullifier.createTestNullifier(nullifierMsg, account.privateKey)
    );
    // Get empty witness for the nullifier
    expect(nullifierMap.get(nullifier.key())).toEqual(Field(0));
    const nullifierEmptyWitness = nullifierMap.getWitness(nullifier.key());

    // Get empty witness for the message
    const nextEmptyIndex = zkApp.secretMessagesCount.get();
    expect(secretMessagesTree.validate(nextEmptyIndex.toBigInt())).toEqual(
      true
    );
    const messageEmptyWitness = new MyMerkleWitness(
      secretMessagesTree.getWitness(nextEmptyIndex.toBigInt())
    );
    expect(messageEmptyWitness.calculateIndex()).toEqual(nextEmptyIndex);
    expect(messageEmptyWitness.calculateRoot(Field(0))).toEqual(
      secretMessagesTree.getRoot()
    );

    const message = getRandomValidMessage();

    // deposit transaction
    const txn = await Mina.transaction(account.publicKey, () => {
      zkApp.depositMessage(
        nullifier,
        nullifierEmptyWitness,
        addressAllowedWitness,
        message,
        messageEmptyWitness
      );
    });
    await txn.prove();
    await txn.sign([account.privateKey]).send();

    // Update secretMessagesTree
    secretMessagesTree.setLeaf(nextEmptyIndex.toBigInt(), message);
    expect(zkApp.secretMessagesCount.get()).toEqual(
      nextEmptyIndex.add(Field(1))
    );
    expect(secretMessagesTree.getRoot()).toEqual(
      zkApp.secretMessagesRoot.get()
    );

    // update nullifierMap
    nullifierMap.set(nullifier.key(), Field(1));
    expect(nullifierMap.getRoot()).toEqual(
      nullifier.setUsed(nullifierEmptyWitness)
    );
    expect(zkApp.nullifierRoot.get()).toEqual(nullifierMap.getRoot());
  });

  it('depositMessage: deposit message as third party successfully', async () => {
    await localDeploy();
    const { addressesMap, nullifierMap, secretMessagesTree } = initTrees();
    const account = await generateAccount();
    const thirdParty = await generateAccount();
    expect(account.key).not.toEqual(thirdParty.key);

    // Only account is allowed
    await addAccount(account, addressesMap);
    // But third party can send the deposit tx with account's nullifier
    await depositMessage(
      account,
      addressesMap,
      nullifierMap,
      secretMessagesTree,
      thirdParty,
      getRandomValidMessage()
    );

    expect(zkApp.nullifierRoot.get()).toEqual(nullifierMap.getRoot());
    expect(zkApp.secretMessagesRoot.get()).toEqual(
      secretMessagesTree.getRoot()
    );
  });

  it('depositMessage: deposit message not allowed address fail', async () => {
    await localDeploy();
    const { addressesMap, nullifierMap, secretMessagesTree } = initTrees();
    const account = await generateAccount();
    // Account not allowed -> // await addAccount(account, addressesMap);

    expect(async () => {
      await depositMessage(
        account,
        addressesMap,
        nullifierMap,
        secretMessagesTree,
        account,
        getRandomValidMessage()
      );
    }).rejects.toThrow();
  });

  it('depositMessage: deposit twice fail', async () => {
    await localDeploy();
    const { addressesMap, nullifierMap, secretMessagesTree } = initTrees();
    const account = await generateAccount();
    await addAccount(account, addressesMap);

    await depositMessage(
      account,
      addressesMap,
      nullifierMap,
      secretMessagesTree,
      account,
      getRandomValidMessage()
    );

    // Try to deposit again should fail
    expect(async () => {
      await depositMessage(
        account,
        addressesMap,
        nullifierMap,
        secretMessagesTree,
        account,
        getRandomValidMessage()
      );
    }).rejects.toThrow();
  });

  it('depositMessage: deposit twice specific cases (same nullifier, tree index, ...)', async () => {
    await localDeploy();
    const { addressesMap, nullifierMap, secretMessagesTree } = initTrees();
    const account = await generateAccount();
    await addAccount(account, addressesMap);

    // first deposit
    const addressAllowedWitness = addressesMap.getWitness(account.key);
    const nullifier = Nullifier.fromJSON(
      Nullifier.createTestNullifier(nullifierMsg, account.privateKey)
    );
    const nullifierEmptyWitness = nullifierMap.getWitness(nullifier.key());
    const nextEmptyIndex = zkApp.secretMessagesCount.get();
    const messageEmptyWitness = new MyMerkleWitness(
      secretMessagesTree.getWitness(nextEmptyIndex.toBigInt())
    );
    const message = getRandomValidMessage();
    const txn = await Mina.transaction(account.publicKey, () => {
      zkApp.depositMessage(
        nullifier,
        nullifierEmptyWitness,
        addressAllowedWitness,
        message,
        messageEmptyWitness
      );
    });
    await txn.prove();
    await txn.sign([account.privateKey]).send();
    secretMessagesTree.setLeaf(nextEmptyIndex.toBigInt(), message);
    nullifierMap.set(nullifier.key(), Field(1));

    // try to deposit again

    // with same nullifier
    expect(async () => {
      // const nullifier = Nullifier.fromJSON(
      //   Nullifier.createTestNullifier(nullifierMsg, account.privateKey)
      // );
      const nullifierEmptyWitness = nullifierMap.getWitness(nullifier.key());
      const nextEmptyIndex = zkApp.secretMessagesCount.get();
      const messageEmptyWitness = new MyMerkleWitness(
        secretMessagesTree.getWitness(nextEmptyIndex.toBigInt())
      );
      zkApp.depositMessage(
        nullifier,
        nullifierEmptyWitness,
        addressAllowedWitness,
        message,
        messageEmptyWitness
      );
    }).rejects.toThrow();

    // with same nullifier witness
    expect(async () => {
      const nullifier = Nullifier.fromJSON(
        Nullifier.createTestNullifier(nullifierMsg, account.privateKey)
      );
      // const nullifierEmptyWitness = nullifierMap.getWitness(nullifier.key());
      const nextEmptyIndex = zkApp.secretMessagesCount.get();
      const messageEmptyWitness = new MyMerkleWitness(
        secretMessagesTree.getWitness(nextEmptyIndex.toBigInt())
      );
      zkApp.depositMessage(
        nullifier,
        nullifierEmptyWitness,
        addressAllowedWitness,
        message,
        messageEmptyWitness
      );
    }).rejects.toThrow();

    // with same tree index
    expect(async () => {
      const nullifier = Nullifier.fromJSON(
        Nullifier.createTestNullifier(nullifierMsg, account.privateKey)
      );
      const nullifierEmptyWitness = nullifierMap.getWitness(nullifier.key());
      // const nextEmptyIndex = zkApp.secretMessagesCount.get();
      const messageEmptyWitness = new MyMerkleWitness(
        secretMessagesTree.getWitness(nextEmptyIndex.toBigInt())
      );
      zkApp.depositMessage(
        nullifier,
        nullifierEmptyWitness,
        addressAllowedWitness,
        message,
        messageEmptyWitness
      );
    }).rejects.toThrow();

    // with same messages witness
    expect(async () => {
      const nullifier = Nullifier.fromJSON(
        Nullifier.createTestNullifier(nullifierMsg, account.privateKey)
      );
      const nullifierEmptyWitness = nullifierMap.getWitness(nullifier.key());
      zkApp.depositMessage(
        nullifier,
        nullifierEmptyWitness,
        addressAllowedWitness,
        message,
        messageEmptyWitness
      );
    }).rejects.toThrow();
  });

  it('depositMessage: message flag validation condition 1', async () => {
    await localDeploy();
    const { addressesMap, nullifierMap, secretMessagesTree } = initTrees();
    const account = await generateAccount();
    await addAccount(account, addressesMap);

    // Flag 1 is true => all other flags must be false
    await depositMessage(
      account,
      addressesMap,
      nullifierMap,
      secretMessagesTree,
      account,
      Field(0b100000)
    );

    // Should fail if we put another flag to true
    // expect(async () => {
    //   const account = await generateAccount();
    //   await addAccount(account, addressesMap);
    //   await depositMessage(
    //     account,
    //     addressesMap,
    //     nullifierMap,
    //     secretMessagesTree,
    //     account,
    //     Field(0b100001)
    //   );
    // }).rejects.toThrow();
  });

  it('depositMessage: message flag validation condition 2', async () => {
    await localDeploy();
    const { addressesMap, nullifierMap, secretMessagesTree } = initTrees();
    const account = await generateAccount();
    await addAccount(account, addressesMap);

    // Flag 2 is true => Flag 3 true
    await depositMessage(
      account,
      addressesMap,
      nullifierMap,
      secretMessagesTree,
      account,
      Field(0b011000)
    );

    // Should fail if we put flag 2 true and flag 3 false
    expect(async () => {
      const account = await generateAccount();
      await addAccount(account, addressesMap);
      await depositMessage(
        account,
        addressesMap,
        nullifierMap,
        secretMessagesTree,
        account,
        Field(0b010000)
      );
    }).rejects.toThrow();
  });

  it('depositMessage: message flag validation condition 3', async () => {
    await localDeploy();
    const { addressesMap, nullifierMap, secretMessagesTree } = initTrees();
    const account = await generateAccount();
    await addAccount(account, addressesMap);

    // Flag 4 is true => Flag 5 and 6 false
    await depositMessage(
      account,
      addressesMap,
      nullifierMap,
      secretMessagesTree,
      account,
      Field(0b000100)
    );

    // Should fail if we put flag 4 true and flag 5 or 6 true
    expect(async () => {
      const account = await generateAccount();
      await addAccount(account, addressesMap);
      await depositMessage(
        account,
        addressesMap,
        nullifierMap,
        secretMessagesTree,
        account,
        Field(0b000110)
      );
    }).rejects.toThrow();
    expect(async () => {
      const account = await generateAccount();
      await addAccount(account, addressesMap);
      await depositMessage(
        account,
        addressesMap,
        nullifierMap,
        secretMessagesTree,
        account,
        Field(0b000101)
      );
    }).rejects.toThrow();
  });
});
