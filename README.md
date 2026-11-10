# THE LAST SIGNAL - Act I: The 4 Train (3D Prototype)

**Tagline:** “Repair is a moral act.”
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
- 3D subway car interior at night: R160/R211-style car, 3.0 m wide, 15 m long, arched roof (apex 3.15 m), tapered ends with centre doors/windows, longitudinal benches with individual contoured fabric cushions, tilted backs, front rolls and steel dividers (20 seats), brushed-steel poles, handrails and hand straps, sliding doors with windows on both sides, framed windows onto a dark tunnel with passing lights, strip maps, route map, ads and "Stand clear" signs, emergency intercom, anti-slip worn floor with yellow door thresholds
- Blackout: lights flicker and die, red emergency strips take over, 15:00 battery timer ticks down
- Inspect system (raycast clicking, highlighted interactive objects)
- Repair mini-game: match the 4×4 gold circuit pattern to restore power
- Lead: count passengers, help Walter Simms (cannot climb stairs) - moral choice, no wrong answer
- Trust Meter Jade↔Caleb (0-10, starts at 3), dialogue choices raise/lower it
- System Integrity Tracker: Transit / Water / Power / Communications bars, choices affect them
- **Sealed choice (Zama twist):** pick which line gets priority power - Hospital / Residential / Industrial. The choice is hidden until the end of Act I, then revealed on the title card. In this prototype the sealing is simulated locally; on Sepolia it would be an FHEVM `euint32` (exactly like Sealed Fortune: encrypted input, computed on encrypted data, revealed only after a deadline)
- Endings: reach the platform, find the RESET board, title card “THE LAST SIGNAL” with your Trust / Integrity / sealed-choice summary
- HUD: Trust, battery timer, System Integrity, objectives, inventory (RESET circuit board)

## Visual style - high-fidelity photorealism
ACESFilmicToneMapping with sRGB output, exposure 1.25, PCFSoft shadows, cool-white fluorescent key light plus red emergency and dim warm battery lighting, FogExp2 tunnel haze that thickens in blackout, 320 drifting dust motes plus 180 dust motes concentrated inside the light beams, volumetric light shafts (layered additive cones with a vertical gradient alpha texture, bright at the tube and fading to the floor), god-ray style glow halos around the fluorescent tubes and emergency lights, additive light pools on the floor under each tube, flicker with realistic falloff, bounce fill from hemisphere and ambient light, contact shadows (soft dark blobs) grounding every character and bench, PBR materials with a procedural environment cube map for reflections on steel, bump maps and roughness maps from canvas noise (scuffed floor, fabric weave on seats, brushed steel poles), procedural posters and signage (4 train, Bronx Zoo, "Stand clear of the closing doors", 14 St-Union Sq), slight handheld camera sway, CSS vignette, animated film grain, and a Cinema button that toggles letterbox bars. Pixel ratio is capped at 2, geometries and materials are reused, and the animation loop makes no per-frame allocations. No external assets: all textures are generated in code. Still not true photorealism (see below).

## Train realism - what was wrong, what changed (2026-11-10 overhaul)
Before: the car was a plain 6 m wide, 3 m tall flat box (flat ceiling, vertical walls, flat end walls) with single 1.2 x 0.5 x 2 m blue boxes for benches - twice the width of a real subway car, with no curve, no seat shape and no reflections that read as steel. That is what made it look fake.
Now, procedural only, no external assets: the shell is a real R160/R211 cross-section (3.0 m wide, 15 m long, vertical lower walls to 1.9 m, then an extruded arched roof to 3.15 m apex, tapered end corners, arched end walls with a centre door and window), and the seats are 20 individual contoured seats (0.46 m wide, 0.45 m seat height, 0.44 m depth, fabric cushion with moquette weave and stitch seams, rounded front roll, backrest tilted 12 degrees with a top rail, steel divider between neighbours, steel plinth underneath) in two longitudinal bench sections per side, either side of the centre doors. Walter sits on the rear left bench at seat centre (x -1.18, z 4.5), so his seated scan lines up with a real bench cushion. Added at the same time: brushed-stainless canvas texture (horizontal streaks, used as map/bump/roughness) for poles, doors and kick plates, MeshPhysicalMaterial glass with clearcoat for door and side windows, anti-slip speckled floor texture with a worn centre aisle and yellow tactile strips, ceiling panels with seams and recessed fluorescent housings, wall seams and rivets, hand straps, strip maps (green 4 line with stations) and a route-map poster, an emergency intercom, door pockets, and a dark tunnel outside with 10 passing light strips that stream past the windows while the train is moving (intro stage) and freeze at the blackout. Gameplay, dialogue, Trust Meter, repair mini-game, sealed choice, timer and controls are unchanged; character, door, relay, panel and board positions were moved onto the new 3.0 m walls, and camera movement is clamped to the narrower aisle (x +-1.05).

