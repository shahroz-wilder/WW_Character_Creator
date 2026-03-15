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
      if (cached.balance < MIN_CREDITS) {
        return res.status(402).json({
          error: 'Insufficient credits',
          balance: cached.balance,
          requiredCredits: MIN_CREDITS,
          message: `You need at least ${MIN_CREDITS.toLocaleString()} credits to use the character creator. You have ${cached.balance.toLocaleString()}.`,
        })
      }
      req.creditBalance = cached.balance
      return next()
    }

    // Query the billing service
    try {
      const response = await fetch(`${billingUrl}/api/credits/balance`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!response.ok) {
        console.error(`Credit balance check failed: HTTP ${response.status}`)
        if (response.status >= 500) {
          console.warn('Billing service error — failing open')
          return next()
        }
        return res.status(response.status).json({
          error: 'Credit check failed',
          message: 'Unable to verify your credit balance.',
        })
      }

      const { balance } = await response.json()

      cache.set(token, { balance, ts: Date.now() })

      if (balance < MIN_CREDITS) {
        return res.status(402).json({
          error: 'Insufficient credits',
          balance,
          requiredCredits: MIN_CREDITS,
          message: `You need at least ${MIN_CREDITS.toLocaleString()} credits to use the character creator. You have ${balance.toLocaleString()}.`,
        })
      }

      req.creditBalance = balance
      next()
    } catch (err) {
      console.error('Credit balance check error:', err.message)
      console.warn('Billing service unreachable — failing open')
      next()
    }
  }
}

/**
 * Debit credits from a user's balance via the billing service.
 * Uses the internal service token for server-to-server auth.
 */
export const debitCredits = async ({ billingUrl, internalToken, userToken, amount, reason, referenceId, metadata }) => {
  // Determine auth method: internal token (preferred) or user JWT
  const headers = { 'Content-Type': 'application/json' }
  const body = { amount, reason }

  if (referenceId) body.referenceId = referenceId
  if (metadata) body.metadata = metadata

  if (internalToken) {
    headers['X-Internal-Token'] = internalToken
    // For internal auth, we need to extract userId from the user's token.
    // Pass the user token to the balance endpoint first to identify them,
    // or let the caller provide zeroUserId directly.
    if (metadata?.zeroUserId) {
      body.zeroUserId = metadata.zeroUserId
    }
  } else if (userToken) {
    headers['Authorization'] = `Bearer ${userToken}`
  }

  const response = await fetch(`${billingUrl}/api/credits/debit`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.message || `Debit failed: HTTP ${response.status}`)
  }

  return response.json()
}
