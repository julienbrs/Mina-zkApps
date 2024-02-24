import {
  Field,
  SmartContract,
  state,
  State,
  method,
  Struct,
  Bool,
  Provable,
  Reducer,
} from 'o1js';

export class Message extends Struct({
  number: Field,
  agentID: Field,
  agentXLocation: Field,
  agentYLocation: Field,
  checkSum: Field,
}) {}

// TODO: Handle duplicates

export const MAX_BATCH_SIZE = 25;

export function validateMessage(message: Message) {
  // Precondition on Agent ID
  const isZero: Bool = message.agentID.equals(Field(0));

  // validate checksum
  const cond1: Bool = message.checkSum.equals(
    message.agentID.add(message.agentXLocation).add(message.agentYLocation)
  );

  // Agent ID should be between 0 and 3000
  const cond2: Bool = message.agentID.lessThanOrEqual(Field(3000));

  // AgentXLocation should be between 0 and 15000
  const cond3: Bool = message.agentXLocation.lessThanOrEqual(Field(15000));

  // AgentYLocation should be between 5000 and 20000
  const cond4: Bool = message.agentYLocation
    .greaterThanOrEqual(Field(5000))
    .and(message.agentYLocation.lessThanOrEqual(Field(20000)));

  // AgentYLocation should be greater than AgentXLocation
  const cond5: Bool = message.agentYLocation.greaterThan(
    message.agentXLocation
  );

  const isValid: Bool = Provable.if(
    isZero,
    Bool(true),
    cond1.and(cond2).and(cond3).and(cond4).and(cond5)
  );

  return isValid;
}

export class SpyMaster extends SmartContract {
  reducer = Reducer({ actionType: Field });
  // helper field to store the point in the action history that our on-chain state is at
  @state(Field) actionState = State<Field>();
  @state(Field) highestNumber = State<Field>();

  events = {
    dispatched: Field,
    processed: Field,
  };

  init() {
    super.init();
    this.highestNumber.set(Field(0));
    this.actionState.set(Reducer.initialActionState);
  }

  @method addMessageToBatch(message: Message) {
    const isValid = validateMessage(message);
    isValid.assertEquals(Bool(true));
    this.reducer.dispatch(message.number);
    this.emitEvent('dispatched', message.number);
  }

  @method processBatch() {
    const currentHighestNumber = this.highestNumber.getAndRequireEquals();

    let actionState = this.actionState.getAndRequireEquals();
    const pendingActions = this.reducer.getActions({
      fromActionState: actionState,
    });

    let { state: newHighest, actionState: newActionState } =
      this.reducer.reduce(
        pendingActions,
        // state type, here highestNumber is a Field
        Field,
        // State = current highest number, action = new message number
        (state: Field, action: Field) => {
          const newHighestFound = Provable.if(
            state.lessThan(action),
            action,
            state
          );

          return newHighestFound;
        },
        {
          state: currentHighestNumber,
          actionState: actionState,
        },
        {
          maxTransactionsWithActions: MAX_BATCH_SIZE,
        }
      );

    this.highestNumber.set(newHighest);
    this.actionState.set(newActionState);
    this.emitEvent('processed', newHighest);
  }
}
