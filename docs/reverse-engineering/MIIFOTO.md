# MIIFOTO.md — Miifoto (M12, 2026-10-25)

All data is the user's own (CDN asset_archCamera_*, asset_model_camera_output, font zips; message EUit System/ArchCamera; APK fonts/scene).

## Key finding — MSBT attributes carry game data — REVERSED
The MessageStudio project `Arch.msbp` defines 197 attributes (ATI2/ALB1/ALI2) in prefixed sets: `ac_` (ArchCamera), `ex_`/`er_`/`wd_`/`fc_`/`em_` (emotion expression: gestures In/loop/Out per expression, per-personality Nagomi/Nori/Dry/Cool variants, word dictionary), `kl_`/`kh_` (knowledge list = question metadata: QuestionID, MessageType Question/Reaction/Report Friend/Myself, dates, genre, age, gender, difficulty, appear rate; question heads), `snd_` (sound mixing), `mc_`, `lt_`, `err_`, `an_` … Each MSBT's ATR1 entry uses one set, offsets relative to its first attribute. Decoder: `client/web/src/formats/msbt.ts` `parseMSBP` + `msbtAttributes(prefix)`.

## Data
| Item | Status | Source / notes |
|---|---|---|
| 88 poses (name, clip, capture frame, base joint, camera, default face) | REVERSED | ArchCameraAnimation.msbt, set `ac_`: e.g. waveHand "Saluto" → animHandWaveL frame 0, cameraCap00J_L.xml; bow "Inchino" → animBowClone frame 32 |
| 41 faces | VERIFIED names; faceN = FFL/AFL expression N — DEDUCED (0–5 match normal/smile/anger/sorrow/surprise/blink, 12 "Occhiolino" = wink) | ArchCameraFace.msbt |
| Pose cameras | VERIFIED (data) | asset/model/camera/output/cameraCapNN{J,H,S}_{L,S}.xml (Position, Aim, Near, Far, FovY) |
| Lights | VERIFIED (data) | asset/env/scene/archCamera_scene.xml |
| 214 backgrounds (640×640) + thumbnails | VERIFIED (data) | asset/archCamera/cameraBg/default/cameraBgNNN.webp, t_cameraBgNNN.webp |
| Stamps (8 categories, ~450) | VERIFIED (data) | asset/archCamera/cameraStamp/cameraStamp<Cat>/…; names ArchCameraStampCategory_v2-2.msbt |
| Fonts (22, file + outline) | REVERSED | ArchCameraFont.msbt `ac_FontFile`, `ac_FontOutline`; Latin fonts from the CDN font zips are kept, the large Japanese ones are not |
| 89 templates | VERIFIED (data) | asset/archCamera/template/default/*.dat (plist): BgLabel, Label{Text,Font,Color,Pos,Rotation,Scale}, Stamp{Category,Image,Pos,Scale,Rotation,Reverse}, Mii{ManualAnimation,ManualAFLExpression,CurrentFrame,Camera*,Scale,Offset,Visible} × 5 slots; texts ArchCameraTemplateText.msbt |
| UI labels | VERIFIED | Layout/camera (Animazione, Espressione, Aggiungi testo, Carattere, Colore, Testo, Posa e sfondo casuali) |

## Composer (client/web/src/play/Miifoto.ts)
640×640 canvas: background → Mii layer (rendered alone, transparent, with the pose camera or the template's MiiCamera*; scaled by MiiCameraScale, centred at MiiCameraOffsetX/Y in photo NDC — DEDUCED) → stamps → texts (outline + colour; cocos coordinates, origin bottom-left — DEDUCED; base text size APPROXIMATED). Stamps/texts can be dragged, scaled, rotated, deleted. Export: PNG download.
Not done: up to 5 Miis per photo (friends), album / sharing (server), photo from the device camera roll, "Il mio completo" (outfit shot), stamp categories added by later weekly zips, exact text metrics.
