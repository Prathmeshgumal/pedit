# Overnight build: plan and decisions (2026-11-01)

Branch: `overnight` (from `batch1`). `main` untouched. One commit per finished item.

## What you asked for → plan (status)
1. Playback stall fix — buffering instead of dropping frames  ✅
2. Story file (story.md) Claude edits from  ✅
3. Fonts library (bundled + Claude can add Google Fonts) and caption/text style presets, text animations  ✅
4. Filters & adjustments (built-in looks + Claude can create new ones, LUT .cube support), per-clip strength  ✅
5. Transitions between clips (editor + Claude)  ✅
6. J-cut / L-cut (editor + Claude)  ✅
7. Handy cutting: blade tool (B) and a scissors button on the playhead  ✅
8. Modern UI: Claude-desktop style chat, custom dropdowns, effort slider, styled sliders  ✅
9. More Claude tools + guide on how to edit well (research)  ✅
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
- **How filters work:** every colour change of a clip (its filter at its strength, then its own adjustments) is baked into one 3D colour table (a "LUT"). The preview uses it on the GPU, the export hands the same table to ffmpeg, so they match (tests check both). Vignette is separate and uses ffmpeg's exact formula in the preview too.
- **15 built-in filters:** Warm, Cool, Vivid, Cinematic (teal/orange), Golden hour, Film, Vintage, Moody, Pastel, Bright & clean, Night city, Black & white, Noir, Sepia, Green & teal. Adjust sliders: exposure, contrast, highlights, shadows, saturation, vibrance, temperature, tint, fade, vignette (+ split toning for Claude). Double-click a slider to reset it.
- **A clip keeps a copy of its filter's settings**, so a project still looks the same if the filter is later changed/deleted or opened on another computer (except a LUT file, which is referenced by path in `~/.config/pedit/luts`).
- **Filters tab:** click a card → applies to the selected clip, or to every clip when none is selected (a toast says so). Thumbnails show the clip's own frame through each look. "Use this look on all clips", "Add a LUT file (.cube)…". Properties → Colour has the filter, its strength and the sliders; "Save as filter" saves the clip's look (filter strength folded in approximately; a LUT file is not carried over — cost: a saved look from a LUT-based filter loses the LUT part).
- **Claude tools:** `list_filters`, `apply_filter` (strength 0–100, all clips by default, null removes), `adjust_color` (merge or `reset`), `create_filter`, `import_lut`. The timeline Claude reads now shows each clip's filter and adjustments.
- **Export colour:** clips with a look are converted to RGB with BT.709 both ways (what browsers assume for HD video) for the LUT; clips without a look are untouched, so plain exports are exactly as before.
- **Bug found by the test and fixed:** a look without a LUT file was ready instantly, which made the preview draw twice and keep the wrong (unfiltered) picture.
- **Transitions (part 1):** a transition sits on the clip *after* a cut and makes the two clips overlap by its length (at most half of either clip), so the video gets shorter by that much, like CapCut. 18 types matching ffmpeg's `xfade` (cross dissolve, dip to black/white, soft wipes, wipes, slides, circle open/close, zoom in). Export uses `xfade` for transitions and `concat` for plain cuts; tested with real ffmpeg. Clip sound is now one piece per clip mixed together, crossfading under transitions; this also prepares J/L cuts (`audioCutMs`, logic + tests done). **Not yet:** the preview still shows transitions as a hard cut (the two-clip GPU blend is written but not wired in), and there's no editor picker or Claude tool for them yet.

