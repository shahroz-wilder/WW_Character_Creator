import express from 'express'
import cors from 'cors'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { loadEnv } from './config/env.js'
import { createGeminiClient } from './api/geminiClient.js'
import { createTripoClient } from './api/tripoClient.js'
import { createPixellabClient } from './api/pixellabClient.js'
import { createPortraitService } from './services/portraitService.js'
import { createMultiviewService } from './services/multiviewService.js'
import { createTripoService } from './services/tripoService.js'
import { createSpriteService } from './services/spriteService.js'
import { createStorageService } from './services/storageService.js'
import { createHealthRouter } from './routes/health.js'
import { createCharacterRouter } from './routes/character.js'
import { createTripoRouter } from './routes/tripo.js'
import { createSpriteRouter } from './routes/sprite.js'
import { createDevRouter } from './routes/dev.js'
import { createTaskAuditLogger } from './utils/taskAuditLogger.js'
import { createZosAuthMiddleware } from './middleware/zosAuth.js'
import { createCreditGateMiddleware } from './middleware/creditGate.js'

export const createApp = (config = loadEnv(), services = {}) => {
  const taskAuditLogger = services.taskAuditLogger || createTaskAuditLogger()
  const geminiClient =
    services.geminiClient ||
    createGeminiClient({ apiKey: config.geminiApiKey })
  const tripoClient =
    services.tripoClient ||
    createTripoClient({
      apiKey: config.tripoApiKey,
      baseUrl: config.tripoBaseUrl,
      auditLogger: taskAuditLogger,
    })
  const pixellabClient =
    services.pixellabClient ||
    createPixellabClient({
      apiKey: config.pixellabApiKey,
      baseUrl: config.pixellabBaseUrl,
    })

  const portraitService =
    services.portraitService ||
    createPortraitService({
      geminiClient,
      geminiModel: config.geminiImageModel,
      geminiFallbackModels: config.geminiImageFallbackModels,
    })
  const multiviewService =
    services.multiviewService ||
    createMultiviewService({
      geminiClient,
      geminiModel: config.geminiImageModel,
      geminiFallbackModels: config.geminiImageFallbackModels,
    })
  const tripoService =
    services.tripoService ||
    createTripoService({
      tripoClient,
      config,
      taskAuditLogger,
    })
  const spriteService =
    services.spriteService ||
    createSpriteService({
      pixellabClient,
    })
  const storageService =
    services.storageService ||
    createStorageService({ config })

  const app = express()

  app.use(
    cors({
      origin: config.clientOrigin.split(',').map((value) => value.trim()),
    }),
  )
  app.use(express.json({ limit: '20mb' }))
  app.use(express.urlencoded({ extended: true }))

  app.use('/api/health', createHealthRouter({ config }))

  // Gate generation routes behind auth + optional credit check.
  // When ZERO_BILLING_URL is set, the credit gate also validates the auth token
  // (the billing service's balance endpoint requires a valid JWT), so we skip
  // the separate zOS auth middleware to avoid double-checking.
  const protectedPaths = ['/api/character', '/api/tripo', '/api/sprites']

  if (config.zeroBillingUrl) {
    const creditGate = createCreditGateMiddleware({ billingUrl: config.zeroBillingUrl })
    app.use(protectedPaths, creditGate)
    console.log(`Credit gate enabled (auth + balance check via ${config.zeroBillingUrl})`)
  } else if (config.zosApiUrl) {
    const zosAuth = createZosAuthMiddleware({ zosApiUrl: config.zosApiUrl })
    app.use(protectedPaths, zosAuth)
    console.log(`zOS auth enabled (validating against ${config.zosApiUrl})`)
  }

  // Proxy credit balance from billing service so the client doesn't need
  // to know the billing URL directly.
  if (config.zeroBillingUrl) {
    app.get('/api/credits/balance', async (req, res) => {
      const authHeader = req.headers.authorization
      if (!authHeader) {
        return res.status(401).json({ error: 'Missing authorization token' })
      }
      try {
        const response = await fetch(`${config.zeroBillingUrl}/api/shanty/credits/balance`, {
          headers: { Authorization: authHeader },
        })
        const data = await response.json()
        res.status(response.status).json(data)
      } catch (err) {
        console.error('Failed to proxy credit balance:', err.message)
        res.status(502).json({ error: 'Billing service unavailable' })
      }
    })
  }

  app.use('/api/character', createCharacterRouter({ portraitService, multiviewService, storageService }))
  app.use('/api/tripo', createTripoRouter({ tripoService }))
  // Serve stored sprite sheets with immutable cache headers
  app.use('/sprites', express.static(storageService.spritesDir, {
    maxAge: '365d',
    immutable: true,
  }))

  app.use('/api/sprites', createSpriteRouter({ spriteService, storageService }))
  app.use('/api/dev', createDevRouter({ requestServerRestart: services.requestServerRestart }))

  // In production, serve the built client SPA from ../client/dist
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const clientDist = path.resolve(__dirname, '../../client/dist')
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist))
    // SPA fallback — serve index.html for any non-API/non-sprite route
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/sprites/')) {
        return next()
      }
      res.sendFile(path.join(clientDist, 'index.html'))
    })
    console.log(`Serving client SPA from ${clientDist}`)
  }

  app.use((error, _req, res, _next) => {
    console.error(error)
    res.status(500).json({ error: 'Unexpected server error.' })
  })

  return app
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]

if (isMainModule) {
  const config = loadEnv()
  const app = createApp(config)

  app.listen(config.port, () => {
    console.log(`WW Character server listening on http://localhost:${config.port}`)
  })
}
