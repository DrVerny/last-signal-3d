# Rigged characters for THE LAST SIGNAL — sources

Replaces the 4 static Innerscene scans (no skeleton, no joints) with rigged
humans that have a real skeleton and an embedded Walk animation, so arms
swing from the shoulder, elbows bend, and legs step with knees bending.

## What was obtained

All files are GLB (glTF 2.0), self-contained (no external textures), and
under 2.5 MB. Every file has a full skeleton and an embedded **Walk** clip.

| File | Role | Source character | Size | Joints | Clips | Walk |
|---|---|---|---|---|---|---|
| `jade-rigged.glb` | Jade (woman) | Quaternius "Casual Female" | 1,759,956 B | 23 | 17 | Walk (69 channels) + Walk_Carry |
| `caleb-rigged.glb` | Caleb (man, officer) | Quaternius "BlueSoldier Male" | 1,587,212 B | 23 | 17 | Walk (69 channels) + Walk_Carry |
| `nurse-rigged.glb` | Nurse Adeyemi (woman) | Quaternius "Characters Lis" | 1,055,192 B | 43 | 20 | Walk (82 channels) + Walk_Gun |
| `walter-rigged.glb` | Walter (older seated man) | Quaternius "Characters Sam" | 1,075,560 B | 43 | 20 | Walk (82 channels) + Walk_Gun |
| `caleb-alt-civilian.glb` | Alternate for Caleb | Quaternius "Characters Matt" | 1,009,608 B | 43 | 20 | Walk (82 channels) + Walk_Gun |
| `walter-alt.glb` | Alternate for Walter | Quaternius "Characters Shaun" | 1,157,488 B | 43 | 20 | Walk (82 channels) + Walk_Gun |
| `player-rigged.glb` | The player (young man) | Quaternius "Casual Male" | 1,752,060 B | 23 | 17 | Walk (69 channels) + Walk_Carry |

## The player model (why Casual Male, not Shaun)

The player must be a young civilian man, distinct from Caleb (Matt) and
Walter (Sam, older). The on-disk male models were rendered and inspected
before choosing:

- `caleb-alt-civilian.glb` (Matt) is a young man with dark hair, but he IS
  Caleb, so the player must not use him.
- `walter-alt.glb` (Shaun) reads as a bearded older survivor: a big red
  beard and moustache, a beanie, a vest over a green shirt, blue shorts
  and sandals. Not a young guy. Rejected.
- `walter-rigged.glb` (Sam) is Walter, the older man. Rejected.
- `caleb-rigged.glb` (BlueSoldier) is a soldier in blue. Rejected.
- `player-rigged.glb` (Casual Male, Ultimate Animated Characters) is a
  young civilian man with short dark hair, a navy shirt and dark trousers.
  It is the male counterpart of Jade's Casual Female, with the same
  23-joint rig, the same Walk/Idle clips, and the same separate
  materials per part (Skin, Face, Hair, Shirt, Pants, Belt), so the
  shirt can be tinted with the equipped clothes colour and the skin
  with a realistic brown tone. Downloaded 2026-11-15 from the same
  Cinevva CC0 source as the other files, 1,752,060 B, valid glTF 2.0,
  no weapon props to strip, no re-compression.

Yes, all of them. The joint list includes, for every file:

- Spine: `Hips`, `Abdomen`, `Torso`, `Neck`, `Head`
- Arms: `ShoulderL/R`, `UpperArmL/R`, `LowerArmL/R` (elbow), `FistL/R`
  (hands; the 43-joint files also have full finger bones)
- Legs: `UpperLegL/R`, `LowerLegL/R` (knee), `FootL/R`
- Plus `PoleTargetL/R` (IK helpers)

23-joint files (`jade`, `caleb`) are the Ultimate Animated Characters rig.
43-joint files (`nurse`, `walter`, alternates) are the zombie-apocalypse-kit
rig, which adds finger bones. Both rigs animate with the same Walk clip
names, so the game can play `Walk` on any of them.

## Walk animation

Embedded in every file — no separate walk file is needed. Use the plain
`Walk` clip. Do NOT use `Walk_Gun` (walk while holding a gun) or
`Walk_Carry` (walk while carrying) unless the scene calls for it.

Note: the Quaternius Walk clips are travelling walks (the root moves
forward). The game moves characters by translating the group, so the
integrator should either play the clip and let the root motion drive the
patrol, or counter the root motion and keep translating the group as it
does now. This was not changed here — no game code was modified.

## Sources and licence