- **Transitions in the preview use ffmpeg's own formulas.** Each of the 18 transitions is written as a small GPU program copied from ffmpeg's `xfade` source, so what you see is what you export. A test exports a row of 8 transitions and compares preview and export pixels at two moments of each: they differ by 1–4 out of 255. (My first try had the wipes mirrored; the test caught it, and I fixed it from the ffmpeg source rather than by guessing.)
- **Preview plays clips on two alternating lanes,** so during a transition both clips decode at once. A lane whose next clip hasn't started yet only decodes 4 frames ahead, to save memory.
- **Picking a transition:** each cut on the timeline has a small round button at the bottom of the video track; click it for the list, lengths (0.3 / 0.5 / 1 / 2 s) and "Use on every cut". The overlap is shaded. The button is at the bottom, not the middle, so grabbing a clip's edge still trims. The selected clip's Properties also show "Cut into this clip": transition, length and the J/L sound slider. Clicking inside an overlap selects the incoming clip (the one drawn on top).
- **J/L cuts:** stored on the incoming clip as one number (− = J, this sound starts early; + = L, the old sound runs on). It is limited by the clip lengths and by footage that actually exists before/after the clip; when it's limited, Properties and Claude's timeline say so. Sound edges get a 30 ms fade so they don't click.
- **Claude tools:** `list_transitions`, `set_transition` (one cut or all cuts, `null` removes), `set_audio_cut`. `get_timeline` shows `← fade 0.5s` and `J-cut 0.7s` on clips. The tool text tells Claude plain cuts are the norm.
- **Also fixed:** sliders in Properties saved one step behind when moved with the arrow keys.

- **Blade tool:** B (or the ✂ in the timeline toolbar) turns it on; a red dashed line shows where it will cut; click any clip, sound or text to cut it there. Cuts land on a frame and snap to the playhead when close. V or Escape goes back to select. Ctrl+B and S still split at the playhead as before.
- **Scissors on the playhead:** a small ✂ circle sits on the playhead in the ruler whenever there is something under the playhead to cut; click it to split there. Clicking anywhere else on the ruler still scrubs.

- **Chat looks like the Claude desktop app:** your messages in soft grey bubbles on the right, Claude's replies as plain text, tool steps as a quiet list with a line down the left (long runs fold to the last 3, "N earlier steps" opens them), and one rounded box at the bottom holding attach (+), effort, model and a round send/stop button. I kept the editor's blue instead of Claude's orange so the app doesn't look like a copy of Anthropic's.
- **Effort is a 6-step slider** (Auto, Low, Medium, High, Extra high, Max) with the level's name next to it; **model** is a small dropdown beside it. Both still save straight away and apply from your next message.
- **All dropdowns are the app's own** (`src/renderer/ui/Select.tsx`): native ones can't be styled on Linux and looked like 2005. Keyboard works (arrows, Enter, Escape, type a letter). The font list shows each font in its own face; filters and text styles are grouped "Built in" / "Saved".
- **Sliders are restyled** (thin track, round thumb). Two-sided ones (contrast, temperature, J/L…) fill from the middle, so you can see how far from neutral a value is.

- **`look_at_timeline`: Claude can now watch its own edit.** It renders a grid of frames of the finished picture (Claude's draft if open), with framing, colour, transitions and text, exactly as the export builds them (same ffmpeg graph), but from the small preview files at 480 px, so it takes a second or two instead of an export. Claude picks evenly spaced frames or exact moments.
- **Guide for Claude** (`src/main/claude/editor-guide.md`) gained: how to use transitions and J/L cuts, a "check your work" loop (look, fix, look again, at most 3 times), and craft rules from standard editing practice: open on the strongest shot, vary wide/medium/close, cut on action, plain cuts by default with one transition style, J/L cuts for smooth scene changes, 9:16 safe areas for text, caption reading speed (~15 characters a second, 2 lines max), match colour before applying a look, duck music under speech.
- Chat shows the new read-only tools as quiet steps ("watched the edit", "looked at transitions").

## Extra: no native menu bar ✅
- `Menu.setApplicationMenu(null)`: the File/Edit/View/Window bar is gone on every screen.
- Its items live in a ☰ button at the left of the top bar (and top-left of the start screen), with shortcuts shown next to each item.
- Shortcuts moved to a renderer key handler (`src/renderer/appMenu.ts`): Ctrl+N/O/I/E/W/Q, F11, Ctrl+Shift+I. Window-only actions (quit, full screen, devtools) go to main over `app:window`.
- Copy/paste in text boxes still works on Linux without menu roles (Chromium handles them).
