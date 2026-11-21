# THE LAST SIGNAL (3D)

**Tagline:** “Repair is a moral act.”
**Author:** Moshood Sodiq Olasunkanmi (DrVerny / @verrnny)
**Proposed GitHub repo:** `last-signal-3d`

A playable 3D browser game of the narrative thriller **THE LAST SIGNAL** - all three acts (Act I 'The 4 Train', Act II 'City of Wires', Act III 'The Human Signal') play as one game in the browser. A New York City infrastructure drama from a DeepSeek game script (shared chat, 2026-11-10). Short original dialogue in the same spirit; no long dialogue copied verbatim.

## Story (Act I)
Jade Morales, 34, former MTA signal engineer fired after whistleblowing, is riding the southbound 4 train at rush hour when the lights die. With rookie NYPD officer Caleb Bishop, she must restore a signal relay, evacuate the passengers, and discovers a hand-soldered circuit board labelled **RESET** - someone who used to work for the city built it.

## How to run
```bash
cd ~/workspace/last-signal-3d
python3 -m http.server 8000
# open http://localhost:8000
```
No backend, no login, no real money. Three.js is vendored locally (`three.min.js`, r160) - no CDN needed.

## Controls
- **Drag** to look around the subway car
- **WASD** to move inside the car
- **Click glowing objects** to inspect: signal relay (gold), emergency release (red), maintenance panel (blue), RESET board (green, appears after evacuation), Caleb / Nurse Adeyemi / Walter (click to learn about them)
- **Dialogue:** plays automatically; the Continue button is a skip. Choice buttons move the Trust Meter

## What works
- 3D subway car interior at night: R160/R211-style car, 3.0 m wide, 15 m long, arched roof (apex 3.15 m), tapered ends with centre doors/windows, longitudinal benches with individual contoured fabric cushions, tilted backs, front rolls and steel dividers (20 seats), brushed-steel poles, handrails and hand straps, sliding doors with windows on both sides, framed windows onto a dark tunnel with passing lights, strip maps, route map, ads and "Stand clear" signs, emergency intercom, anti-slip worn floor with yellow door thresholds
- Blackout: lights flicker and die, red emergency strips take over, 15:00 battery timer ticks down
- Inspect system (raycast clicking, highlighted interactive objects)
- Repair mini-game: match the 4×4 gold circuit pattern to restore power
- Lead: count passengers, help Walter Simms (cannot climb stairs) - moral choice, no wrong answer
- Trust Meter Jade↔Caleb (0-10, starts at 3), dialogue choices raise/lower it
- System Integrity Tracker: Transit / Water / Power / Communications bars, choices affect them
- **Sealed choice (Zama twist):** pick which line gets priority power - Hospital / Residential / Industrial. The choice is hidden until the end of Act I, then revealed on the title card. In demo mode (no wallet) the sealing is simulated locally; when a wallet is connected on Sepolia, the pick is encrypted in the browser with the Relayer SDK and sealed on-chain as an FHEVM `euint8` in `LastSignalSealedChoice` (exactly like Sealed Fortune: encrypted input, revealed only after the game ends). See "Zama FHEVM integration" below.
- Endings: reach the platform, find the RESET board, title card “THE LAST SIGNAL” with your Trust / Integrity / sealed-choice summary
- HUD: Trust, battery timer, System Integrity, objectives, inventory (RESET circuit board)

## Visual style - high-fidelity photorealism
ACESFilmicToneMapping with sRGB output, exposure 1.25, PCFSoft shadows, cool-white fluorescent key light plus red emergency and dim warm battery lighting, FogExp2 tunnel haze that thickens in blackout, 320 drifting dust motes plus 180 dust motes concentrated inside the light beams, volumetric light shafts (layered additive cones with a vertical gradient alpha texture, bright at the tube and fading to the floor), god-ray style glow halos around the fluorescent tubes and emergency lights, additive light pools on the floor under each tube, flicker with realistic falloff, bounce fill from hemisphere and ambient light, contact shadows (soft dark blobs) grounding every character and bench, PBR materials with a procedural environment cube map for reflections on steel, bump maps and roughness maps from canvas noise (scuffed floor, fabric weave on seats, brushed steel poles), procedural posters and signage (4 train, Bronx Zoo, "Stand clear of the closing doors", 14 St-Union Sq), slight handheld camera sway, CSS vignette, animated film grain, and a Cinema button that toggles letterbox bars. Pixel ratio is capped at 2, geometries and materials are reused, and the animation loop makes no per-frame allocations. No external assets: all textures are generated in code. Still not true photorealism (see below).

