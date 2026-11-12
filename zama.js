// THE LAST SIGNAL - Zama FHEVM wiring (Sepolia).
// Shared by Act I (game.js) and Act III (act3.js). Both are ES modules;
// this file is imported by each of them.
//
// DEMO MODE (default, no wallet needed):
// The sealed choices are simulated locally in the game state, exactly as
// before. Nothing here touches game state. Demo mode is honest about
// this everywhere it appears: the mode badge reads "DEMO MODE - choices
// sealed locally".
//
// SEPOLIA MODE:
// When CONTRACT_ADDRESS is set in zama-config.js and a wallet is
// connected, the player's sealed choices are ALSO encrypted in the
// browser with @zama-fhe/relayer-sdk and sent to the
// LastSignalSealedChoice contract. The local simulation stays the
// source of truth for gameplay - the on-chain seal runs in the
// background and never blocks a dialogue or a choice. If the seal
// fails (wallet rejected, no gas, contract not deployed), the game
// continues in demo mode and the status line says so plainly.
//
// Libraries (vendored, no CDN needed):
//   vendor/ethers.umd.min.js  -> window.ethers (ethers v6 UMD),
//     loaded with a classic <script> tag in index.html / act3.html.
//   vendor/relayer-sdk-js.js  -> ESM bundle (@zama-fhe/relayer-sdk
//     0.4.1) + tfhe_bg.wasm / kms_lib_bg.wasm in the same folder.
//     Loaded lazily with dynamic import(), so if the SDK fails to
//     load, demo mode still works and Sepolia just reports the error.
// The SDK's own SepoliaConfig carries the relayer URL and the
// Sepolia ACL/KMS/verifier addresses; zama-config.js RELAYER_URL is
// kept only as a human-readable note.
import { LAST_SIGNAL_CONFIG as CFG } from "./zama-config.js";
import { LAST_SIGNAL_ABI as ABI } from "./zama-abi.js";

// Choice numbers, matching contracts/LastSignalSealedChoice.sol:
// Act I priority power: 0 = Hospital, 1 = Residential, 2 = Industrial.
// Act III final fix: 0 = Quick Fix, 1 = Rebuild, 2 = Third Way.
export const PRIORITY_LABELS = ["Hospital", "Residential", "Industrial"];
export const FINAL_LABELS = ["Quick Fix", "Rebuild", "Third Way"];
export const PRIORITY_VALUES = { Hospital: 0, Residential: 1, Industrial: 2 };
export const FINAL_VALUES = { quick: 0, rebuild: 1, thirdway: 2 };

const SEPOLIA_CHAIN_ID = CFG.CHAIN_ID || 11155111;
const ETHERSCAN = "https://sepolia.etherscan.io";

// { provider, signer, contract, account, instance } once connected, else null.
let zama = null;
// Which choices this session sealed on-chain (confirmed tx).
const sealedOnChain = { priority: false, final: false };

export function isConfigured() { return !!CFG.CONTRACT_ADDRESS; }
export function isConnected() { return !!zama; }
export function getMode() { return isConnected() ? "sepolia" : "demo"; }
export function wasSealedOnChain(kind) { return !!sealedOnChain[kind]; }
export function getAccount() { return zama ? zama.account : null; }
export function shortAddr(a) { return a ? a.slice(0, 6) + "…" + a.slice(-4) : ""; }

function el(id) { return document.getElementById(id); }

export function setZamaStatus(msg) {
  const s = el("zamaStatus");
  if (s) s.textContent = msg;
}

function setModeBadge() {
  const b = el("zamaMode");
  if (!b) return;
  if (isConnected()) {
    b.textContent = "SEPOLIA - choices sealed on-chain with FHEVM";
    b.classList.remove("demo");
    b.classList.add("sepolia");
  } else {
    b.textContent = isConfigured()
      ? "DEMO MODE - connect your wallet to seal choices on Sepolia"
      : "DEMO MODE - choices sealed locally";
    b.classList.remove("sepolia");
    b.classList.add("demo");
  }
  const w = el("zamaWallet");
  if (w) w.textContent = isConnected() ? "Connected: " + shortAddr(zama.account) + " (Sepolia)" : "";
}

export function friendlyError(e) {
  const msg = (e && (e.shortMessage || e.reason || e.message)) || String(e);
  if (/user rejected|User denied|ACTION_REJECTED|4001/i.test(msg)) return "Transaction rejected in your wallet - nothing was sent.";
  if (/already sealed/i.test(msg)) return "You already sealed that choice on-chain - one seal per player.";
  if (/Both choices must be sealed/i.test(msg)) return "Both choices must be sealed on-chain first.";
  if (/Choices already revealed/i.test(msg)) return "Those choices were already revealed.";
  if (/insufficient funds/i.test(msg)) return "Not enough Sepolia test ETH for gas - top up from a Sepolia faucet.";
  if (/network|chain|wrong chain/i.test(msg)) return "Wrong network - switch your wallet to Sepolia (chain 11155111). " + msg;
  return msg.length > 200 ? msg.slice(0, 200) + "…" : msg;
}

