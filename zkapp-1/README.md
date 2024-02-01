# Learn to earn Challenge 1

The administrator adds allowed addresses in a Merkle Map of Hash(address) -> bool.

Allowed user can then deposit their message by providing a proof that their address is in the Merkle Map and a nullifier.
The nullifiers are stored in another Merkle Map that allow to prevent double message from the same user while completely hiding the user's address.
This means that it is not possible to map a message to an address (if there's multiple allowed addresses).

A non allowed address can submit a transaction with a unused nullifier of an allowed address and this will be accepted. This was done to further allow the privacy of the users.

Secret messages are stored in a Merkle Tree.

## How to build

```sh
npm run build
```

## How to run tests

```sh
npm run test
npm run testw # watch mode
```

## How to run coverage

```sh
npm run coverage
```

Result:
```
  SecretDeposit
    ✓ deploy (1229 ms)
    ✓ addAddress: add new address successfully (7286 ms)
    ✓ addAddress: add new address but not admin fail (2017 ms)
    ✓ addAddress: add already allowed address fail (3512 ms)
    ✓ depositMessage: deposit message successfully (5498 ms)
    ✓ depositMessage: deposit message as third party successfully (5356 ms)
    ✓ depositMessage: deposit message not allowed address fail (2920 ms)
    ✓ depositMessage: deposit twice fail (7370 ms)
    ✓ depositMessage: deposit twice specific cases (same nullifier, tree index, ...) (6051 ms)
    ✓ depositMessage: message flag validation condition 1 (5245 ms)
    ✓ depositMessage: message flag validation condition 2 (6283 ms)
    ✓ depositMessage: message flag validation condition 3 (8250 ms)

------------------|---------|----------|---------|---------|-------------------
File              | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s 
------------------|---------|----------|---------|---------|-------------------
All files         |     100 |      100 |     100 |     100 |                   
 SecretDeposit.ts |     100 |      100 |     100 |     100 |                   
------------------|---------|----------|---------|---------|-------------------
Test Suites: 1 passed, 1 total
Tests:       12 passed, 12 total
```

## License

[Apache-2.0](LICENSE)