## Train realism - what was wrong, what changed (2026-11-10 overhaul)
Before: the car was a plain 6 m wide, 3 m tall flat box (flat ceiling, vertical walls, flat end walls) with single 1.2 x 0.5 x 2 m blue boxes for benches - twice the width of a real subway car, with no curve, no seat shape and no reflections that read as steel. That is what made it look fake.
Now, procedural only, no external assets: the shell is a real R160/R211 cross-section (3.0 m wide, 15 m long, vertical lower walls to 1.9 m, then an extruded arched roof to 3.15 m apex, tapered end corners, arched end walls with a centre door and window), and the seats are 20 individual contoured seats (0.46 m wide, 0.45 m seat height, 0.44 m depth, fabric cushion with moquette weave and stitch seams, rounded front roll, backrest tilted 12 degrees with a top rail, steel divider between neighbours, steel plinth underneath) in two longitudinal bench sections per side, either side of the centre doors. Walter sits on the rear left bench at seat centre (x -1.18, z 4.5), so his seated scan lines up with a real bench cushion. Added at the same time: brushed-stainless canvas texture (horizontal streaks, used as map/bump/roughness) for poles, doors and kick plates, MeshPhysicalMaterial glass with clearcoat for door and side windows, anti-slip speckled floor texture with a worn centre aisle and yellow tactile strips, ceiling panels with seams and recessed fluorescent housings, wall seams and rivets, hand straps, strip maps (green 4 line with stations) and a route-map poster, an emergency intercom, door pockets, and a dark tunnel outside with 10 passing light strips that stream past the windows while the train is moving (intro stage) and freeze at the blackout. Gameplay, dialogue, Trust Meter, repair mini-game, sealed choice, timer and controls are unchanged; character, door, relay, panel and board positions were moved onto the new 3.0 m walls, and camera movement is clamped to the narrower aisle (x +-1.05).

## Human characters - scanned 3D people (CC0, Innerscene / MakeHuman)
Real scanned figures, not procedural geometry: `models/jade.glb` (Riley, woman, 1.672 m, short dark hair, teal T-shirt, jeans), `models/caleb.glb` (Daniel, man, 1.795 m, dark hair, olive jacket recoloured navy in code), `models/adeyemi.glb` (professional nurse, teal scrubs, stethoscope, ponytail, 1.644 m), `models/walter.glb` (Rowan, older man, grey hair, seated on a bench, 1.30 m seated height). All four are CC0 (public domain) from the Innerscene / MakeHuman library. The game loads them with the vendored Three.js r160 GLTFLoader, normalises each to 1.68 m (5 ft 6 in), re-grounds feet at y=0, and keeps click-to-inspect on each model group. Walter's bench from his file is hidden (the car already has benches); Caleb gets a simple navy cap and a gold badge disc in code, since the scan has neither. Rigged models (`models/rigged/`, added 2026-11-16) carry the walking crowd and guards with leg movement, and mouths move for Jade, Caleb and the Nurse during dialogue. **Repo size note:** the four top-level character files total about 11 MB (jade.glb 1.7 MB, adeyemi.glb 3.1 MB, caleb.glb 4.0 MB, walter.glb 2.4 MB), and the game shows a loading screen until the characters load, with a clear error and a "continue without them" option if any model fails. Three.js is vendored locally (`three.module.js` r160 + `vendor/loaders/GLTFLoader.js` + `vendor/utils/BufferGeometryUtils.js`, import-map ESM) - no CDN needed. Still not true photorealism: lighting is simulated (not ray-traced), and cloth does not move.

## What is NOT included
- The full 16-scene script in full detail - Acts I, II and III are all built as playable slices, not the whole story shot-for-shot
- Multiplayer
- **Live-stream audience voting** - not built yet. How it could work later: viewers vote in chat (e.g. `!hospital` / `!residential` / `!industrial`); votes are collected as the sealed choice, encrypted, and revealed live at the end of the act - the audience's choice changes the ending, but nobody sees the tally until reveal
- Real FHEVM contract - written, tested, wired and deployed to Sepolia 2026-11-11, redeployed fresh the same day at 21:09 WAT (see "Zama FHEVM integration" below): `LastSignalSealedChoice` at `0x9eE62DA6f26Ef3E6D275DaFAE2E4b3f8DC661d10` (replaces the abandoned 0x1504E234eab90BF383f64691BB7117da317740bC). The updated `zama-config.js` is pushed to GitHub Pages, so the live site runs with the Sepolia contract configured (verified live 2026-11-17, re-read 2026-11-20 and 2026-11-21: the live Pages copy of `zama-config.js` shows `CONTRACT_ADDRESS: "0x9eE62DA6f26Ef3E6D275DaFAE2E4b3f8DC661d10"`).

