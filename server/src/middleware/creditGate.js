/**
 * Middleware that checks the user's credit balance against the Zero Billing
 * service before allowing access to expensive generation endpoints.
 *
 * Requires zOS Bearer token in Authorization header. The billing service
 * validates the JWT itself, so this also serves as auth — no need for
 * separate zOS auth middleware when billing is enabled.
 */

const BALANCE_CACHE_TTL = 60_000 // 1 minute
const MIN_CREDITS = 5_000

export const createCreditGateMiddleware = ({ billingUrl }) => {
  const cache = new Map()

  // Evict expired entries periodically
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of cache) {
      if (now - entry.ts > BALANCE_CACHE_TTL) {
        cache.delete(key)
      }
    }
  }, 30_000)

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
    if (cached && Date.now() - cached.ts < BALANCE_CACHE_TTL) {
      if (cached.totalCredits < MIN_CREDITS) {
        return res.status(402).json({
          error: 'Insufficient credits',
          totalCredits: cached.totalCredits,
          requiredCredits: MIN_CREDITS,
          message: `You need at least ${MIN_CREDITS.toLocaleString()} credits to use the character creator. You have ${cached.totalCredits.toLocaleString()}.`,
        })
      }
      req.creditBalance = cached.totalCredits
      return next()
    }

    // Query the billing service
    try {
      const response = await fetch(`${billingUrl}/api/shanty/credits/balance`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!response.ok) {
        console.error(`Credit balance check failed: HTTP ${response.status}`)
        // If billing service is down, fail open so we don't block users
        // when the service is temporarily unavailable
        if (response.status >= 500) {
          console.warn('Billing service error — failing open')
          return next()
        }
        return res.status(response.status).json({
          error: 'Credit check failed',
          message: 'Unable to verify your credit balance.',
        })
      }

      const { totalCredits } = await response.json()

      // Cache the result
      cache.set(token, { totalCredits, ts: Date.now() })

      if (totalCredits < MIN_CREDITS) {
        return res.status(402).json({
          error: 'Insufficient credits',
          totalCredits,
          requiredCredits: MIN_CREDITS,
          message: `You need at least ${MIN_CREDITS.toLocaleString()} credits to use the character creator. You have ${totalCredits.toLocaleString()}.`,
        })
      }

      req.creditBalance = totalCredits
      next()
    } catch (err) {
      console.error('Credit balance check error:', err.message)
      // Network error — fail open
      console.warn('Billing service unreachable — failing open')
      next()
    }
  }
}
