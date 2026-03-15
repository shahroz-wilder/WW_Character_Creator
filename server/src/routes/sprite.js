import { Router } from 'express'
import { toErrorResponse } from '../utils/errors.js'
import { assembleSheet } from '../services/sheetAssemblerService.js'
import { debitCredits } from '../middleware/creditGate.js'

const PIPELINE_CREDIT_COST = 5_000

export const createSpriteRouter = ({ spriteService, storageService, billingConfig }) => {
  const router = Router()

  router.post('/run', async (req, res) => {
    try {
      const result = await spriteService.generateRunSprites({
        views: req.body?.views,
        spriteSize: req.body?.spriteSize ?? 128,
      })

      res.json(result)
    } catch (error) {
      const { statusCode, body } = toErrorResponse(error)
      res.status(statusCode).json(body)
    }
  })

  /**
   * POST /api/sprites/create
   *
   * Assemble 8-direction frame data into a sprite sheet, store it, and
   * return a public URL + content hash + base64 data.
   *
   * This is the endpoint the embedded game client calls (via callbackUrl)
   * after the user finalizes their character sprite.
   *
   * Body: { playerId, directions: { front: { frameDataUrls }, ... }, spriteSize? }
   * Response: { sprite_url, sprite_hash, sprite_data }
   */
  router.post('/create', async (req, res) => {
    try {
      const { playerId, directions, idleDirections, spriteSize } = req.body || {}

      if (!playerId) {
        return res.status(400).json({ error: 'playerId is required' })
      }

      if (!directions || typeof directions !== 'object') {
        return res.status(400).json({ error: 'directions object is required' })
      }

      const { buffer, hash } = await assembleSheet({ directions, idleDirections, spriteSize: spriteSize ?? 128 })

      const spriteUrl = await storageService.uploadSpriteSheet(playerId, buffer, hash)

      // Debit credits after successful sprite creation
      if (billingConfig?.billingUrl) {
        const token = req.headers.authorization?.slice(7)
        try {
          await debitCredits({
            billingUrl: billingConfig.billingUrl,
            userToken: token,
            amount: PIPELINE_CREDIT_COST,
            reason: 'character-creator',
            referenceId: `sprite-${playerId}-${hash}`,
          })
          console.log(`Debited ${PIPELINE_CREDIT_COST} credits for player ${playerId}`)
        } catch (err) {
          // Log but don't fail the request — sprite was already created
          console.error('Credit debit failed (sprite already created):', err.message)
        }
      }

      res.json({
        sprite_url: spriteUrl,
        sprite_hash: hash,
        sprite_data: `data:image/png;base64,${buffer.toString('base64')}`,
      })
    } catch (error) {
      const { statusCode, body } = toErrorResponse(error)
      res.status(statusCode).json(body)
    }
  })

  return router
}