async function ensureChain() {
  const chainHex = await window.ethereum.request({ method: "eth_chainId" });
  if (parseInt(chainHex, 16) === SEPOLIA_CHAIN_ID) return true;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x" + SEPOLIA_CHAIN_ID.toString(16) }],
    });
    return true;
  } catch (e) {
    setZamaStatus("Please switch your wallet to Sepolia (chain ID 11155111) and try again. Your wallet refused the automatic switch.");
    return false;
  }
}

export async function connectWallet(onConnect) {
  if (!window.ethereum) { setZamaStatus("No wallet found - install MetaMask or Rabby in your browser, then try again."); return null; }
  if (!window.ethers) { setZamaStatus("ethers library failed to load - reload the page (vendor/ethers.umd.min.js must be served with the page)."); return null; }
  if (!CFG.CONTRACT_ADDRESS) {
    setZamaStatus("Sepolia is not wired up yet: deploy the contract first, then paste its address into zama-config.js (see README).");
    return null;
  }
  try {
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    if (!(await ensureChain())) return null;
    const provider = new window.ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const contract = new window.ethers.Contract(CFG.CONTRACT_ADDRESS, ABI, signer);
    zama = { provider, signer, contract, account: accounts[0], instance: null };
    setModeBadge();
    setZamaStatus("Wallet connected. Your sealed choices will also be encrypted on Sepolia.");
    if (onConnect) { try { await onConnect(); } catch (e) { /* the game decides what a failed refresh means */ } }
    return accounts[0];
  } catch (e) {
    setZamaStatus("Wallet connection failed: " + friendlyError(e));
    return null;
  }
}

async function getRelayerInstance() {
  if (zama.instance) return zama.instance;
  setZamaStatus("Loading the Zama Relayer SDK (first use takes a few seconds)…");
  let sdk;
  try {
    sdk = await import("./vendor/relayer-sdk-js.js");
  } catch (e) {
    throw new Error("Relayer SDK failed to load - vendor/relayer-sdk-js.js (and its .wasm files) must be served with the page. " + (e.message || e));
  }
  await sdk.initSDK();
  zama.instance = await sdk.createInstance({
    ...sdk.SepoliaConfig,
    network: window.ethereum,
    chainId: SEPOLIA_CHAIN_ID,
  });
  return zama.instance;
}

// Seal one choice on-chain. Fire-and-forget by design: the game calls
// this without awaiting it, so a wallet prompt or a slow tx can never
// block a dialogue or a choice. It never throws - every failure is
// reported through `notify` and the game carries on in demo mode.
// Returns { mode: "demo" } when Sepolia is not in use.
export async function sealPriorityChoice(value, notify) {
  return sealChoice("priority", value, notify);
}

export async function sealFinalChoice(value, notify) {
  return sealChoice("final", value, notify);
}

async function sealChoice(kind, value, notify) {
  const say = notify || setZamaStatus;
  if (!isConfigured() || !isConnected()) return { mode: "demo" };
  if (!Number.isInteger(value) || value < 0 || value > 2) return { mode: "demo" };
  const label = kind === "priority" ? PRIORITY_LABELS[value] : FINAL_LABELS[value];
  const fn = kind === "priority" ? "sealPriorityPower" : "sealFinalChoice";
  try {
    const instance = await getRelayerInstance();
    say("Encrypting your " + (kind === "priority" ? "priority-power" : "final") + " choice (" + label + ") in your browser…");
    const input = instance.createEncryptedInput(CFG.CONTRACT_ADDRESS, zama.account);
    input.add8(value);
    const { handles, inputProof } = await input.encrypt();
    say("Choice encrypted - sending to the contract. Confirm in your wallet…");
    const tx = await zama.contract[fn](handles[0], inputProof);
    say("Seal tx sent - waiting for confirmation…");
    const receipt = await tx.wait();
    if (receipt.status !== 1n && receipt.status !== 1) throw new Error("Transaction failed on-chain (status 0).");
    sealedOnChain[kind] = true;
    say("Your " + label + " choice is sealed on Sepolia - nobody can see it until reveal. Tx: " + tx.hash);
    return { mode: "sepolia", txHash: tx.hash };
  } catch (e) {
    say("Could not seal on Sepolia: " + friendlyError(e) + " The game continues - your choice is still sealed locally.");
    return { mode: "sepolia", error: friendlyError(e) };
  }
}