## Act II - City of Wires (added 2026-11-10)
Act I's end card links to `act2.html`. Trust, System Integrity, the sealed choice and the RESET board carry over from Act I via localStorage (defaults apply when played standalone). Three missions, one per script location:
1. **The Delaware Line** - Rondout Reservoir control station at 6 AM. Balance Hospital / Residential / Industrial pressure to 70% or more while the sabotaged digital control overcorrects a valve every few seconds (if Trust is 7+, Caleb holds the Industrial valve by radio). Then the moral choice: one line runs reduced for 2 hours. Discovery: a second RESET device with a fingerprint - Derrick Shaw.
2. **The Grid** - Con Edison substation, Long Island City. Caleb talks past the guards as a city inspector (Trust 6+ lets Jade feed him the jargon through his earpiece; below that Jade slips in the side gate). Two-factor: key card from a guard's belt + passphrase from the maintenance log - Jade's own words, "Trust the system, but verify the people." Timed puzzle: reroute the load across three feeders (total 100, no feeder over 60) before the logic bomb trips. Failure is a partial blackout and the game continues. Discovery: a manifesto addressed to Jade by name.
3. **The Verrazzano** - bridge upper deck at night. Climb the maintenance catwalk in the wind, cross the cut-out gap (Trust climax: three dialogue options, each a different ending path), face Derrick Shaw and talk him into putting down the detonator. Act II end card records Trust, Integrity, evidence, water choice, bomb outcome and bridge path.
Derrick and the two guards reuse Caleb's CC0 scan with recoloured coats (grey for Derrick, dark for the guards), cap and badge removed in code.

## Act III - The Human Signal (added 2026-11-10)
Act II's end card links to `act3.html`. Trust, System Integrity, evidence, water choice, bomb outcome and the Act II bridge path carry over from Act II via localStorage (defaults apply when played standalone). Six chapters:
1. **The Control Center** - MTA Rail Control, 4 AM, 36 hours after the blackout. A dormant virus in the Emergency Broadcast System triggers in 12 hours (fake all-clear, then fake evacuation). The FINAL SEALED CHOICE: A Quick Fix (always open), B Rebuild (needs Trust 8+ and 4 evidence pieces), C The Third Way (needs Trust 10, the trust dialogue at the bridge, and all 5 evidence pieces) - locked options are named with what they need. The choice stays sealed until the end card, like Act I.
2. **The Courtroom** - Judge Ellsworth: 90 days, credit for time served, probation 2 years, 400 hours public service with the infrastructure oversight committee. Nurse Adeyemi in the gallery: the hospital and the dialysis clinic are both fine, because of you.
3. **The Transport Van + The Escape** - the van stops, the doors are ripped open, Derrick's friends break you out; rooftop, fire escape, black SUV.
4. **The Safehouse** - Owen Marsh and the ex-city workers: the files, the witnesses, the evidence map; the plan is the Attorney General's press conference, 9 AM.
5. **The Press Conference** - Jade takes the podium, slams the folder down, the AG picks it up: "This better be good." / "It's the truth."
6. **The Aftermath + The Bridge** - one month later, Jade Director of Infrastructure Oversight, Caleb's badge restored, dawn on the Williamsburg Bridge, the 4 train crossing. The sealed choice is revealed as Ending A "The System Holds", B "The Human Signal", or C "The Last Signal" (best ending).
Derrick, the judge, Owen, the AG, the MTA official and the masked leader reuse Caleb's CC0 scan with recoloured coats, cap and badge removed in code. Nurse Adeyemi's own model appears in the courtroom gallery.

## Files
- `index.html` - Act I page (end card links to Act II)
- `act2.html` + `act2.js` - Act II page and code (valve-balance modal, SCADA reroute modal, bridge climb)
- `act3.html` + `act3.js` - Act III page and code (control center sealed choice, courtroom, escape, safehouse, press conference, dawn bridge)
- `styles.css` - dark cinematic UI
- `game.js` - Three.js scene, gameplay loop, dialogue, repair puzzle, sealed choice, GLB character loading
- `three.module.js` - vendored Three.js r160 (ESM); `three.min.js` is the old UMD build and is no longer loaded
- `vendor/loaders/GLTFLoader.js` + `vendor/utils/BufferGeometryUtils.js` - vendored r160 loader for the GLB models
- `models/jade.glb`, `models/caleb.glb`, `models/adeyemi.glb`, `models/walter.glb` - CC0 scanned human models, about 11 MB total
- `README.md` - this file

## Zama FHEVM integration (added 2026-11-11)

The two sealed choices are real FHEVM-encrypted choices on Sepolia, following the Sealed Fortune pattern exactly (same `@fhevm/solidity` 0.11, same `@fhevm/hardhat-plugin` 0.4.2 mock tests, same `@zama-fhe/relayer-sdk` 0.4.1 browser flow).

