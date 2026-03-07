import { Router } from 'express'
import { utimes } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const DEFAULT_RESTART_TRIGGER_PATH = fileURLToPath(new URL('../index.js', import.meta.url))

const createDefaultRestartRequester = (triggerFilePath = DEFAULT_RESTART_TRIGGER_PATH) => async () => {
  const now = new Date()
  await utimes(triggerFilePath, now, now)
}

export const createDevRouter = ({ requestServerRestart } = {}) => {
  const router = Router()
  const requestRestart = requestServerRestart || createDefaultRestartRequester()

  router.post('/restart-server', (_req, res) => {
    res.status(202).json({
      status: 'restarting',
    })

    setTimeout(() => {
      requestRestart().catch((error) => {
        console.error('Failed to trigger server restart:', error)
      })
    }, 120)
  })

  return router
}
