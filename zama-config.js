// THE LAST SIGNAL - Zama FHEVM config.
// Fill CONTRACT_ADDRESS in AFTER deploying LastSignalSealedChoice to
// Sepolia (see README.md). Nothing secret belongs in this file.
export const LAST_SIGNAL_CONFIG = {
  // Deployed to Sepolia 2026-11-11 (fresh redeploy; previous contract
  // 0x1504E234eab90BF383f64691BB7117da317740bC superseded).
  // Deploy tx: 0x35fb6760a55b10e68ab0d5e76a5fde3cc5a36dd1073e94f7add3c7cd42a244e3
  CONTRACT_ADDRESS: "0x9eE62DA6f26Ef3E6D275DaFAE2E4b3f8DC661d10",
  // Sepolia chain id.
  CHAIN_ID: 11155111,
  // Zama Sepolia Relayer used by @zama-fhe/relayer-sdk.
  // The SDK's own SepoliaConfig carries this URL (and the Sepolia
  // ACL/KMS/verifier addresses); this is a human-readable note only.
  // See https://docs.zama.ai - update if the docs change the URL.
  RELAYER_URL: "https://relayer.testnet.zama.org",
};
