import { Router } from 'express'
import { toErrorResponse } from '../utils/errors.js'
import { assembleSheet } from '../services/sheetAssemblerService.js'

export const createSpriteRouter = ({ spriteService, storageService }) => {
  const router = Router()

  router.post('/run', async (req, res) => {
    try {
      const result = await spriteService.generateRunSprites({
        views: req.body?.views,
        spriteSize: req.body?.spriteSize ?? 64,
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
      const { playerId, directions, spriteSize } = req.body || {}

      if (!playerId) {
        return res.status(400).json({ error: 'playerId is required' })
      }

      if (!directions || typeof directions !== 'object') {
        return res.status(400).json({ error: 'directions object is required' })
      }

      const { buffer, hash } = await assembleSheet(directions, spriteSize ?? 128)

      const spriteUrl = await storageService.uploadSpriteSheet(playerId, buffer, hash)

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