## Human characters - scanned 3D people (CC0, Innerscene / MakeHuman)
Real scanned figures, not procedural geometry: `models/jade.glb` (Riley, woman, 1.672 m, short dark hair, teal T-shirt, jeans), `models/caleb.glb` (Daniel, man, 1.795 m, dark hair, olive jacket recoloured navy in code), `models/adeyemi.glb` (professional nurse, teal scrubs, stethoscope, ponytail, 1.644 m), `models/walter.glb` (Rowan, older man, grey hair, seated on a bench, 1.30 m seated height). All four are CC0 (public domain) from the Innerscene / MakeHuman library. The game loads them with the vendored Three.js r160 GLTFLoader, normalises each to its story height (Jade 1.70 m, Caleb 1.88 m, Adeyemi 1.68 m, Walter unscaled at 1.00), re-grounds feet at y=0, and keeps click-to-inspect on each model group. Walter's bench from his file is hidden (the car already has benches); Caleb gets a simple navy cap and a gold badge disc in code, since the scan has neither. The models are static scans (no skeleton, no animations), so idle motion is a subtle whole-group breathing scale only - no head turns, no blinking, and Adeyemi's lean toward Walter is not applied. **Repo size note:** the four models total about 89 MB (Jade 21 MB, Caleb 27 MB, Adeyemi 16 MB, Walter 26 MB), so the repo is large and the game shows a loading screen until the characters load, with a clear error and a "continue without them" option if any model fails. Three.js is vendored locally (`three.module.js` r160 + `vendor/loaders/GLTFLoader.js` + `vendor/utils/BufferGeometryUtils.js`, import-map ESM) - no CDN needed. Still not true photorealism: lighting is simulated (not ray-traced), and the scans are static, so there is no facial animation or cloth movement.

## What is NOT included
- Act III (control center, courtroom, press conference) - Acts I and II only
- The full 16-scene script - this is a playable slice, not the whole story
- Multiplayer
- **Live-stream audience voting** - not built yet. How it could work later: viewers vote in chat (e.g. `!hospital` / `!residential` / `!industrial`); votes are collected as the sealed choice, encrypted, and revealed live at the end of the act - the audience's choice changes the ending, but nobody sees the tally until reveal
- Real FHEVM contract - no contract is deployed in this prototype; the Zama layer is a clearly-labelled simulation, ready to be wired to Sepolia like Sealed Fortune

## Act II - City of Wires (added 2026-11-10)
Act I's end card links to `act2.html`. Trust, System Integrity, the sealed choice and the RESET board carry over from Act I via localStorage (defaults apply when played standalone). Three missions, one per script location:
1. **The Delaware Line** - Rondout Reservoir control station at 6 AM. Balance Hospital / Residential / Industrial pressure to 70% or more while the sabotaged digital control overcorrects a valve every few seconds (if Trust is 7+, Caleb holds the Industrial valve by radio). Then the moral choice: one line runs reduced for 2 hours. Discovery: a second RESET device with a fingerprint - Derrick Shaw.
2. **The Grid** - Con Edison substation, Long Island City. Caleb talks past the guards as a city inspector (Trust 6+ lets Jade feed him the jargon through his earpiece; below that Jade slips in the side gate). Two-factor: key card from a guard's belt + passphrase from the maintenance log - Jade's own words, "Trust the system, but verify the people." Timed puzzle: reroute the load across three feeders (total 100, no feeder over 60) before the logic bomb trips. Failure is a partial blackout and the game continues. Discovery: a manifesto addressed to Jade by name.
3. **The Verrazzano** - bridge upper deck at night. Climb the maintenance catwalk in the wind, cross the cut-out gap (Trust climax: three dialogue options, each a different ending path), face Derrick Shaw and talk him into putting down the detonator. Act II end card records Trust, Integrity, evidence, water choice, bomb outcome and bridge path.
Derrick and the two guards reuse Caleb's CC0 scan with recoloured coats (grey for Derrick, dark for the guards), cap and badge removed in code.

## Files
- `index.html` - Act I page (end card links to Act II)
- `act2.html` + `act2.js` - Act II page and code (valve-balance modal, SCADA reroute modal, bridge climb)
- `styles.css` - dark cinematic UI
- `game.js` - Three.js scene, gameplay loop, dialogue, repair puzzle, sealed choice, GLB character loading
- `three.module.js` - vendored Three.js r160 (ESM); `three.min.js` is the old UMD build and is no longer loaded
- `vendor/loaders/GLTFLoader.js` + `vendor/utils/BufferGeometryUtils.js` - vendored r160 loader for the GLB models
- `models/jade.glb`, `models/caleb.glb`, `models/adeyemi.glb`, `models/walter.glb` - CC0 scanned human models, about 89 MB total
- `README.md` - this file
