# Demo run notes (Task 14)

Prompt (from the spec): *"Put the Tokyo clips in order, trim each to 3 seconds, add a title 'Tokyo' at the start, put track_02 under it"*

Run with the real `claude` CLI (2.1.316, default model) against the test fixtures (`day1/`, `day2/`, `music/`), via
`npx playwright test -c tests/manual` (this spends real Claude usage; it's not part of the normal suite).

The fixtures are synthetic test patterns, not real 4K phone clips. Only one file has "Tokyo" in its name and no folder does,
so Claude reasonably used just that clip. A run on real trip footage is still to do at Checkpoint 3.

## Run 1 (original guide)
- Completed: yes, as a draft. Wall time 14.5s. 7 tool calls: ToolSearch (Claude Code loading the MCP tools), get_timeline, list_media, add_clip, add_text, set_music ×2.
- Usage: 14 input + 140k cache-read + 18.7k cache-write tokens, 1,165 output (242 thinking).
- What went wrong: Claude sent `add_text` and `set_music` **in parallel** with the same `expectedRevision`. The second was refused ("timeline changed (rev 2, you sent 1)"). Claude retried and succeeded.
- Reply was accurate. It mentioned the 30s music under a 3s video and offered to add more clips.

## Guide change
- Added: "Make edits one at a time, never in parallel: each edit bumps the revision…"
- Added: "When the user names a trip, place or day, match it against folder names as well as file names."

## Run 2 (tuned guide)
- Completed: yes. Wall time 31.2s. 6 tool calls: ToolSearch, get_timeline, list_media, add_clip, add_text, set_music. **No errors.**
- Usage: 14 input + 140k cache-read + 18.4k cache-write tokens, 907 output.
- Result: clip 0–3s, title "Tokyo" 0–2.5s, track_02 as music at 100%. The reply accurately said only one clip matched and asked which other clips are from Tokyo.

## App fix found during the run
- Claude Code's built-in `ToolSearch` call showed as an empty "✓" step in the chat. Built-in tools are now marked internal and hidden.

## Automated demo (fake Claude, `tests/e2e/demo.spec.ts`)
- Fake Claude adds every `day1` clip in capture order (3s each), title "Tokyo" 0–2s, track_02 and 9:16. The test accepts the draft, exports 9:16 1080p, and checks 1080×1920, 9.0s ±0.1, with audio. Passes.
