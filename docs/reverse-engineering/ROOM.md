# ROOM.md — first Miitomo room (M7, 2026-10-25)

Classification: **VERIFIED** = reproduced and checked in the browser against data/binary · **REVERSED** = read from binary/data and implemented as found · **DEDUCED** = inferred from strong indirect evidence · **APPROXIMATED** = placeholder / best guess.

## Files (all MD5-verified against manifest.json, kept in `local-assets/`, never in the repo)
| File | Source | MD5 | Content |
|---|---|---|---|
| asset_model_room_roomBaseComponents.zip | CDN | c23a9b06… | roomBase00 / roomBase01 (POD + Mdl_model.xml + Mdl_scene.xml + 33 ETC1 textures), doorAnim/doorAnimOpen + doorAnimClose |
| asset_layout_v2-0_room_Published-iOS.zip | CDN | 07d74870… | room UI (CocosBuilder .ccbi), not used yet |
| rmWl0000, rmFl0000 | **APK** (reference room) + CDN | 909741…, ad169f… | Mdl_room.xml + textures. APK and CDN contents identical file by file (only the zip containers differ) — VERIFIED |
| rmWl0010, rmFl0010 | CDN | b2ff02…, c39efa… | second skin (flower wallpaper, grass floor) |
| asset_model_character_animation_output.zip | already present | a38d7caa… | 304 clips |

## Structure
| Topic | Status | Notes |
|---|---|---|
| Geometry | VERIFIED | roomBase00.Mdl.pod: 60 rigid meshes, all with baked vertex colours (ABGR, 0.45–1.0; shadow quads have alpha 0–0.4). Hierarchy roomRoot → ZMinus (wall, door, doorKnob, doorFrame, shadow), XPlus/ZPlus/XMinus walls, YPlus ceiling, YMinus floor, dec (entrance corridor), furniture (shelf+29 books, photostand, plant1/2, chest, lamp+switch, cushions). Box 68 × 34 × 68; same units as the body (POD Units 0.01) → the Mii goes in at scale 1. |
| Materials | VERIFIED (data) | Mdl_model.xml, LUT shader, per-material LUTs, culling (plants None), mtCmnShadow Xlu GL_SRC_ALPHA/GL_ONE_MINUS_SRC_ALPHA with uAlphaTexture enabled but no file. |
| Feature bits | REVERSED | Define table 0x1b7503c (bit 0 VERTEX_COLOR, 1 ALBEDO, 2 BUMP, 3 MASK, 4 ALPHA, 5 SPHERE_MAP, 6 SKIN_MASK, 7 HAIR_MASK, 8 ALPHA_TEST, 9 FADE_OUT, 10 DISABLE_LIGHT, 11 PREMULTIPLY, 12 ALPHA_COLOR_FILTER, 13 ALBEDO_ALPHA, 14+ MII…), expanded by 0x58fce4. |
| VERTEX_COLOR when the mesh has colours | DEDUCED | Where the bit is set was not traced. Without it the shadow quads would be opaque, so the rule is consistent with the data. |
| Missing texture → white | DEDUCED | Needed by uAlphaTexture with no file. Other samplers whose file is missing (rmWl00_NRM/MSK, rmFl00_NRM/MSK, rmCl00_*) are switched off. |
| No SKIN_MASK in the room | DEDUCED | The room MSK textures are not skin masks. |
| Room skin | VERIFIED (data) + DEDUCED (mapping) | Mdl_room.xml lists per material ("Wall", "Ceiling", "Door", "Floor") the albedo files (several = variants AL00–AL03) plus Door MSK/NRM. Name → mesh material mapping (Wall→mtRmWl00, Ceiling→mtRmCl00, Door→mtRmDr00, Floor→mtRmFl00) is DEDUCED. The binary also has thumbnail paths `room/roomWall/rmWl%04d_AL%02d.webp`, which confirms the id+variant scheme. |
| Lights | VERIFIED (data) | roomBase00.Mdl_scene.xml ("room0006.Mdl"): hemi sky 0.6/0.549/0.455 ×1.5, ground 0.6/0.545/0.424 ×1.2, directional 0.51/0.502/0.478 ×1.2 dir (0.77, 0.8, 0.59), fill ×0.3, 2 light sets. Brighter and warmer than default_scene.xml. roomBase01 differs slightly. Using these lights for the Mii as well inside the room is DEDUCED. |
| Camera | VERIFIED (data) + DEDUCED (convention) | The doorAnim PODs contain a camera block (CamFOV 0.6606 rad = 37.85°, near 0.1, far 1e4) on node `persp`, position (2.706, 30.781, 60.583) outside the front wall (dollhouse view: inward-facing walls are culled from behind). DEDUCED: forward = −Y column, up = −Z column of the node matrix (the only orientation that looks into the room; it aims at (2.5, 19.5, 0)), and FOV = vertical (cocos2d fovY). The portrait view matches the expected Miitomo framing. |
| Camera near/far | APPROXIMATED | 1/400 instead of 0.1/1e4 to keep depth precision. |
| RoomMainLayer camera fields | not reversed | mCameraEyePt / mCameraLookAt / mCameraDirInTouchScene exist (save-state keys). The code that moves the camera when the Mii is touched is not reversed. |
| Door | VERIFIED (data) | doorAnimOpen/Close: 21 frames, node `doorAnim` (parent of door + doorKnob). It opens outwards into the corridor, about 85° around the left hinge. |
| Entrance | REVERSED (clip names) + APPROXIMATED (path) | The binary names `animActionAppearFall` / `animActionAppearLanding` (Mii appearance). The door path is APPROXIMATED: corridor (0,0,−47) → in front of the door (0,0,−27) → spawn (0,0,−6) → close → wave. |
| Movement | APPROXIMATED / DEDUCED | WalkClone / RunClone have no root motion (Skl_Root fixed), so the game moves the Mii in code (RoomMainLayer mGoToTouch*MiiPosition: not reversed). Speed is DEDUCED from the walk cycle on the scaled skeleton: 2 × stance-foot travel per cycle = 6.14 u/s for the fixture. Turn rate 9 rad/s and 0.2 s cross-fade are APPROXIMATED. Walkable area = walls − 3 u, furniture footprints from mesh bounds. |
| Clips used | VERIFIED playback | WaitFemale/WaitMale (idle), WalkClone, HandWaveLIn → HandWaveL → HandWaveLOut (transition In/loop/Out), ActionStroked (touch reaction), ActionAppearFall → ActionAppearLanding. Other candidates: RunClone, ActionPress, ActionCheckTheBox, JumpHandUp, FootStep*In/Out, *DL_* idles. |

