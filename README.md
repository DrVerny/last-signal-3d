# THE LAST SIGNAL - Act I: The 4 Train (3D Prototype)

**Tagline:** "Repair is a moral act."
**Author:** Moshood Sodiq Olasunkanmi (DrVerny / @verrnny)
**Proposed GitHub repo:** `last-signal-3d`

A playable 3D browser prototype of Act I of the narrative thriller **THE LAST SIGNAL** - a New York City infrastructure drama from a DeepSeek game script (shared chat, 2026-11-10). Short original dialogue in the same spirit; no long dialogue copied verbatim.

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
- **Dialogue:** click Continue, or pick a choice button - choices move the Trust Meter

## What works
- 3D subway car interior at night: seats, poles, doors, windows, dark platform outside
- Blackout: lights flicker and die, red emergency strips take over, 15:00 battery timer ticks down
- Inspect system (raycast clicking, highlighted interactive objects)
- Repair mini-game: match the 4x4 gold circuit pattern to restore power
- Lead: count passengers, help Walter Simms (cannot climb stairs) - moral choice, no wrong answer
- Trust Meter Jade-Caleb (0-10, starts at 3), dialogue choices raise/lower it
- System Integrity Tracker: Transit / Water / Power / Communications bars, choices affect them
- **Sealed choice (Zama twist):** pick which line gets priority power - Hospital / Residential / Industrial. The choice is hidden until the end of Act I, then revealed on the title card. In this prototype the sealing is simulated locally; on Sepolia it would be an FHEVM `euint32` (exactly like Sealed Fortune: encrypted input, computed on encrypted data, revealed only after a deadline)
- Endings: reach the platform, find the RESET board, title card "THE LAST SIGNAL" with your Trust / Integrity / sealed-choice summary
- HUD: Trust, battery timer, System Integrity, objectives, inventory (RESET circuit board)

## Visual style - photoreal / real-life look
ACESFilmicToneMapping with sRGB output, PCFSoft shadows, cool-white fluorescent key light plus red emergency and dim warm battery lighting, FogExp2 tunnel haze, 320 drifting dust motes, faint additive light shafts, PBR materials (brushed steel poles, worn fabric seats, scuffed floor, grime canvas textures), procedural posters and signage (4 train, Bronx Zoo, "Stand clear of the closing doors", 14 St-Union Sq), slight handheld camera sway, CSS vignette, animated film grain, and a Cinema button that toggles letterbox bars. No external assets: all textures are generated in code. Still stylised, not true photorealism: low-poly figures, flat poster art, and simulated (not ray-traced) lighting.

## What is NOT included
- Acts II and III (Delaware Aqueduct, Con Edison substation, Verrazzano Bridge, courtroom, press conference) - Act I only
- The full 16-scene script - this is a playable slice, not the whole story
- Multiplayer
- **Live-stream audience voting** - not built yet. How it could work later: viewers vote in chat (e.g. `!hospital` / `!residential` / `!industrial`); votes are collected as the sealed choice, encrypted, and revealed live at the end of the act - the audience's choice changes the ending, but nobody sees the tally until reveal
- Real FHEVM contract - no contract is deployed in this prototype; the Zama layer is a clearly-labelled simulation, ready to be wired to Sepolia like Sealed Fortune

## Files
- `index.html` - page, HUD, dialogue box, repair modal, end card
- `styles.css` - dark cinematic UI
- `game.js` - Three.js scene, gameplay loop, dialogue, repair puzzle, sealed choice
- `three.min.js` - vendored Three.js r160
- `README.md` - this file
