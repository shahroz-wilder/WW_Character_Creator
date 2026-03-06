import express from 'express'
import cors from 'cors'
import { fileURLToPath } from 'node:url'
import { loadEnv } from './config/env.js'
import { createGeminiClient } from './api/geminiClient.js'
import { createTripoClient } from './api/tripoClient.js'
import { createPixellabClient } from './api/pixellabClient.js'
import { createPortraitService } from './services/portraitService.js'
import { createMultiviewService } from './services/multiviewService.js'
import { createTripoService } from './services/tripoService.js'
import { createSpriteService } from './services/spriteService.js'
import { createHealthRouter } from './routes/health.js'
import { createCharacterRouter } from './routes/character.js'
import { createTripoRouter } from './routes/tripo.js'
import { createSpriteRouter } from './routes/sprite.js'
import { createDevRouter } from './routes/dev.js'

export const createApp = (config = loadEnv(), services = {}) => {
  const geminiClient =
    services.geminiClient ||
    createGeminiClient({ apiKey: config.geminiApiKey })
  const tripoClient =
    services.tripoClient ||
    createTripoClient({
      apiKey: config.tripoApiKey,
      baseUrl: config.tripoBaseUrl,
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
    })
  const spriteService =
    services.spriteService ||
    createSpriteService({
      pixellabClient,
    })

  const app = express()

  app.use(
    cors({
      origin: config.clientOrigin.split(',').map((value) => value.trim()),
    }),
  )
  app.use(express.json({ limit: '20mb' }))
  app.use(express.urlencoded({ extended: true }))

  app.use('/api/health', createHealthRouter())
  app.use('/api/character', createCharacterRouter({ portraitService, multiviewService }))
  app.use('/api/tripo', createTripoRouter({ tripoService }))
  app.use('/api/sprites', createSpriteRouter({ spriteService }))
  app.use('/api/dev', createDevRouter({ requestServerRestart: services.requestServerRestart }))

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
