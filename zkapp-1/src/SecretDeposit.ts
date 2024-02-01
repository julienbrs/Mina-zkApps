import {
  Field,
  SmartContract,
  state,
  State,
  method,
  PublicKey,
  MerkleMap,
  MerkleMapWitness,
  MerkleTree,
  MerkleWitness,
  Poseidon,
  Nullifier,
} from 'o1js';

// Need to store 100 addresses
export const maxAddressesCount = 100;
export const messagesHeight = Math.ceil(Math.log2(maxAddressesCount) + 1);
export class MyMerkleWitness extends MerkleWitness(messagesHeight) {}
export const nullifierMsg = Field(3030).toFields();

export class SecretDeposit extends SmartContract {
  // Admin -> the one who can add addresses
  @state(PublicKey) adminPublicKey = State<PublicKey>();
  // Map of allowed addresses (PublicKey -> Boolean) with counter
  @state(Field) addressesRoot = State<Field>();
  @state(Field) addressCount = State<Field>();
  // Map of addresses nullifiers (PublicKey -> Nullifier)
  @state(Field) nullifierRoot = State<Field>();
  // Tree of messages deposited secretly with total count
  @state(Field) secretMessagesRoot = State<Field>();
  @state(Field) secretMessagesCount = State<Field>();

  events = {
    MessageDeposit: Field,
  };

  init() {
    super.init();
    this.adminPublicKey.set(this.sender);
    this.addressesRoot.set(new MerkleMap().getRoot());
    this.addressCount.set(Field(0));
    this.nullifierRoot.set(new MerkleMap().getRoot());
    this.secretMessagesRoot.set(new MerkleTree(messagesHeight).getRoot());
    this.secretMessagesCount.set(Field(0));
  }

  @method addAddress(witness: MerkleMapWitness) {
    // Check that the sender is the admin
    const admin = this.adminPublicKey.getAndRequireEquals();
    admin.assertEquals(this.sender);

    // Check that there's not maxAddressesCount addresses already
    const count = this.addressCount.getAndRequireEquals();
    count.assertLessThan(maxAddressesCount);

    // Check that the address is not already in the tree
    const previousRoot = this.addressesRoot.getAndRequireEquals();
    const [emptyRoot] = witness.computeRootAndKey(Field(0)); // New leaf starts with 0
    emptyRoot.assertEquals(previousRoot);

    // Add the address to the tree by updating the root with the new leaf
    const [newRoot] = witness.computeRootAndKey(Field(1)); // 1 is allowed
    this.addressesRoot.set(newRoot);

    // Increment the address count
    this.addressCount.set(count.add(Field(1)));
  }

  @method depositMessage(
    nullifier: Nullifier,
    nullifierWitness: MerkleMapWitness,
    addressesWitness: MerkleMapWitness,
    message: Field,
    messageWitness: MyMerkleWitness
  ) {
    // verify the nullifier
    let nullifierRoot = this.nullifierRoot.getAndRequireEquals();
    nullifier.verify(nullifierMsg);

    // Check that the nullifier associated public key is in the allowed addresses
    const addressesRoot = this.addressesRoot.getAndRequireEquals();
    const [allowedRoot, allowedKey] = addressesWitness.computeRootAndKey(
      Field(1)
    );
    allowedRoot.assertEquals(addressesRoot);
    allowedKey.assertEquals(Poseidon.hash(nullifier.getPublicKey().toFields()));

    // compute the current root and make sure the entry is set to 0 (= unused)
    nullifier.assertUnused(nullifierWitness, nullifierRoot);

    // set the nullifier to 1 (= used) and calculate the new root
    // and update on-chain root
    let newRoot = nullifier.setUsed(nullifierWitness);
    this.nullifierRoot.set(newRoot);

    // => The address is allowed and the nullifier was used

    // Compute message flags
    const bits = message.toBits();
    const f1 = bits[5];
    const f2 = bits[4];
    const f3 = bits[3];
    const f4 = bits[2];
    const f5 = bits[1];
    const f6 = bits[0];

    // Validate message flags
    // Condition 1: If flag 1 is true, then all other flags must be false
    const c1 = f1
      .not()
      .or(f2.not().and(f3.not()).and(f4.not()).and(f5.not()).and(f6.not()));
    // Condition 2: If flag 2 is true, then flag 3 must also be true
    const c2 = f2.not().or(f3);
    // Condition 3: If flag 4 is true, then flags 5 and 6 must be false
    const c3 = f4.not().or(f5.not().and(f6.not()));

    c1.and(c2).and(c3).assertTrue();

    // => The message was validated

    // Verify that given witness is on an empty leaf
    const previousRoot = this.secretMessagesRoot.getAndRequireEquals();
    const unsetRoot = messageWitness.calculateRoot(Field(0));
    unsetRoot.assertEquals(previousRoot);

    // Validate that the given witness is on the next leaf
    const secretMessageCount = this.secretMessagesCount.getAndRequireEquals();
    const unsetIndex = messageWitness.calculateIndex();
    unsetIndex.assertEquals(secretMessageCount);

    // Set new root
    const newSecretMessagesRoot = messageWitness.calculateRoot(message);
    this.secretMessagesRoot.set(newSecretMessagesRoot);

    // => The message was deposited in the next leaf secretly

    // Mutate counter
    this.secretMessagesCount.set(secretMessageCount.add(Field(1)));

    // Emit event
    this.emitEvent('MessageDeposit', secretMessageCount);
  }
}
