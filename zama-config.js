// THE LAST SIGNAL - Zama FHEVM config.
// Fill CONTRACT_ADDRESS in AFTER deploying LastSignalSealedChoice to
// Sepolia (see README.md). Nothing secret belongs in this file.
export const LAST_SIGNAL_CONFIG = {
  // Deployed to Sepolia 2026-11-11.
  // Deploy tx: 0x1183af7bac87f046c5f023c592bc6f6c85b4f0fc4c898b05c6ec27ed99fa4540
  CONTRACT_ADDRESS: "0x1504E234eab90BF383f64691BB7117da317740bC",
  // Sepolia chain id.
  CHAIN_ID: 11155111,
  // Zama Sepolia Relayer used by @zama-fhe/relayer-sdk.
  // The SDK's own SepoliaConfig carries this URL (and the Sepolia
  // ACL/KMS/verifier addresses); this is a human-readable note only.
  // See https://docs.zama.ai - update if the docs change the URL.
  RELAYER_URL: "https://relayer.testnet.zama.org",
};
