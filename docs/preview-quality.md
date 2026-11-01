# Preview quality: research and recommendation (issue #1)

2026-11-01 · Status: proposal, waiting for review before implementation

**Recommendation in one line:** keep today's small proxies for scrubbing, add a sharper 1080p preview copy that plays by default, show a full-quality frame whenever playback is paused, and use the original files only where the machine is shown to decode them in real time. A Preview Quality setting (Performance / Balanced / Original) chooses between them.

## 1. Why the preview looks bad today

The preview never shows the original footage. Every video plays from a proxy made at import (`src/main/media/proxy.ts`):

| Proxy property | Value today | Effect |
| --- | --- | --- |
| Size | 960 px on the long edge (960×540 for 16:9) | Full screen on a 1080p display is a 2× upscale; on a 1440p or 4K display, 2.7–4× |
| Quality | x264 CRF 26 `veryfast`, or quality 28 on NVENC / QSV / VAAPI | Visible compression: soft detail, banding in skies, blocky shadows |
| Frame rate | Source fps, capped at 60 | Fine for preview |
| Keyframes | Every 0.5 s, no B-frames | Makes seeking fast; also costs quality at a given size |
| Colour | HDR tone-mapped to SDR with the export's filter chain | Matches export: keep this |

The canvas already renders at the screen's real pixel size (`PreviewPanel.tsx` multiplies by `devicePixelRatio`), so the blur comes entirely from the source being 540p and heavily compressed. Full screen just makes it more visible.

## 2. How other editors handle it

