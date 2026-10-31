import { textBBox, loadFonts, renderTextLayer } from './text/renderText'
import type { RenderedText } from '@shared/ipc'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
createRoot(document.getElementById('root')!).render(<App />)

;(window as unknown as { __peditText: unknown }).__peditText = { bbox: textBBox }
void loadFonts()
window.pedit.onTextRenderRequest(async (items, w, h) => {
  const out: Record<string, RenderedText> = {}
  for (const t of items) {
    const l = await renderTextLayer(t, w, h)
    out[t.id] = { png: new Uint8Array(await (await l.canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()), cx: l.cx, cy: l.cy }
  }
  return out
})
