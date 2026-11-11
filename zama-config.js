// THE LAST SIGNAL - Zama FHEVM config.
// Fill CONTRACT_ADDRESS in AFTER deploying LastSignalSealedChoice to
// Sepolia (see README.md). Nothing secret belongs in this file.
export const LAST_SIGNAL_CONFIG = {
  // Not deployed yet. Deploy with: npm run deploy:sepolia
  // (needs Sepolia ETH in the deploy wallet), then paste the
  // contract address here as CONTRACT_ADDRESS.
  CONTRACT_ADDRESS: "",
  // Sepolia chain id.
  CHAIN_ID: 11155111,
  // Zama Sepolia Relayer used by @zama-fhe/relayer-sdk.
  // The SDK's own SepoliaConfig carries this URL (and the Sepolia
  // ACL/KMS/verifier addresses); this is a human-readable note only.
  // See https://docs.zama.ai - update if the docs change the URL.
  RELAYER_URL: "https://relayer.testnet.zama.org",
};