| Editor | What it does |
| --- | --- |
| **Premiere Pro** | Separate **Playback Resolution** (Full, 1/2, 1/4, 1/8) and **Paused Resolution** settings in the monitors. A common setup is low playback resolution with paused resolution at Full, so you can check focus and detail on a still. Scrubbing uses the playback resolution. A **High Quality Playback** toggle makes playback frames match paused frames, at the cost of dropped frames. Proxies are attached to clips and switched on or off ([display quality](https://helpx.adobe.com/premiere/desktop/get-started/source-and-program-monitor-adjustments/set-display-quality-for-the-source-and-program-monitors.html), [high quality playback](https://helpx.adobe.com/premiere/desktop/get-started/source-and-program-monitor-adjustments/enable-high-quality-playback.html), [proxy workflow](https://helpx.adobe.com/premiere-pro/using/proxy-workflow.html)). |
| **CapCut (desktop)** | A **Proxy** switch under Settings › Performance; CapCut's help says it speeds up playback but can lower preview fidelity. A **preview quality** menu in the preview box offers higher-quality options, and CapCut may pick a lower quality automatically based on the hardware ([CapCut help](https://www.capcut.com/help/video-quality-change-after-exporting)). |
| **DaVinci Resolve** | A timeline **proxy mode** (half or quarter resolution) that lowers playback resolution on the fly without making files; **optimized media** and **proxy media** (transcoded copies); and a **render cache** that pre-renders effect-heavy parts, automatically in Smart mode ([summary](https://elements.tv/blog/davinci-resolve-5-ways-to-achieve-better-playback-performance/); third-party, menu names vary by version). |

**What they have in common:**
1. Smooth playback and accurate inspection are treated as two separate needs. Premiere's paused resolution is the clearest example.
2. Proxies are normal, and are switched on or off rather than being the only option.
3. Quality is chosen by the user, with automatic step-downs when the machine can't keep up.
4. Hard parts are pre-rendered (render cache) instead of being decoded live.

## 3. What pedit's platform allows

pedit decodes with WebCodecs inside Electron on Linux. That constrains "just use the originals":

**Codec support.** I asked this Electron build (45.2.1, Chromium 156) what `VideoDecoder.isConfigSupported` reports, on a machine without a GPU:

| Codec | Software decode | Hardware decode |
| --- | --- | --- |
| H.264 1080p / 4K | yes | not available on this machine |
| **HEVC 1080p / 4K Main10** | **no** | not available on this machine |
| VP9 4K, AV1 4K | yes | not available on this machine |

Chromium has no software HEVC decoder, so HEVC plays only through a platform hardware decoder. On Linux that means VAAPI, which Chromium and Electron often need extra switches to enable, and which NVIDIA GPUs reach only through a VAAPI shim. **Most phone footage is HEVC (often 10-bit HDR), so on many Linux machines the originals can't be decoded in the preview at all.** This must be measured on the reference machine (Raptor Lake + RTX 4050) before we rely on originals.

**Decode cost.** Decoding work grows with pixels per second, and transitions decode two clips at once:

| Source | Pixels per second | vs. today's proxy (540p30) |
| --- | --- | --- |
| 540p 30 fps | 16 M | 1× |
| 1080p 30 fps | 62 M | 4× |
| 1080p 60 fps | 124 M | 8× |
| 4K 30 fps | 249 M | 16× |
| 4K 60 fps | 498 M | 32× |
| 4K 120 fps | 995 M | 64× |

Software decoding of 4K60 and above is beyond most laptop CPUs, and 4K120 is beyond many hardware decoders too. A 4K frame is also about 12 MB in GPU memory, so frame queues get heavy.

**Other limits of originals:**
- Seeking: camera files often have long keyframe intervals (1–2 s and more) and B-frames, so seeking and scrubbing decode many more frames than the 0.5 s proxy GOP.
- HDR: HDR originals would need tone-mapping in the WebGL compositor that exactly matches the export's `zscale` + `hable` chain, which doesn't exist yet. Until then, HDR originals must not be shown directly, or preview and export would stop matching.

## 4. Options compared

| Option | Quality | Smoothness | Cost | Verdict |
| --- | --- | --- | --- | --- |
| A. Better proxies only (1080p, CRF ~20) | Good; sharp at normal size, slightly soft full screen on 4K displays | Good on the reference machine (4× today's decode) | More time and disk at import | **Do it**: the biggest win, works for HEVC/HDR, low risk |
| B. Originals wherever possible | Exact | Varies by machine and codec; HEVC often impossible | No extra disk | **Only where measured to work**; never as the only path |
| C. Full-quality still when paused | Exact on a still | Unaffected: only runs when paused | One frame per pause | **Do it**: cheap, and gives the "judge the final look" ability the issue asks for |
| D. Adaptive switching while playing | Best available | Protects smoothness automatically | Some complexity in the player | **Do it after A–C** |
| E. Render cache for complex ranges | Exact | Smooth | Render time and disk | Later: pedit's timelines are simple today |
| F. Lower canvas resolution | No gain | Small gain | None | No: the canvas isn't the bottleneck |

## 5. Recommended architecture

### 5.1 Three sources per clip

| Tier | What | When it's made | Used for |
| --- | --- | --- | --- |
| **Scrub proxy** | Today's 540p proxy, unchanged | At import, as now | Scrubbing; Performance mode; fallback while better tiers are still being made |
| **Preview copy** | 1080 px on the short edge (1920×1080 for 16:9; 1080×1920 for vertical), CRF ~20 (or quality ~22 on hardware encoders), fps capped at 60, keyframe every 0.5 s, same tone-mapping | In the background after all scrub proxies: clips on the timeline first, then the rest | Playback in Balanced mode (the default) |
| **Original** | The imported file | — | Original mode, only for clips that pass the checks in 5.3 |

### 5.2 Preview Quality setting

A menu in the preview bar, next to the aspect ratio, saved per user:

| Mode | Playing | Paused | Scrubbing |
| --- | --- | --- | --- |
| **Performance** | Scrub proxy | Scrub proxy | Scrub proxy |
| **Balanced** (default) | Preview copy (scrub proxy until it's ready) | **Full-quality frame** | Scrub proxy |
| **Original** | Original where eligible, else preview copy | Full-quality frame | Scrub proxy |

A small label in the preview shows what's on screen, such as "1080p preview" or "Original", and changes to "Preview copy is being made (42%)" while the copy is being made.

### 5.3 When an original is eligible (Original mode)

A clip plays from its original only when all of these hold; otherwise it uses its preview copy:
1. `VideoDecoder.isConfigSupported` accepts the file's real codec string, size and bit depth.
2. It's SDR. HDR originals wait for shader tone-mapping (later phase).
3. A short decode benchmark on first use proves at least 1.5× the needed frame rate. The result is cached per codec, resolution and fps, and transitions count double.
4. Its keyframe interval is at most about 2 seconds, so seeking stays responsive.

### 5.4 Full-quality frame on pause

When playback stops and the playhead has been still for about 150 ms, the player replaces the shown frame with an exact one:
- **Video:** decode the original frame with WebCodecs when the codec is supported, otherwise ask the main process for the frame through FFmpeg. `extractFrame` already does this for freeze frames, with the export's tone-mapping, so the still looks exactly like the export. The frame is scaled to the canvas size and cached by clip and time.
- **Photos:** today's preview JPEGs are capped at 1920 px. Load a display-sized version on pause instead.
- Any key press, scrub or play drops back to the playback tier immediately.

### 5.5 Adaptive step-down while playing

The player already counts presented and dropped frames (see `docs/benchmarks.md`). If more than about 5% of frames drop over a 2-second window, it steps the slow clip down one tier for the rest of that playback and shows a note ("Switched to preview copies to keep playback smooth"). Pausing resets it.

### 5.6 Where it touches the code

| Area | Change |
| --- | --- |
| `src/main/media/proxy.ts`, `jobs.ts` | A second proxy profile (`previewArgs`) and a low-priority `preview` stage after the scrub proxy; `MediaItem.previewPath` |
| `src/shared/ipc.ts`, `src/main/settings.ts` | `previewQuality: 'performance' \| 'balanced' \| 'original'`; an IPC call for an exact frame at (media, ms, width, height) |
| `src/renderer/preview/player.ts`, `clipSource.ts` | Pick the source per clip from mode, play state and eligibility; keep open sources keyed by URL so switching tiers doesn't stall; the pause-frame swap; the step-down |
| `src/renderer/panels/PreviewPanel.tsx` | The Preview Quality menu and the label |
| `tests/` | Unit tests for source choice and eligibility; an e2e test that pausing shows a frame at canvas size; extend the benchmark to 1080p copies and originals |

## 6. Cost of each mode

Estimates, to be measured with the existing benchmark harness on the reference machine:

| | Performance | Balanced | Original |
| --- | --- | --- | --- |
| Decode work while playing | 1× (today) | about 4× (1080p30) to 8× (1080p60) | 16–64× for 4K originals, when eligible |
| Extra disk per hour of footage | none | roughly 3–5 GB for 1080p copies (vs. about 0.5–1 GB for scrub proxies) | none |
| Extra import time | none | one more transcode per clip, in the background, after the scrub proxy; mostly bound by decoding the source, so likely similar to today's proxy time | none |
| Accuracy | Low | Good while playing, exact when paused | Exact where eligible |

The project's import budget (1 hour of 4K120 HEVC proxied in at most 30 minutes) applies to scrub proxies. Preview copies come after them and never block editing.

## 7. Phased plan

1. **Phase 1, the main fix:** 1080p preview copies, the Preview Quality setting (Performance / Balanced), and the full-quality frame on pause. This fixes the full-screen complaint for every codec, including HEVC and HDR.
2. **Phase 2:** Original mode: the codec and benchmark eligibility checks, adaptive step-down, and the label. Also try enabling hardware decoding (VAAPI) in Electron on Linux and measure it on the reference machine.
3. **Phase 3, later:** shader tone-mapping that matches the export, so HDR originals can be eligible; a render cache for complex ranges if timelines get effect-heavy; a 1440p preview copy option for 4K displays.

## 8. Questions for review

1. Is **Balanced** the right default, given about 3–5 GB of extra disk per hour of footage? The alternative is Performance by default, with Balanced as an opt-in.
2. Should preview copies be made for every clip, or only for clips on the timeline? The second saves disk but means a short wait when a new clip is added.
3. Is 1080p enough for the preview copy, or do you edit on a 4K display often enough to want 1440p?
