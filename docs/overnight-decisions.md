# Overnight build: plan and decisions (2026-11-01)

Branch: `overnight` (from `batch1`). `main` untouched. One commit per finished item.

## What you asked for → plan (status)
1. Playback stall fix — buffering instead of dropping frames  ✅
2. Story file (story.md) Claude edits from  ✅
3. Fonts library (bundled + Claude can add Google Fonts) and caption/text style presets, text animations  ✅
4. Filters & adjustments (built-in looks + Claude can create new ones, LUT .cube support), per-clip strength  ⏳
5. Transitions between clips (editor + Claude)  ⏳
6. J-cut / L-cut (editor + Claude)  ⏳
7. Handy cutting: blade tool (B) and a scissors button on the playhead  ⏳
8. Modern UI: Claude-desktop style chat, custom dropdowns, effort slider, styled sliders  ⏳
9. More Claude tools + guide on how to edit well (research)  ⏳
10. Package (AppImage), full test run  ⏳

## Decisions
(newest last; each says what I chose, why, and what it costs if wrong)

- **Playback when decoding can't keep up:** the clock now waits ("buffers") until frames are ready, instead of letting sound run ahead while the picture freezes and frames are dropped. Playback also waits for the first frame before starting. Why: this is what real players do; A/V stays in sync. Cost: on a very busy machine you may see a short pause instead of a frozen picture.
- **Preview "loaded" now records which clip is loaded,** not just yes/no. Before, for one moment after switching clips it still said "loaded" for the old one, so pressing play right after a double-click could play nothing, and a portrait clip could show in a landscape box (the old open issue). Cost: none.
- **Frame-rate tests while you sleep:** your screen is locked, which throttles screen refreshes, so the "≥95% frames shown" checks drop to ~94% on old and new code alike. I treat those as unreliable tonight and rely on the slow-decoder test (which doesn't depend on the screen). Re-run `npx playwright test tests/e2e/preview-*.spec.ts` with the screen on to confirm.
- **Story lives in `<project>/story.md`,** edited in a new *Story* tab (left panel) or loaded from a .md/.txt file. Attaching a .md/.txt in chat *replaces* the story (it's not added to the media library). Each message tells Claude "the project has a story (N words): call get_story before planning". Why: one obvious place, plain markdown you can edit anywhere. Cost: attaching a second .md overwrites the first story (undo = paste the old text back).
- **Fonts:** 29 fonts are bundled (all free for videos: SIL OFL / Apache, from Google Fonts), incl. Noto Sans Devanagari for Hindi/Marathi; `scripts/fetch-fonts.sh` re-downloads them. Added fonts (by Claude's `add_font`, the Text tab's "Any Google Font" box, or a .ttf/.otf file) go to your user folder (`~/.config/pedit/fonts`) so every project can use them. Inter + Devanagari are always the fallback, so a missing letter or font never shows blank. Cost: +8 MB to the app.
- **Found and fixed while testing:** the app's security policy blocked font files, so *all* text (even Inter) was secretly drawn in the system fallback font. Now the real fonts load, so text may look slightly different from before (it's now actually Inter).
- **Text styles:** 15 built-in looks (Clean, Subtitle, Boxed caption, Shorts pop, Yellow highlight, Headline, Cinematic, Travel title, Handwritten note, Script, Retro, Comic, Neon, Minimal label, Hindi). Click a card in the Text tab: adds text at the playhead, or restyles the selected text. "Save style" in Properties (or Claude's `save_text_style`) saves your own looks to `~/.config/pedit/text-styles.json`.
- **New text options:** outline (colour + thickness), drop shadow / glow, letter spacing, ALL CAPS, and in/out animations (fade, slide up/down/left/right, pop) with a length. Every animation also fades. The fade is linear and motion eases out, chosen so the export (ffmpeg) matches the preview exactly; a test checks the two give the same positions.
- **Claude tools added:** `list_fonts`, `add_font`, `list_text_styles`, `save_text_style`, `add_captions` (many captions in one undo step, all-or-nothing), `restyle_text` (one look for all/some text). `add_text`/`update_text` take `preset`. Claude can't use a font that isn't installed: it's told to `add_font` it first.
- **One undo for many edits:** a new internal "batch" edit groups several changes; used by `add_captions`/`restyle_text`.
- Not done (kept for later): word-by-word karaoke highlight captions, typewriter animation.
