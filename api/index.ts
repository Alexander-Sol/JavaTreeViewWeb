import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'

const app = new Hono()

// Sample datasets available to load from the UI
app.get('/api/samples', (c) => {
  return c.json([
    {
      name: 'spellman',
      label: 'Spellman Yeast Cell Cycle (95 genes × 59 samples)',
      files: ['Spellman/spellman.cdt', 'Spellman/spellman.gtr', 'Spellman/spellman.atr'],
    },
    {
      name: 'colorTest',
      label: 'Color Test Dataset (997 genes × 13 samples)',
      files: ['colorTest.cdt'],
    },
  ])
})

// Serve individual sample data files
app.use('/sample-data/*', serveStatic({ root: './public' }))

// Serve built frontend assets
app.use('/dist/*', serveStatic({ root: './public' }))

// Serve everything else as static from public/
app.use('/*', serveStatic({ root: './public' }))

// Bun auto-detects the default export's fetch handler and starts the server.
// For Vercel, the default export is used by the Edge adapter.
export default {
  port: 3000,
  fetch: app.fetch,
}
