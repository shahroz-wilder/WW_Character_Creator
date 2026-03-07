import { Router } from 'express'
import { toErrorResponse } from '../utils/errors.js'

export const createTripoRouter = ({ tripoService }) => {
  const router = Router()

  router.post('/tasks', async (req, res) => {
    try {
      const result = await tripoService.createTaskFromViews(req.body?.views, {
        animationMode: req.body?.animationMode,
        meshQuality: req.body?.meshQuality,
        textureQuality: req.body?.textureQuality,
      })
      res.json(result)
    } catch (error) {
      const { statusCode, body } = toErrorResponse(error)
      res.status(statusCode).json(body)
    }
  })

  router.post('/tasks/front', async (req, res) => {
    try {
      const result = await tripoService.createTaskFromFrontView(req.body?.imageDataUrl, {
        animationMode: req.body?.animationMode,
        meshQuality: req.body?.meshQuality,
        textureQuality: req.body?.textureQuality,
      })
      res.json(result)
    } catch (error) {
      const { statusCode, body } = toErrorResponse(error)
      res.status(statusCode).json(body)
    }
  })

  router.post('/tasks/front-back', async (req, res) => {
    try {
      const result = await tripoService.createTaskFromFrontBackViews(req.body?.views, {
        animationMode: req.body?.animationMode,
        meshQuality: req.body?.meshQuality,
        textureQuality: req.body?.textureQuality,
      })
      res.json(result)
    } catch (error) {
      const { statusCode, body } = toErrorResponse(error)
      res.status(statusCode).json(body)
    }
  })

  router.post('/tasks/:taskId/rig', async (req, res) => {
    try {
      const result = await tripoService.createRigTask(req.params.taskId)
      res.json(result)
    } catch (error) {
      const { statusCode, body } = toErrorResponse(error)
      res.status(statusCode).json(body)
    }
  })

  router.post('/tasks/:taskId/retarget', async (req, res) => {
    try {
      const result = await tripoService.createRetargetTask(req.params.taskId, {
        animationName: req.body?.animationName,
      })
      res.json(result)
    } catch (error) {
      const { statusCode, body } = toErrorResponse(error)
      res.status(statusCode).json(body)
    }
  })

  router.get('/tasks/:taskId', async (req, res) => {
    try {
      const summary = await tripoService.getTaskSummary(req.params.taskId, {
        animationMode: req.query?.animationMode,
      })
      res.json({
        taskId: summary.taskId,
        taskType: summary.taskType,
        sourceTaskId: summary.sourceTaskId,
        status: summary.status,
        progress: summary.progress,
        error: summary.error,
        outputs: summary.outputs,
      })
    } catch (error) {
      const { statusCode, body } = toErrorResponse(error)
      res.status(statusCode).json(body)
    }
  })

  router.get('/tasks/:taskId/model', async (req, res) => {
    try {
      const asset = await tripoService.getModelAsset(req.params.taskId, req.query.variant, {
        animationMode: req.query?.animationMode,
      })
      const contentType = asset.response.headers.get('content-type') || 'model/gltf-binary'
      const contentLength = asset.response.headers.get('content-length')

      res.setHeader('Content-Type', contentType)
      res.setHeader('Content-Disposition', `inline; filename="${req.params.taskId}-${asset.variant}.glb"`)
      if (contentLength) {
        res.setHeader('Content-Length', contentLength)
      }

      const arrayBuffer = await asset.response.arrayBuffer()
      res.send(Buffer.from(arrayBuffer))
    } catch (error) {
      const { statusCode, body } = toErrorResponse(error)
      res.status(statusCode).json(body)
    }
  })

  return router
}