## Interaction (offline)
Click on the floor → walk; click on the door → exit (walk → door opens → into the corridor → door closes) or enter; click on the Mii → ActionStroked; click on furniture → walk in front of it. Keyboard: arrows/WASD to move, E door, Space wave. Cameras: Originale (data), Segui (APPROXIMATED), Libera (debug orbit).

## M8 — playable loop (2026-10-25)
Full write-up in **LOOP.md**. Summary of what changed in the room:
| Topic | Status | Notes |
|---|---|---|
| State machine | APPROXIMATED (design) | outside / entering / idle / walking / interacting / reacting / exiting with an explicit transition table (`TRANSITIONS` in RoomDirector.ts). Illegal transitions are refused and logged in `violations` (the test requires 0). |
| Touch | REVERSED (clip + sound) / DEDUCED (flow) | Tap interrupts a walk, the Mii turns to the viewer, plays animActionStroked, se_nade01 (SequenceTouch table), then idle + balloon "Hai bisogno di qualcosa?" (mySubMii0) + menu. |
| Objects | APPROXIMATED | No evidence that the furniture of roomBase00 is interactive in the original. Chest → animActionCheckTheBox, lamp/switch → animActionPress (both names are in the binary), plants → animSmellHandDown (pack), then animNodClone. |
| Pathfinding | APPROXIMATED | Clear line = M7 straight walk (unchanged); otherwise A* on a 1-unit floor grid around the furniture footprints + string pulling. |
| Picking | APPROXIMATED | M7 priority rules kept; furniture is now hit on the real triangles (aPosition), so a plant's leaf box no longer hides the chest. |
| Furniture groups | VERIFIED (data) | chest, light (lamp + switch, standing on the chest), plant1/plant2, shelf (+books, photostand), cushion. |
| Visible floor | VERIFIED (render) | the original camera sees the back half of the room (z ≈ −34 … −2); M7's floor clicks at z > 0 were off-screen. |