// Read this player's on-chain seal state. Returns nulls when Sepolia
// is not in use, so callers can fall back to the local simulation.
export async function readOnChainState() {
  if (!isConfigured() || !isConnected()) return { configured: isConfigured(), connected: false, prioritySealed: false, finalSealed: false, revealed: false };
  try {
    const [prioritySealed, finalSealed, revealed] = await Promise.all([
      zama.contract.hasSealedPriorityPower(zama.account),
      zama.contract.hasSealedFinalChoice(zama.account),
      zama.contract.isRevealed(zama.account),
    ]);
    return { configured: true, connected: true, prioritySealed, finalSealed, revealed };
  } catch (e) {
    setZamaStatus("Could not read your on-chain choices: " + friendlyError(e));
    return { configured: true, connected: true, prioritySealed: false, finalSealed: false, revealed: false };
  }
}

// Reveal the connected player's choices on-chain and decrypt them.
// Call from the Act III end card, after the game ends. Returns
// { ok: true, priority, final } with plaintext numbers, or
// { ok: false, reason } when there is nothing to reveal.
export async function revealOnChain(notify) {
  const say = notify || setZamaStatus;
  if (!isConfigured()) return { ok: false, reason: "not-configured" };
  if (!isConnected()) return { ok: false, reason: "not-connected" };
  try {
    const st = await readOnChainState();
    if (!st.prioritySealed || !st.finalSealed) {
      return { ok: false, reason: "not-sealed", prioritySealed: st.prioritySealed, finalSealed: st.finalSealed };
    }
    if (!st.revealed) {
      say("Revealing your sealed choices on-chain - confirm in your wallet…");
      const tx = await zama.contract.revealChoices(zama.account);
      say("Reveal tx sent - waiting for confirmation…");
      await tx.wait();
    }
    say("Decrypting your sealed choices with the Relayer…");
    const instance = await getRelayerInstance();
    const priorityHandle = await zama.contract.getPriorityPower(zama.account);
    const finalHandle = await zama.contract.getFinalChoice(zama.account);
    const { clearValues } = await instance.publicDecrypt([priorityHandle, finalHandle]);
    const pick = (h) => {
      const v = clearValues[h.toLowerCase()] ?? clearValues[h];
      return typeof v === "bigint" ? Number(v) : v;
    };
    return { ok: true, priority: pick(priorityHandle), final: pick(finalHandle) };
  } catch (e) {
    say("Could not reveal: " + friendlyError(e));
    return { ok: false, reason: "error", error: friendlyError(e) };
  }
}

// Show the "Reveal sealed choices on Sepolia" button on the Act III
// end card, but only when there is actually something to reveal:
// wallet connected and both choices sealed on-chain. The button
// calls revealOnChain and renders the decrypted choices into
// #zamaRevealResult. Safe to call when the elements are missing.
export async function setupRevealButton() {
  const btn = el("zamaRevealBtn");
  const out = el("zamaRevealResult");
  if (!btn) return;
  const st = await readOnChainState();
  if (!st.connected || !st.prioritySealed || !st.finalSealed) {
    btn.classList.add("hidden");
    return;
  }
  btn.classList.remove("hidden");
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = "Revealing…";
    const r = await revealOnChain();
    if (!r.ok) {
      if (out) out.textContent = "Nothing to reveal yet: " + r.reason + ".";
      btn.disabled = false;
      btn.textContent = "Reveal sealed choices on Sepolia";
      return;
    }
    const p = PRIORITY_LABELS[r.priority] || ("choice " + r.priority);
    const f = FINAL_LABELS[r.final] || ("choice " + r.final);
    if (out) {
      out.innerHTML =
        "<strong>On-chain reveal:</strong> Act I priority power - " + p +
        " &nbsp;•&nbsp; Act III final fix - " + f +
        " (decrypted from Sepolia with FHEVM).";
    }
    setZamaStatus("Choices revealed on Sepolia - Act I: " + p + ", Act III: " + f + ".");
    btn.textContent = "Revealed on Sepolia";
  };
}

// Wire the mode badge, connect button and status line in the HUD.
// Safe to call on a page that has none of those elements. `options`
// may carry onConnect, called after a successful wallet connect.
// Called once per act boot (Act I, II and III each call it), so the
// ethereum listeners are attached only once - otherwise the
// accountsChanged / chainChanged handlers would stack on every act.
let zamaListenersAttached = false;
export function initZamaUI(options) {
  setModeBadge();
  const btn = el("zamaConnectBtn");
  if (btn) {
    btn.onclick = () => { connectWallet(options && options.onConnect); };
    if (!isConfigured()) btn.textContent = "Connect wallet (Sepolia - not deployed yet)";
  }
  if (window.ethereum && !zamaListenersAttached) {
    zamaListenersAttached = true;
    window.ethereum.on("accountsChanged", () => {
      zama = null; sealedOnChain.priority = false; sealedOnChain.final = false;
      setModeBadge(); setZamaStatus("Wallet account changed - connect again.");
    });
    window.ethereum.on("chainChanged", () => {
      zama = null; sealedOnChain.priority = false; sealedOnChain.final = false;
      setModeBadge(); setZamaStatus("Network changed - connect again on Sepolia.");
    });
  }
}

export { ETHERSCAN };
