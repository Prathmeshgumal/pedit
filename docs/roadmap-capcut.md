# pedit roadmap: what CapCut has that pedit doesn't (yet)

Written 2026-11-01 after the first real test (Kedarnath footage, 760 files).
✅ = done, ★ = asked for by you after testing.

## Batch 1: your test findings
| # | Feature | Notes |
|---|---------|-------|
| 1 | ✅★ Photos | Import, 5s default on the timeline, stretch to any length, upright phone photos, preview and export. Old projects retry failed items on open. |
| 2 | ✅★ Project basics | Start screen with New / Open / Recent; File menu (New, Open, Open Recent, Import, Export, Rename, Save a copy, Close); right-click media → Remove (asks if used, undo brings clips back); "Remove unused media". |
| 3 | ✅★ CapCut-style player and toolbar | Round play button, HH:MM:SS:FF timecode, ratio picker and fullscreen under the preview. Toolbar: undo, redo, split, delete left/right (Q/W), delete, freeze, mirror, rotate, crop, snapping (N), zoom slider, Fit. *Reverse moved to Batch 2 (with speed).* |
| 4 | ✅★ Claude model and effort picker | Model (Opus / Sonnet / Haiku / Fable) and effort (low → max) in the chat header, saved, used from the next message. |
| 5 | ✅★ Files in chat | Drop, pick (📎) or paste videos, audio and photos; they join the library (folder "Chat") and Claude looks at them with contact sheets. *Transcripts come with Batch 3 (Whisper).* |
| 6 | ✅★ Rotate / flip / crop per clip | 90° rotate, mirror, crop dialog with ratio presets; video and photos, preview and export, Claude can do it too. *Free-angle rotate moved to Batch 2 (keyframes).* |
| 7 | ✅★ Move text on the video | Drag text in the preview; corner handle resizes, top handle rotates. |
| 8 | ✅★ Right-click menu on clips | Split, delete, duplicate, copy/paste, replace with selected media, extract audio (own audio row), mute, freeze frame, rotate, mirror, crop, reset. Audio items can sit on several rows. *Speed and reverse moved to Batch 2.* |

## Batch 2: editing basics every CapCut user expects
- **More tracks:** overlay video and photo layers (picture-in-picture), several text tracks, several audio tracks (music + sound effects + voiceover). The main track can stay "magnetic" (no gaps) with a toggle.
- **Speed:** 0.1×–100×, keep pitch, speed curves (montage, bullet, hero time, custom).
- **Transitions** between clips (dissolve, slide, zoom, blur, …) with a length handle.
- **Audio polish:** fade in/out handles, volume keyframes, auto-ducking music under speech, loudness normalise.
- **Canvas:** blur or colour background when a clip's shape doesn't fill the frame (e.g. a landscape clip in a 9:16 reel); fit / fill toggle.
- **Adjust:** brightness, contrast, saturation, exposure, temperature, tint, highlights, shadows, vignette, sharpen. **Filters / LUTs** with a strength slider.
- **Keyframes** for position, scale, rotation and opacity (Ken Burns zoom on photos falls out of this).
- **Speed and reverse** per clip (moved from Batch 1), free-angle rotate.
- **Timeline comfort:** multi-select and group, markers (M), copy/paste attributes, link/unlink audio, compound clips.

## Batch 3: captions and audio AI (Python allowed)
- **Auto captions** from speech (Whisper, runs locally), a caption list to edit words, caption style presets, export as SRT.
- **Text-based editing:** cut by deleting words in the transcript; remove silences and filler words ("um", "uh").
- **Beat detection:** beat markers on music, "cut to the beat" for Claude and by hand.
- **Voice tools:** noise reduction, voice enhance, split vocals from music, record voiceover, text-to-speech, voice changer.
- **Sound effects library.**

## Batch 4: look and AI effects
- Masks (linear, circle, rectangle, mirror), blend modes, opacity.
- Chroma key; remove background (person cut-out).
- Stabilise; auto reframe (follow the subject when making 9:16 from 16:9).
- Video effects (shake, glitch, blur, flash), stickers and emoji, text animations (in / out / loop) and text templates.
- Retouch / beauty, colour match between clips.

## Batch 5: project, media and export polish
- **Media panel:** search, sort, filter by type, "used on timeline" badge, favourites.
- **Export:** 2K, H.265 / ProRes, bitrate, export a range, audio-only, GIF, export the current frame as a photo, captions as SRT.
- **Settings:** cache location and "clear cache", preview quality, default photo length, keyboard shortcut list.
- **Preview:** safe-zone guides for Reels / Shorts / TikTok.
- **Versions** (planned for v0.5): save points and going back after bad edits.

## Where pedit should beat CapCut (Claude)
Everything above gets an MCP tool, so Claude can do it too. On top of that:
- Claude watches the footage (contact sheets + transcripts) and picks the best moments from an hour of clips.
- "Make a 30s reel cut to the beat", "remove the boring parts", "caption it in Hindi and English".
- Every Claude edit stays a draft you preview, accept or reject.