- **Direct download:** `https://cdn.cinevva.com/assets/packs/quaternius/...`
  (no account, no login, no payment). The files were downloaded from
  Cinevva's free character library, which hosts Quaternius packs as
  single-GLB downloads:
  - `jade-rigged.glb` — `.../ultimate-animated-characters/Casual_Female.glb`
  - `caleb-rigged.glb` — `.../ultimate-animated-characters/BlueSoldier_Male.glb`
  - `nurse-rigged.glb` — `.../zombie-apocalypse-kit/Characters_Lis.glb`
  - `walter-rigged.glb` — `.../zombie-apocalypse-kit/Characters_Sam.glb`
  - `caleb-alt-civilian.glb` — `.../zombie-apocalypse-kit/Characters_Matt.glb`
  - `walter-alt.glb` — `.../zombie-apocalypse-kit/Characters_Shaun.glb`
  - `player-rigged.glb` — `.../ultimate-animated-characters/Casual_Male.glb`
  - Library page: `https://app.cinevva.com/game-assets/free-3d-character-models`
- **Author:** Quaternius (quaternius.com), from the "Ultimate Animated
  Characters" and "Zombie Apocalypse Kit" packs.
- **Licence:** Cinevva lists every file on that page as **CC0** (public
  domain — commercial use, modification, no attribution required).
  One nuance to be aware of: Quaternius's own site now also publishes a
  "Quaternius Asset Licence (QAL v1.0)" which permits free use in
  personal, educational and commercial projects including games, with no
  attribution, but says the assets themselves may not be resold or
  redistributed as a standalone pack/stock file/template. Using them
  inside the game is permitted under both readings. Because the game repo
  is public on GitHub, the GLB files would be downloadable from the repo
  as standalone files — under a strict QAL reading that is the one thing
  to be careful about; under the CC0 listing it is fine.
- **No Mixamo files were used.** Mixamo downloads require an Adobe
  login, and no public mirror of realistic Mixamo human characters was
  found (the one GitHub mirror found, `iru97/meshmotion.es`, hosts only
  the X-Bot/Y-Bot robots, which the brief excludes). The Quaternius CC0
  route above was used instead.

## Conversion / cleanup done

The `Characters Lis / Matt / Sam / Shaun` files ship with 10 weapon prop
meshes parented to the left hand (`Axe`, `Guitar`, `Knife`, `Pistol`,
`Rifle`, `Shotgun`, `SMG`, `Spear`, `WoodenBat_Barbed`,
`WoodenBat_Saw`; Lis also had a `Shoulder` prop). They are visible by
default, so the characters would have carried a stack of weapons. Those
prop nodes were removed and the files re-saved. The skeleton, skin
weights and all 20 animation clips are untouched.

Tool: `@gltf-transform/core` + `@gltf-transform/functions`
(installed in `/tmp/gltf-tools`, not in the game repo). Script:
`/tmp/gltf-tools/strip_props.mjs` — loads each GLB, detaches and
disposes every node whose name is one of the prop names above, runs
`prune()`, and writes the cleaned GLB. Exact command:

```sh
cd /tmp/gltf-tools && node strip_props.mjs
```

`jade-rigged.glb` and `caleb-rigged.glb` needed no cleanup (the Ultimate
Animated Characters files have no weapon props) — they are straight
copies of the downloads, renamed. No file was re-compressed or
re-scaled; sizes above are the as-downloaded / as-stripped sizes.

## Verification done

Each file was parsed as GLB (magic `glTF`, version 2) and inspected
with a Node script that reads the JSON chunk (`/tmp/inspect_glb.mjs`,
`/tmp/check_imgs.mjs`):

- Valid glTF 2.0, correct file sizes, no external image URIs.
- Skeleton joints confirmed (23 or 43, see table) including shoulder,
  elbow, hip, knee and foot joints.
- `Walk` clip present in every file with real keyframe channels
  (69 channels on the 23-joint rigs, 82 on the 43-joint rigs).
- After prop-stripping, the skeleton and all 20 clips are intact
  (joint count and Walk channel count unchanged).

## Things the integrator (game code) must know

These are notes, not changes — no game code was modified in this task.

- **No teeth mesh.** The current `lipsync.js` builds a jaw morph from a
  separate teeth mesh in the scans. These rigged models have no teeth
  mesh, so that jaw morph will not work on them. Lip-sync will need a
  different approach (e.g. a small head nod/bob while speaking, or a
  morph on the head mesh).
- **Outfits differ from the scans.** `jade` is a casual civilian woman
  (not a signal engineer in a jacket); `nurse` is a civilian woman (not
  in scrubs — recolour in code if scrubs matter); `caleb` is a soldier
  in blue (reads as an officer, but check whether his helmet/vest
  clashes with the cap + badge the code adds — the civilian alternate
  `caleb-alt-civilian.glb` (Matt, plain clothes) is there if it does);
  `walter` is a plain civilian man (not visibly older — no older-man
  model was available in these packs; he is seated, so age reads less).
- **Heights vary.** Rendered heights are roughly 1.5–1.9 m depending on
  the file (the Ultimate Animated files carry a `__fit` scale node).
  The game already normalises height to a target with a bounding box,
  so keep doing that per character.
- **Walk is a travelling clip** (root moves forward) — see "Walk
  animation" above.
- **Style change.** These are low-poly stylised humans, not the
  photorealistic scans. That is the trade the user accepted: real
  joints and a real walk cycle, less realism.
