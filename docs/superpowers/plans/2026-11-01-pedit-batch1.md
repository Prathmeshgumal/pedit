# pedit Batch 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the rest of the user's test findings (roadmap Batch 1 items 2–8): project basics, CapCut-style player and toolbar, Claude model/effort pickers, files in chat, rotate/flip/crop, moving text on the video, and a right-click clip menu with Extract audio.

**Architecture:** Every new edit is a pure `Command` in `src/shared/commands.ts` (so undo, drafts and Claude get it for free), with a matching MCP tool. New data fields are optional, so v0.1 projects open unchanged. Preview transforms are one 3×3 UV matrix per layer (same maths unit-tested in TS); export applies the same transform as ffmpeg filters in the same order (crop → rotate → flip → cover).

**Tech Stack:** Electron 45, React 19, TypeScript, Zustand, WebGL2, ffmpeg 8.1, MCP SDK 1.32, Vitest, Playwright.

**Spec:** `docs/roadmap-capcut.md` (Batch 1), on top of `docs/superpowers/specs/` v0.1 design.

## Global Constraints
- Personal use; no licence concerns.
- Commit messages: one line, ≤10 words, plain words, no attribution. Never push, never PR.
- Every Claude edit still lands in a draft; every new command must work through `EditSession.apply` and `applyToDraft`.
- Old projects (no `transform`, no `lane`, no text `x/y`) must open and render exactly as before.
- 4K 120fps preview stays smooth: no per-frame CPU pixel work in the preview path.

