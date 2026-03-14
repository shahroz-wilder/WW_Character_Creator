/**
 * Middleware that validates zOS Bearer tokens against the ZERO API.
 * Caches valid tokens for 5 minutes to avoid hitting zOS on every request.
 */

const TOKEN_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export const createZosAuthMiddleware = ({ zosApiUrl }) => {
  const cache = new Map()

  // Evict expired entries periodically
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of cache) {
      if (now - entry.ts > TOKEN_CACHE_TTL) {
        cache.delete(key)
      }
    }
  }, 60_000)

  return async (req, res, next) => {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization token' })
    }

    const token = authHeader.slice(7)
    if (!token) {
      return res.status(401).json({ error: 'Missing authorization token' })
    }

    // Check cache
    const cached = cache.get(token)
    if (cached && Date.now() - cached.ts < TOKEN_CACHE_TTL) {
      req.zosUser = cached.user
      return next()
    }

    // Validate against zOS API
    try {
      const response = await fetch(`${zosApiUrl}/api/users/current`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!response.ok) {
        cache.delete(token)
        return res.status(401).json({ error: 'Invalid or expired token' })
      }

      const user = await response.json()
      cache.set(token, { user, ts: Date.now() })
      req.zosUser = user
      next()
    } catch (err) {
      console.error('zOS auth validation failed:', err.message)
      return res.status(502).json({ error: 'Authentication service unavailable' })
    }
  }
}
