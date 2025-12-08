/* server.js
   Express proxy + static host for Hayase extensions
   - Provides /proxy?url=<encodedUrl> which fetches upstream and returns content with CORS headers
   - Serves ./extensions static files under /extensions
   - In-memory cache with TTL and simple LRU trimming
   - Basic rate limiting and security headers
*/
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import dotenv from 'dotenv'
import fs from 'fs/promises'
import path from 'path'

dotenv.config()

const app = express()
app.use(helmet())

// Very brief request logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} from ${req.ip}`)
  next()
})

// Allow CORS for everything (for development). In production consider locking down origins.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  next()
})

// Rate limiter (tune as needed)
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // max requests per IP per window
  standardHeaders: true,
  legacyHeaders: false
})
app.use(limiter)

// Print the current working directory at startup
console.log('cwd:', process.cwd())
const EXT_DIR = path.join(process.cwd(), 'src/extensions')
console.log('extensions dir (expected):', EXT_DIR)

// Route to list files in the extensions directory for debugging
app.get('/extensions/list', async (req, res) => {
  try {
    const files = await fs.readdir(EXT_DIR)
    const stats = await Promise.all(files.map(async f => {
      const st = await fs.stat(path.join(EXT_DIR, f))
      return { name: f, isFile: st.isFile(), size: st.size }
    }))
    res.json({ ok: true, path: EXT_DIR, files: stats })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// Allowlist of upstream hostnames
const ALLOWLIST = new Set([
  'nyaa.si',
  'www.nyaa.si',
  'sukebei.nyaa.si',
  'www.sukebei.nyaa.si'
])

// Simple in-memory cache: key -> { buffer, headers, status, expiry }
const cache = new Map()
const CACHE_TTL = parseInt(process.env.CACHE_TTL || '60000', 10) // default 60s
const CACHE_MAX_ENTRIES = parseInt(process.env.CACHE_MAX_ENTRIES || '1000', 10)

// Utility: trim cache if too large (simple)
function trimCacheIfNeeded() {
  if (cache.size <= CACHE_MAX_ENTRIES) return
  const keys = Array.from(cache.keys()).slice(0, cache.size - CACHE_MAX_ENTRIES)
  for (const k of keys) cache.delete(k)
}

// Helper to get hostname safely
function getHostname(target) {
  try {
    const u = new URL(target)
    return u.hostname
  } catch {
    return null
  }
}

app.get('/proxy', async (req, res) => {
  const target = req.query.url
  if (!target) return res.status(400).send('missing url param')

  const host = getHostname(target)
  if (!host || !ALLOWLIST.has(host)) {
    return res.status(403).send('host not allowed')
  }

  const cacheKey = target
  const now = Date.now()
  const cached = cache.get(cacheKey)
  if (cached && cached.expiry > now) {
    // Return cached
    res.status(cached.status)
    // Copy limited headers
    if (cached.headers['content-type']) res.setHeader('Content-Type', cached.headers['content-type'])
    // CORS header already set by middleware
    return res.send(Buffer.from(cached.buffer))
  } else if (cached) {
    cache.delete(cacheKey)
  }

  try {
    const upstreamRes = await fetch(target, {
      headers: {
        'User-Agent': 'hayase-proxy/1.0 (+https://github.com/youruser/hayase-proxy)'
      }
    })

    const arrayBuffer = await upstreamRes.arrayBuffer()
    const buf = Buffer.from(arrayBuffer)

    // Store small responses in cache (only text/html or small sizes)
    const contentType = upstreamRes.headers.get('content-type') || ''
    const storeInCache = buf.length < 2_000_000 // store if < ~2MB
    if (storeInCache) {
      cache.set(cacheKey, {
        buffer: buf,
        headers: { 'content-type': contentType },
        status: upstreamRes.status,
        expiry: Date.now() + CACHE_TTL
      })
      trimCacheIfNeeded()
    }

    // send response
    res.status(upstreamRes.status)
    if (contentType) res.setHeader('Content-Type', contentType)
    return res.send(buf)
  } catch (err) {
    console.error('proxy fetch error', err)
    return res.status(502).send('bad gateway')
  }
})

// Serve static extension files
app.use('/extensions', express.static(EXT_DIR, {
  setHeaders: (res) => {
    // ensure served extension files are CORS-allowed
    console.log('Serving extensions from ./extensions')
    res.setHeader('Access-Control-Allow-Origin', '*')
  }
}))

const port = process.env.PORT || 3000
app.listen(port, () => {
  console.log(`Hayase proxy+static server listening on http://localhost:${port}`)
  console.log(`Proxy endpoint: http://localhost:${port}/proxy?url=<encoded target>`)
  console.log(`Extensions served at: http://localhost:${port}/extensions/`)
})