## Review Focus
1. Rotating a clip 90° in a 16:9 project: preview and export must show the same framing (same crop/cover maths).
2. Extract audio when the audio lane already has music at that time: the new audio goes to a free lane, nothing is rejected or lost.
3. Removing media that is used on the timeline: the user is warned; confirming removes its items too, and undo brings both back.
4. Dropping a file into chat that is already in the library: no duplicate import; the tag points at the existing media.
5. Model/effort set to "Default": no `--model`/`--effort` flags are passed (the user's own Claude defaults apply).

---

### Task 1: Data model and commands

**Files:**
- Modify: `src/shared/model.ts`, `src/shared/commands.ts`, `src/shared/summary.ts`, `src/shared/ids.ts` (none if not needed)
- Test: `tests/shared/commands.test.ts`, `tests/shared/summary.test.ts`

**Interfaces:**
- Produces (model):
  - `interface ClipTransform { rotate: 0 | 90 | 180 | 270; flipH: boolean; flipV: boolean; crop: { x: number; y: number; w: number; h: number } }` (crop in fractions of the upright source, 0..1)
  - `IDENTITY_TRANSFORM: ClipTransform` (rotate 0, no flips, crop {0,0,1,1}); `VideoItem.transform?: ClipTransform`
  - `TextStyle.position: 'top' | 'center' | 'bottom' | 'custom'`; `TextStyle.x?: number; y?: number` (centre of the text block, fractions of frame); `TextStyle.rotation?: number` (degrees)
  - `AudioItem.lane?: number` (0 = default/music lane)
- Produces (commands):
  - `{ type: 'setTransform'; id; transform: Partial<ClipTransform> }` — video items only; crop clamped to [0,1], w/h ≥ 0.05
  - `{ type: 'extractAudio'; id }` — video item whose media `hasAudio`; adds AudioItem {mediaId, startMs: clip start, inMs, outMs, volume: clip volume, lane: lowest lane free over that span (≥0)}, sets clip volume 0. Summary `extracted audio of <name> to a1 (lane N)`. Error `invalid` if no audio.
  - `{ type: 'removeMedia'; id; force?: boolean }` — error `in_use` (new code) if timeline uses it and !force; with force removes its items (video ripples).
  - `{ type: 'duplicateItem'; id }` — video: copy inserted right after; text: copy starting at original end (fails `overlap` if taken); audio: same lane after original end, else next free lane.
  - `{ type: 'trimToPlayhead'; id; atMs; side: 'left' | 'right' }` — CapCut Q/W: removes the part of the item before/after `atMs`.
  - `{ type: 'insertFreeze'; id; atMs; mediaId; durationMs }` — splits video item at atMs (if inside) and inserts an image clip of `mediaId` there.
  - `{ type: 'replaceClip'; id; mediaId }` — keeps start/length (clamped to new media length), resets inMs to 0.
- Overlap checks for audio become per lane.

- [ ] **Step 1: Write failing tests** in `tests/shared/commands.test.ts`, describe `batch 1`:
  - `setTransform merges and clamps crop`: rotate 90 then flipH → `{rotate:90, flipH:true, flipV:false, crop:{x:0,y:0,w:1,h:1}}`; crop `{x:-1,y:0,w:2,h:0.01}` → `invalid`.
  - `extractAudio puts the clip sound on a free lane and mutes the clip`: music on lane 0 from 0–30000; clip c1 0–5000 → new audio item lane 1, startMs 0, inMs/outMs = clip's; `c1.volume === 0`. Clip from `hasAudio:false` media → `invalid`.
  - `removeMedia refuses media in use unless forced`: `in_use`; force → media gone, its clips gone, remaining clips rippled.
  - `duplicateItem` video → two items same media, second starts at first end; text → starts at original end.
  - `trimToPlayhead left/right` on a 0–5000 clip at 2000 → lengths 3000 / 2000 (inMs 2000 for left).
  - `insertFreeze at 2000 in a 5000 clip` → video lengths [2000, 3000(image), 3000].
  - `replaceClip keeps place and length` (clamped to new media duration).
  - old item without `lane` counts as lane 0.
- [ ] **Step 2:** `npx vitest run tests/shared/commands.test.ts` → FAIL (unknown command types).
- [ ] **Step 3:** Implement the model fields and commands. `CommandErrorCode` gains `'in_use'`. Summary (`timelineSummary`) prints transform (`rot 90 flipH crop 10%,0,80%,100%`) and audio lane (`lane 1`) only when non-default; text prints `(x 0.30 y 0.70)` for custom.
- [ ] **Step 4:** `npx vitest run tests/shared` → PASS.
- [ ] **Step 5:** commit `add clip transform, extract audio and media removal commands`

### Task 2: Audio lanes on the timeline, preview and export

**Files:** Modify `src/renderer/timeline/layout.ts`, `draw.ts`, `TimelineCanvas.tsx`, `interact.ts`; `src/renderer/preview/player.ts`; `src/main/export/graph.ts`. Test: `tests/shared/timelineLayout.test.ts`, `tests/main/graph.test.ts`, `tests/e2e/timeline.spec.ts`.

**Interfaces:**
- Produces: `trackLayout(p: Project): TrackRow[]` where `TrackRow = { key: string; kind: 'text' | 'video' | 'audio'; lane: number; y: number; h: number; label: string }` — rows: TEXT, VIDEO, then one AUDIO row per lane in use plus one empty row (drop target for a new lane). Replaces the fixed `TRACKS` lookups. `hitTest` / `trackAt` return the row.
- Dragging an audio item vertically onto another audio row sets its lane (`moveItem` gains optional `lane`).
- Player: one audio producer per lane plus clip audio (lanes = `[clipAudio, ...groupBy(p.audio, lane)]`).

- [ ] **Step 1: Failing tests:** layout test `audio lanes get one row each plus an empty row` (audio on lanes 0 and 2 → rows A1, A2(lane2)…; assert keys `['text','video','audio:0','audio:2','audio:new']`); `moveItem with lane` command test; graph test `extracted audio on lane 1 is mixed with the music` (two amix inputs + clip audio). e2e (timeline.spec): `extract audio from the right-click menu shows a second audio row` is added in Task 7 instead.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `npx vitest run` and `npx playwright test tests/e2e/timeline.spec.ts` → PASS.
- [ ] **Step 5:** commit `show and play several audio lanes`

### Task 3: Rotate, flip and crop in preview and export

**Files:** Create `src/shared/transform.ts`. Modify `src/renderer/preview/compositor.ts`, `player.ts`; `src/main/export/graph.ts`. Test: `tests/shared/transform.test.ts`, `tests/main/graph.test.ts`, `tests/main/export.test.ts`.

**Interfaces:**
- Produces: `orientedSize(w: number, h: number, t: ClipTransform): { w: number; h: number }` (size after crop and rotate); `uvMatrix(srcW, srcH, t: ClipTransform, dstW, dstH): number[]` — column-major mat3 mapping output quad coords q ∈ [0,1]² (y down) to source texture uv, implementing crop → rotate (clockwise) → flip → cover. `transformFilters(t: ClipTransform): string[]` — ffmpeg filters in the same order: `crop=iw*w:ih*h:iw*x:ih*y`, `transpose=1|2` / `hflip,vflip` for 180, `hflip`, `vflip`.
- Compositor `Layer` gains `transform?: ClipTransform`; shader uses `uniform mat3 m; t = (m * vec3(q, 1.)).xy`.

- [ ] **Step 1: Failing tests:** `transform.test.ts`: identity cover of 1920×1080 into 1080×1920 maps q(0,0)→(0.3417,0) and q(1,1)→(0.6583,1); rotate 90: q(0,0) (top-left of output) samples the source's bottom-left (uv (0,1)) for a same-aspect output; flipH swaps x; crop {0.5,0,0.5,1} maps q.x∈[0,1] into uv.x∈[0.5,1]. `orientedSize(1920,1080,{rotate:90})` = 1080×1920. graph test: rotated+cropped clip filter chain contains `crop=iw*0.5:ih*1:iw*0.5:ih*0,transpose=1` before `scale=`. export test `a rotated clip exports the same framing as the preview maths`: export the landscape fixture photo with rotate 90 in 9:16; red strip (left side of source) appears at the top.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement; player passes each video segment's transform to its layer.
- [ ] **Step 4:** unit + `tests/e2e/photo.spec.ts` + new e2e check in Task 7 → PASS.
- [ ] **Step 5:** commit `rotate, flip and crop clips in preview and export`

### Task 4: Text anywhere on the video

**Files:** Modify `src/renderer/text/renderText.ts`; create `src/renderer/panels/TextOverlay.tsx`; modify `PreviewPanel.tsx`, `PropertiesPanel.tsx`. Test: `tests/e2e/text.spec.ts`.

**Interfaces:**
- `renderText` honours `position: 'custom'` (centre at x·W, y·H) and `rotation` (rotate around the block centre). `textBox(item, W, H): { cx, cy, w, h, rotation }` exported for the overlay (same layout maths).
- `TextOverlay` sits over the preview canvas in timeline mode, shows a box for the selected text item when visible at the playhead; drag body → `updateText style {position:'custom', x, y}`; corner handle → `sizePct` (4–30); top handle → `rotation`. One edit per drag (on pointer up). Clicking text in the preview selects it.

- [ ] **Step 1: Failing e2e** `drag text in the preview moves it and the export matches`: add text, select it, drag its box 25% right and 20% down → style `{position:'custom', x≈0.75, y≈0.7}` (±0.03); `__peditText.bbox` centre moves accordingly; corner drag grows sizePct.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npx playwright test tests/e2e/text.spec.ts` → PASS.
- [ ] **Step 5:** commit `drag, resize and rotate text on the video`

### Task 5: Project basics and removing media

**Files:** Create `src/main/recents.ts`, `src/main/menu.ts`; modify `src/main/index.ts`, `src/main/editor.ts`, `src/main/project/store.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/renderer/Welcome.tsx`, `MediaPanel.tsx`, `TopBar.tsx`, `store.ts`. Test: `tests/main/recents.test.ts`, `tests/main/store.test.ts`, `tests/e2e/project.spec.ts`.

**Interfaces:**
- `Recents` (userData/recent.json): `add(dir, name)`, `list(): Array<{ dir; name; openedAt; exists: boolean }>` (max 12, newest first, dedup by dir), `remove(dir)`.
- `ProjectStore.rename(name)`; `saveCopy(dest)` copies project.json + chat.jsonl (+session id cleared), not cache.
- IPC: `recentProjects()`, `closeProject()` (stops chat, flushes, state → null → start screen), `renameProject(name)`, `saveProjectCopy()` (dialog), `removeMedia(id, force)` → `{ ok } | { ok:false; inUse:number }`, `removeUnusedMedia()` → count.
- App menu: File → New Project (Ctrl+N), Open… (Ctrl+O), Open Recent ▸, Save a Copy…, Rename…, Close Project (Ctrl+W), Import Media (Ctrl+I), Export (Ctrl+E), Quit; Edit → Undo/Redo/Cut/Copy/Paste; View → Toggle Fullscreen preview, Zoom in/out timeline.
- Start screen: New / Open buttons + recent list (name, folder, last opened; missing ones greyed with "Remove from list").
- Media tile right-click: Preview, Add to timeline, Reveal in folder, Locate…, Remove (in-app confirm when used: "Used N times on the timeline. Remove it and its clips?").

- [ ] **Step 1: Failing tests:** recents unit test (dedup, cap 12, missing flagged); store `rename` + `saveCopy` test; e2e `project.spec.ts`: create project → close → start screen lists it → reopen from list; remove used media asks then removes clips; undo restores.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS (`npx vitest run tests/main`, `npx playwright test tests/e2e/project.spec.ts`).
- [ ] **Step 5:** commit `add start screen, recent projects and media removal`

### Task 6: CapCut-style player bar and timeline toolbar

**Files:** Modify `PreviewPanel.tsx`, `TopBar.tsx`, `TimelineCanvas.tsx`; create `src/renderer/timeline/Toolbar.tsx`. Test: `tests/e2e/timeline.spec.ts`.

**Interfaces:**
- Player bar: left `00:00:03:12 | 00:01:10:00` (HH:MM:SS:FF at project fps), centre round play/pause button, right ratio picker (16:9 / 9:16 / 1:1, moved from TopBar) and fullscreen toggle (Esc exits). The range scrubber is removed (scrub on the timeline ruler).
- Timeline toolbar (above the ruler): Undo, Redo | Split (S/Ctrl+B), Delete left (Q), Delete right (W), Delete (Del) | Freeze, Mirror, Rotate, Crop | right: Snapping toggle (N), zoom out / slider / zoom in, Fit. Buttons disabled when nothing applies. `fmtTimecode(ms, fps): string` in `src/shared/time.ts`.

- [ ] **Step 1: Failing tests:** unit `fmtTimecode(3500, 30) === '00:00:03:15'`; e2e: Q at 2s on a 5s clip leaves 3s; W leaves 2s; snapping toggle off lets a text item land 1 frame off an edge; toolbar Rotate sets `transform.rotate 90` on the selected clip.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5:** commit `capcut style player controls and timeline toolbar`

### Task 7: Right-click menu, freeze frame, crop dialog

**Files:** Create `src/renderer/ContextMenu.tsx`, `src/renderer/panels/CropDialog.tsx`, `src/main/media/frames.ts`; modify `TimelineCanvas.tsx`, `PropertiesPanel.tsx`, `src/main/index.ts`, `ipc.ts`, preload. Test: `tests/main/frames.test.ts`, `tests/e2e/timeline.spec.ts`.

**Interfaces:**
- `extractFrame(media: MediaItem, sourceMs: number, out: string, maxEdge = 1920): Promise<void>` (upright jpg; HDR tone-mapped); `contactSheet(media, count = 12, out): Promise<{ path; times: number[] }>` (4-column grid, 480px cells, timestamps burned in) — used by Task 8.
- IPC `freezeFrame(itemId, atMs)`: main extracts the frame of the clip at the timeline time into `<project>/stills/`, imports it (folder "Freeze frames"), applies `insertFreeze` (3000ms). IPC `frameImage(mediaId, sourceMs)` → file path (crop dialog).
- Clip menu (video): Split, Delete, Duplicate, Copy, Paste after, Replace with selected media, Extract audio (only if media has audio), Mute/Unmute, Freeze frame, Rotate 90°, Mirror, Crop…, Reset transform. Text: Split, Delete, Duplicate, Copy, Edit text. Audio: Split, Delete, Duplicate, Mute.
- Crop dialog: frame at playhead with a draggable box; ratio presets Free / Original / 16:9 / 9:16 / 1:1 / 4:3; Apply → `setTransform {crop}`.

- [ ] **Step 1: Failing tests:** `frames.test.ts`: extractFrame of portrait fixture is upright (h > w); contactSheet of 5s clip → 12 times ascending, file exists. e2e: right-click a clip → Extract audio → an `audio:1` row appears, clip volume 0, playing still has sound (AudioOut scheduled count > 0); Freeze frame at 2s → 3 video items, middle is an image media in folder "Freeze frames"; Crop dialog 1:1 → crop w/h ratio matches.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5:** commit `right click clip menu with extract audio and freeze`

### Task 8: Claude model/effort, new tools, look at media

**Files:** Create `src/main/settings.ts`; modify `src/main/claude/runner.ts`, `src/main/chat.ts`, `src/main/mcp/tools.ts`, `src/main/claude/editor-guide.md`, `ChatPanel.tsx`, ipc/preload. Test: `tests/main/runner.test.ts`, `tests/main/mcp.test.ts`, `tests/main/settings.test.ts`.

**Interfaces:**
- `Settings` (userData/settings.json): `{ claudeModel: 'default' | 'opus' | 'sonnet' | 'haiku' | 'fable'; claudeEffort: 'default' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' }`; IPC `getSettings()`, `setSettings(patch)`.
- `ClaudeRunner` options gain `model?: string; effort?: string`; argv adds `--model X` / `--effort Y` only when not default.
- New MCP tools: `set_transform`, `extract_audio`, `duplicate_item`, `freeze_frame` (main does the frame extraction, then the command), `replace_clip`; `update_text` accepts `position:'custom'`, `x`, `y`, `rotation`; `move_item` accepts `lane`. `look_at_media {mediaId, count?: 4..24}` returns MCP image content (contact sheet jpeg, base64) plus a text line of the frame times; photos return the photo (≤1568px).
- Chat header: two compact selects (Model, Effort), saved immediately; apply to the next message.

- [ ] **Step 1: Failing tests:** runner argv with model 'sonnet' effort 'high' contains `--model sonnet --effort high`; with defaults contains neither. mcp: tool list includes the new names; `look_at_media` returns `{type:'image', mimeType:'image/jpeg'}`; `extract_audio` via MCP lands in the draft. settings: persists and survives reload; unknown values fall back to default.
- [ ] **Step 2:** FAIL. **Step 3:** implement; guide gains short lines for the new tools ("use look_at_media to see clips before choosing them when the user describes content"). **Step 4:** PASS. **Step 5:** commit `claude model and effort pickers and new editing tools`

### Task 9: Files in chat

**Files:** Modify `ChatPanel.tsx`, `src/main/chat.ts`, `src/main/claude/runner.ts` (`buildTurnPrompt`), ipc/preload; `tests/fake-claude/fake-claude.mjs`. Test: `tests/main/runner.test.ts`, `tests/e2e/chat.spec.ts`.

**Interfaces:**
- Dropping OS files (video/audio/photo) on the chat panel, or pasting an image, calls `attachToChat(paths | pngBytes)` → main imports any not yet in the library into folder "Chat" (pasted images saved to `<project>/chat-files/paste-<n>.png`) and returns `{ name, mediaId }[]`; they appear as chips (same as @tags, with a kind icon).
- `buildTurnPrompt` lists attachments as `attached: <name> (<mediaId>, photo|video|audio)` in the `[editor]` line and the guide tells Claude to call `look_at_media` on attached visuals.
- Fake Claude mode `look`: calls `look_at_media` on the first attached id and replies with the image's byte length.

- [ ] **Step 1: Failing tests:** prompt test with an attachment; e2e: drop a photo file on chat → chip shows, media library gains it in folder "Chat" once (dropping again doesn't duplicate), send → fake reply mentions bytes > 0.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5:** commit `attach videos, audio and photos to chat messages`

### Task 10: Package and verify
- [ ] `npm run typecheck`, `npx vitest run`, `npx playwright test` (all; playback benchmarks on an idle machine), `npm run dist`, packaged tests. Fix anything red. Update `docs/roadmap-capcut.md` (✅ items). Commit `batch 1 done: package and roadmap update`.