**What is encrypted.** Act I priority power as an `euint8` (0 = Hospital, 1 = Residential, 2 = Industrial) and the Act III final fix as an `euint8` (0 = Quick Fix, 1 = Rebuild, 2 = Third Way). Both are stored per player address in `contracts/LastSignalSealedChoice.sol`. `sealPriorityPower()` and `sealFinalChoice()` each allow one seal per player. `revealChoices(player)` is callable by anyone once both choices are sealed; it makes both publicly decryptable and emits `ChoicesRevealed`. Before reveal, public decryption is impossible.

**Two modes.** Demo mode is the default: no wallet needed, the choices are simulated locally exactly as before, and the HUD badge reads "DEMO MODE - choices sealed locally". Sepolia mode starts when a wallet is connected (the "Connect wallet (Sepolia)" button in the HUD): the choice is ALSO encrypted in the browser with the Relayer SDK and sealed on-chain, in the background, without ever blocking a dialogue. The local simulation stays the source of truth for gameplay, so a failed seal (wallet rejected, no gas) never breaks the game - the status line says so plainly. The Act III end card has a "Reveal sealed choices on Sepolia" button that appears only when both choices are sealed on-chain; it calls `revealChoices()` and decrypts both with the Relayer SDK, showing the plaintext picks next to the ending.

**Files.** `contracts/LastSignalSealedChoice.sol`, `test/LastSignalSealedChoice.test.ts` (9 tests, mocked FHEVM, including a seal-and-reveal round-trip that decrypts to exactly the numbers picked), `deploy/deploy.ts`, `hardhat.config.ts`, `package.json`, `tsconfig.json`, `zama.js` (shared Sepolia module, imported by `game.js` and `act3.js`), `zama-config.js` (contract address `0x9eE62DA6f26Ef3E6D275DaFAE2E4b3f8DC661d10`, filled in after the 2026-11-11 deploy), `zama-abi.js`, `vendor/ethers.umd.min.js` + `vendor/relayer-sdk-js.js` + `vendor/*.wasm` (vendored from Sealed Fortune). `node_modules` is a symlink to the Sealed Fortune project's `node_modules`, so both projects use the exact same toolchain versions.

**Build and test (local only).**
```
npm run compile   # npx hardhat compile
npm test          # npx hardhat test - 9 passing
```

**Deploy to Sepolia (done 2026-11-11).**
- Redeployed fresh: `LastSignalSealedChoice` at `0x9eE62DA6f26Ef3E6D275DaFAE2E4b3f8DC661d10` on Sepolia, 2026-11-11 21:09 WAT (forced fresh deploy; the first deploy that day, 0x1504E234eab90BF383f64691BB7117da317740bC, is abandoned).
- Deploy tx: `0x35fb6760a55b10e68ab0d5e76a5fde3cc5a36dd1073e94f7add3c7cd42a244e3`. Note: Etherscan checked 2026-11-21 - the address hosts the contract (bytecode present, seal-logic revert strings match `LastSignalSealedChoice`); the source code is not yet verified on Etherscan (optional, step 6).
- Deployer: the same wallet used for Sealed Fortune, `0x41381f0d4f88b8954650ddf7b2607c89430a0e0a` (balance was 0.0351 Sepolia ETH before the redeploy, no faucet top-up needed; 6,100,454 gas).
- The address is in `zama-config.js` and pushed to GitHub Pages (step 4 below), so the live site runs with the Sepolia contract configured.
- Sepolia ETH in the deploy wallet came from the Sepolia faucet; top up from a faucet again if the balance is too low for gas.
- Wallet access: the deploy needed the deploy wallet's private key as the `PRIVATE_KEY` env var at deploy time only. It is never committed and never stored in this repo.
- Deploy command used: `PRIVATE_KEY=... npm run deploy:sepolia` (add `INFURA_API_KEY=...` or it falls back to the public Sepolia RPC).
4. Push the updated `zama-config.js` (and all game + FHE files) to GitHub Pages as usual. The HUD badge will switch to "SEPOLIA" once a wallet connects. **Done - verified live 2026-11-19 19:19 UTC: the live Pages copy of `zama-config.js` shows `CONTRACT_ADDRESS: "0x9eE62DA6f26Ef3E6D275DaFAE2E4b3f8DC661d10"`.**
5. Play Acts I-III with the same wallet in all three acts, so both choices land under one player address. On the Act III end card, press "Reveal sealed choices on Sepolia" to decrypt and show the on-chain record. **Not yet verified live on Sepolia.**
6. Optional: verify the contract on Etherscan with `ETHERSCAN_API_KEY=... npx hardhat verify --network sepolia <address>`.
