import { Router } from 'express'
import multer from 'multer'
import { AppError, toErrorResponse } from '../utils/errors.js'
import { ensureImageMimeType } from '../utils/mime.js'
import { parseImageDataUrl } from '../utils/dataUrl.js'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
})

export const createCharacterRouter = ({ portraitService, multiviewService, storageService }) => {
  const router = Router()

  router.post('/portrait', upload.single('referenceImage'), async (req, res) => {
    try {
      const prompt = req.body?.prompt || ''
      const portraitAspectRatio = req.body?.portraitAspectRatio || '1:1'
      const portraitPromptPreset = req.body?.portraitPromptPreset || ''
      const referenceImage = req.file || null

      if (!prompt.trim() && !referenceImage) {
        throw new AppError('Provide a prompt, a reference image, or both.', 400)
      }

      if (referenceImage) {
        ensureImageMimeType(referenceImage.mimetype)
      }

      const result = await portraitService.generatePortrait({
        prompt,
        referenceImageBuffer: referenceImage?.buffer || null,
        portraitAspectRatio,
        portraitPromptPreset,
      })

      res.json({
        imageDataUrl: result.imageDataUrl,
        modelUsed: result.modelUsed || '',
        promptUsed: result.promptUsed,
        inputMode: result.inputMode,
        normalizedReferenceImageDataUrl: result.normalizedReferenceImageDataUrl,
      })
    } catch (error) {
      const { statusCode, body } = toErrorResponse(error)
      res.status(statusCode).json(body)
    }
  })

  router.post('/multiview', async (req, res) => {
    try {
      const {
        portraitImageDataUrl,
        originalReferenceImageDataUrl,
        characterPrompt = '',
        multiviewPrompt = '',
        mode = 'full',
      } = req.body || {}

      if (!['full', 'front-only'].includes(mode)) {
        throw new AppError('Unsupported multiview mode.', 400)
      }

      const portrait = parseImageDataUrl(portraitImageDataUrl)
      const originalReference = originalReferenceImageDataUrl
        ? parseImageDataUrl(originalReferenceImageDataUrl)
        : null

      const result = await multiviewService.generateMultiview({
        portraitBuffer: portrait.buffer,
        originalReferenceBuffer: originalReference?.buffer || null,
        characterPrompt,
        multiviewPrompt,
        mode,
      })

      res.json({
        mode: result.mode,
        modelUsage: result.modelUsage || null,
        views: {
          front: {
            imageDataUrl: result.views.front.imageDataUrl,
            source: result.views.front.source,
          },
          back: {
            imageDataUrl: result.views.back.imageDataUrl,
            source: result.views.back.source,
          },
          left: {
            imageDataUrl: result.views.left.imageDataUrl,
            source: result.views.left.source,
          },
          right: {
            imageDataUrl: result.views.right.imageDataUrl,
            source: result.views.right.source,
          },
        },
        promptMetadata: result.promptMetadata,
      })
    } catch (error) {
      const { statusCode, body } = toErrorResponse(error)
      res.status(statusCode).json(body)
    }
  })

  /**
   * POST /api/characters/store
   *
   * Persist portrait image and 3D model URL for a player.
   * Called after sprite creation so assets are archived for future use.
   *
   * Body: { playerId, portraitDataUrl, modelUrl }
   */
  router.post('/store', async (req, res) => {
    try {
      const { playerId, portraitDataUrl, modelUrl } = req.body || {}

      if (!playerId) {
        throw new AppError('playerId is required', 400)
      }

      const stored = {}

      if (portraitDataUrl) {
        const parsed = parseImageDataUrl(portraitDataUrl)
        stored.portraitUrl = await storageService.uploadPlayerAsset(
          playerId,
          'portrait.png',
          parsed.buffer,
        )
      }

      if (modelUrl) {
        stored.modelUrl = modelUrl
        // Save model URL as a small JSON manifest alongside the sprite
        const manifest = JSON.stringify({ modelUrl, storedAt: new Date().toISOString() })
        await storageService.uploadPlayerAsset(
          playerId,
          'model.json',
          Buffer.from(manifest, 'utf8'),
        )
      }

      res.json({ ok: true, ...stored })
    } catch (error) {
      const { statusCode, body } = toErrorResponse(error)
      res.status(statusCode).json(body)
    }
  })

  router.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Reference image exceeds the 10MB upload limit.' })
    }

    if (error) {
      const { statusCode, body } = toErrorResponse(error)
      return res.status(statusCode).json(body)
    }
  })

  return router
}
