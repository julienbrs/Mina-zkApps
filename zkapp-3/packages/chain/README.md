# Protokit: Starter kit

Starter kit for developing privacy enabled application chains. (zkChains)

The default example contains a simple zkChain with one runtime module - `src/Balances.ts`.
Integration tests for the Balances module can be found in `src/Balances.test.ts`.

**Quick start:**

```zsh
npx degit proto-kit/starter-kit#develop my-chain
cd my-chain
npm install
npm run test:watch
```


# Privacy issue:
The spymaster's concern about privacy is valid. In the current system, all messages, including sensitive details like the security code and the content of the messages, are processed on-chain, making them visible to anyone who accesses the blockchain. This lack of privacy could compromise operational security.

To enhance privacy, the processing of messages should be shifted off-chain. Agents could compute the validity of their messages locally, generating a proof that verifies the message meets all necessary criteria without revealing the actual content or security code. This proof can then be verified on-chain. By doing so, only the proof and not the actual message details are recorded on the blockchain, ensuring that sensitive information remains confidential while still maintaining the integrity of the message processing system.