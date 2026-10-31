# How editors and AI editing agents do it — notes that shaped the overnight build

## What CapCut and similar editors offer (the basics people expect)
- **Text & captions:** many fonts; style presets (plain, outline/stroke, drop shadow, background box, karaoke/word highlight); in/out animations (fade, slide, pop); a style change can apply to every caption at once. ([Primal Video tutorial](https://primalvideo.com/guides/capcut-for-pc-mac-tutorial/), [CapCut FAQ overview](https://flowith.io/blog/capcut-desktop-pro-2026-faq-cloud-storage-auto-captions-commercial-use))
- **Transitions:** the default is a soft cross-fade ("Smooth"); then dissolve, fade to black/white, wipes, slides, zooms, blur, glitch. A transition sits *on the cut* and has a length. ([Filmora's CapCut review](https://filmora.wondershare.com/video-editor-review/capcut-for-pc.html))
- **Filters & adjust:** filters are named looks (warm, cool, vintage, film, B&W, cinematic teal-orange…) with a strength slider; "Adjust" has brightness, contrast, saturation, exposure, temperature, tint, highlights/shadows, vignette, sharpen. Pros use LUTs (.cube files).
- **J-cut / L-cut:** J = the next clip's sound starts *before* its picture; L = the previous clip's sound *continues over* the next picture. Editors do it by unlinking audio and sliding the audio edit point; a short audio cross-fade smooths it. Used for dialogue, narration over montage, and to make cuts feel natural. ([TechSmith](https://www.techsmith.com/blog/how-to-edit-videos-l-cuts-and-j-cuts/), [Adobe](https://www.adobe.com/creativecloud/video/discover/j-cut-and-l-cut), [CapCut guide](https://www.capcut.com/create/j-cuts-and-l-cuts-dialogue-edits), [StudioBinder](https://www.studiobinder.com/blog/what-is-an-l-cut))

## How AI editing agents work well
- **Tools, not pixels:** the model plans and calls editing functions; the editor does the cutting and rendering ([LAVE paper](https://arxiv.org/html/2402.10294v1), [Motionbox on LLM workflows](https://motionbox.io/blog/llm-video-editing-workflow)).
- **Describe the footage in words and pictures:** transcripts and still-frame sheets; pull in images only where a decision needs them ([ChatCut](https://chatcut.io/blog/chatcut-llm-transcript-driven-documentary-editing), [video-use for Claude Code](https://themenonlab.blog/blog/video-use-ai-video-editing-claude-code-agents)).
- **Check your own work:** agents that look at the result after editing make fewer mistakes ([Tella on agentic editing](https://www.tella.com/edit-with-ai/agentic-video-editing)).
- **The human keeps control:** suggestions as drafts/markers the person accepts ([Automation Agent for Premiere](https://digitalproduction.com/2026/09/04/automation-agent-premiere-timeline-aware-ai-workflows/)).

## What this means for pedit's Claude
1. **Story first:** a `story.md` in the project (written by you, or attached in chat) tells Claude the order, mood and must-have moments. Claude reads it with `get_story` before planning.
2. **See footage:** `look_at_media` (contact sheets) — already built.
3. **Check its own cut:** new `look_at_timeline` renders frames of the draft at chosen times so Claude can verify framing, text placement and transitions.
4. **Library it can grow:** fonts (bundled + any Google Font by name), text style presets, filter presets (adjustments and/or a LUT). Claude can add new ones and use them; you see them in the editor too.
5. **Craft rules in the guide:** soft cross-fades by default and sparingly; cut on action; L-cuts to carry speech or ambience over B-roll; J-cuts to lead into a new scene with its sound; consistent look across a sequence; captions short and readable.
