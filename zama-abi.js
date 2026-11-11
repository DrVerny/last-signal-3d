// LastSignalSealedChoice contract ABI - only the functions the frontend needs.
// Generated from contracts/LastSignalSealedChoice.sol. Keep in sync after any
// contract change (re-run: npx hardhat compile, then copy the ABI).
export const LAST_SIGNAL_ABI = [
  "function sealPriorityPower(bytes32 encryptedChoice, bytes inputProof)",
  "function sealFinalChoice(bytes32 encryptedChoice, bytes inputProof)",
  "function revealChoices(address player)",
  "function hasSealedPriorityPower(address) view returns (bool)",
  "function hasSealedFinalChoice(address) view returns (bool)",
  "function isRevealed(address) view returns (bool)",
  "function getPriorityPower(address) view returns (bytes32)",
  "function getFinalChoice(address) view returns (bytes32)",
  "function getPlayers() view returns (address[])",
  "event PriorityPowerSealed(address indexed player)",
  "event FinalChoiceSealed(address indexed player)",
  "event ChoicesRevealed(address indexed player)",
];
