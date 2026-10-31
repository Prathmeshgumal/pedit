# Overnight build: plan and decisions (2026-11-01)

Branch: `overnight` (from `batch1`). `main` untouched. One commit per finished item.

## What you asked for → plan (status)
1. Playback stall fix — buffering instead of dropping frames  ✅
2. Story file (story.md) Claude edits from  ✅
3. Fonts library (bundled + Claude can add Google Fonts) and caption/text style presets, text animations  ⏳
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
