import { Router } from 'express'
import { toErrorResponse } from '../utils/errors.js'

export const createSpriteRouter = ({ spriteService }) => {
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

  return router
}
