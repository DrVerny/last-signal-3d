# Vehicle models

CC0 public-domain vehicle models used by THE LAST SIGNAL. Same licence
as the Quaternius people models already in the game (see
models/rigged/SOURCES.md). No other game's assets, logos, or names.

## sports-car.glb

- Model: "Sports Car" by Quaternius, CC0.
- Source page: https://poly.pizza/m/1mkmFkAz5v
- Direct file: https://static.poly.pizza/34db1344-31cc-49ac-bc46-c055f68e39ca.glb
- Size: 175 KB. 3,148 triangles, 4 meshes.
- Materials: White (body paint), Windows, Grey (lower trim), Headlights,
  TailLights, Black (tyres).
- Wheels: separate nodes (BackWheels, FrontLeftWheel, FrontRightWheel).
- Bounding box: 1.72 wide x 1.19 tall x 3.93 long. Front at +z
  (headlights at z 1.62 to 1.78, taillights at z -1.88 to -1.75).
- Used by: player.js buildModelM4 (the BMW M4, the driving car). The
  model is repainted in the equipped car's colour, its windows are made
  semi-transparent, and the M4 details (kidney grille, spoiler, quad
  exhausts, mirrors, steering wheel, dashboard) are added procedurally.
- If the model fails to load, player.js falls back to the procedural M4
  (an extruded side profile), so the game never waits on a download.

## The van

The van is built procedurally in player.js (extruded side profile with
a sloped nose, bevelled edges, blue-tinted windows, sliding-door outline,
handles, roof rails, alloy wheels). No downloaded van model is used:
the Quaternius van is only sold as part of the Ultimate Vehicles pack,
and the freely available van models are CC-BY (attribution), not CC0.
The van is plain grey with blue windows, no logo and no text.
