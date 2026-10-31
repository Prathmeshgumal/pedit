import { textBBox, loadFonts, renderTextPng } from './text/renderText'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
createRoot(document.getElementById('root')!).render(<App />)

;(window as unknown as { __peditText: unknown }).__peditText = { bbox: textBBox }
void loadFonts()
window.pedit.onTextRenderRequest(async (items, w, h) => {
  const out: Record<string, Uint8Array> = {}
  for (const t of items) out[t.id] = await renderTextPng(t, w, h)
  return out
})
