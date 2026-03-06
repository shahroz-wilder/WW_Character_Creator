import request from 'supertest'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { loadEnv } from '../config/env.js'
import { createApp } from '../index.js'
import { mirrorHorizontally } from '../services/imageTransformService.js'
import {
  buildPortraitPrompt,
  buildViewPrompt,
  DEFAULT_MULTIVIEW_PROMPT,
} from '../services/promptBuilder.js'
import { createSpriteService } from '../services/spriteService.js'
import { createTripoService } from '../services/tripoService.js'
import { normalizeErrorMessage } from '../utils/errors.js'

const TEST_CONFIG = {
  port: 5000,
  clientOrigin: 'http://localhost:5173',
  geminiApiKey: 'gemini-key',
  geminiImageModel: 'gemini-3.1-flash-image-preview',
  tripoApiKey: 'tsk_test',
  tripoBaseUrl: 'https://api.tripo3d.ai/v2/openapi',
  tripoModelVersion: 'v3.1-20260211',
  tripoTexture: true,
  tripoPbr: true,
  tripoTextureQuality: 'standard',
  tripoTextureAlignment: 'original_image',
  tripoOrientation: 'default',
  tripoRigMixamo: false,
  tripoRigFormat: 'glb',
  tripoRigType: 'biped',
  tripoRigSpec: 'mixamo',
  tripoRigModelVersion: 'v2.0-20250506',
  tripoIdleAnimationEnabled: false,
  tripoIdleAnimationTaskType: 'animate_model',
  tripoIdleAnimationName: 'idle',
  tripoIdleAnimationInPlace: true,
  pixellabApiKey: 'pxl_test',
  pixellabBaseUrl: 'https://api.pixellab.ai/v1',
}

const noopMultiviewService = {
  generateMultiview: vi.fn(),
}

const noopTripoService = {
  createTaskFromViews: vi.fn(),
  createTaskFromFrontBackViews: vi.fn(),
  createTaskFromFrontView: vi.fn(),
  getTaskSummary: vi.fn(),
  getModelAsset: vi.fn(),
}

const noopSpriteService = {
  generateRunSprites: vi.fn(),
}

describe('loadEnv', () => {
  it('rejects missing API keys', () => {
    expect(() => loadEnv({})).toThrow(/GEMINI_API_KEY, TRIPO_API_KEY, PIXELLAB_API_KEY/)
  })
})

describe('dev route', () => {
  it('accepts restart requests and triggers the restart callback', async () => {
    vi.useFakeTimers()

    try {
      const requestServerRestart = vi.fn().mockResolvedValue(undefined)
      const app = createApp(TEST_CONFIG, {
        portraitService: { generatePortrait: vi.fn() },
        multiviewService: noopMultiviewService,
        tripoService: noopTripoService,
        spriteService: noopSpriteService,
        requestServerRestart,
      })

      const response = await request(app)
        .post('/api/dev/restart-server')
        .send({})

      expect(response.status).toBe(202)
      expect(response.body.status).toBe('restarting')
      await vi.runAllTimersAsync()
      expect(requestServerRestart).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('error normalization', () => {
  it('reduces Gemini quota payloads to a readable message', () => {
    const message = normalizeErrorMessage({
      message: JSON.stringify({
        error: {
          status: 'RESOURCE_EXHAUSTED',
          message: 'Quota exceeded for metric.',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.RetryInfo',
              retryDelay: '4s',
            },
          ],
        },
      }),
    })

    expect(message).toBe(
      'Gemini quota exceeded for image generation. Check billing or quota for your Google project, or retry in about 4 seconds.',
    )
  })
})

describe('promptBuilder', () => {
  it('keeps portrait preset and aspect ratio when prompt+reference are both provided', () => {
    const prompt = buildPortraitPrompt({
      prompt: 'keep scar on right cheek',
      hasReferenceImage: true,
      portraitPromptPreset: 'Custom preset sentence.',
      portraitAspectRatio: '3:4',
    })

    expect(prompt).toContain('Custom preset sentence.')
    expect(prompt).toContain('Output aspect ratio: 3:4.')
    expect(prompt).toContain('Apply this direction while preserving identity')
  })

  it('injects the correct view labels', () => {
    expect(
      buildViewPrompt({
        view: 'front',
        characterPrompt: 'pilot',
        multiviewPrompt: DEFAULT_MULTIVIEW_PROMPT,
      }),
    ).toContain('FRONT VIEW ONLY')

    expect(
      buildViewPrompt({
        view: 'back',
        characterPrompt: 'pilot',
        multiviewPrompt: DEFAULT_MULTIVIEW_PROMPT,
      }),
    ).toContain('BACK VIEW ONLY')

    expect(
      buildViewPrompt({
        view: 'left',
        characterPrompt: 'pilot',
        multiviewPrompt: DEFAULT_MULTIVIEW_PROMPT,
      }),
    ).toContain('LEFT VIEW ONLY')
  })
})

describe('mirrorHorizontally', () => {
  it('returns the same image dimensions with flipped pixels', async () => {
    const source = await sharp(
      Buffer.from([
        255, 0, 0,
        0, 0, 255,
      ]),
      { raw: { width: 2, height: 1, channels: 3 } },
    )
      .png()
      .toBuffer()

    const mirrored = await mirrorHorizontally(source)
    const sourcePixels = await sharp(source).raw().toBuffer()
    const mirroredPixels = await sharp(mirrored).raw().toBuffer()
    const metadata = await sharp(mirrored).metadata()

    expect(metadata.width).toBe(2)
    expect(metadata.height).toBe(1)
    expect(Array.from(sourcePixels)).toEqual([255, 0, 0, 0, 0, 255])
    expect(Array.from(mirroredPixels)).toEqual([0, 0, 255, 255, 0, 0])
  })
})

describe('portrait route', () => {
  const createPortraitApp = () => {
    const portraitService = {
      generatePortrait: vi.fn(async ({ prompt, referenceImageBuffer }) => ({
        imageDataUrl: 'data:image/png;base64,cG9ydHJhaXQ=',
        modelUsed: 'models/gemini-3.1-flash-image-preview',
        promptUsed: prompt || 'fallback',
        inputMode: prompt?.trim() && referenceImageBuffer ? 'prompt+image' : prompt?.trim() ? 'prompt' : 'image',
        normalizedReferenceImageDataUrl: referenceImageBuffer
          ? 'data:image/png;base64,cmVm'
          : null,
      })),
    }

    return {
      portraitService,
      app: createApp(TEST_CONFIG, {
        portraitService,
        multiviewService: noopMultiviewService,
        tripoService: noopTripoService,
        spriteService: noopSpriteService,
      }),
    }
  }

  it('accepts prompt-only requests', async () => {
    const { app, portraitService } = createPortraitApp()

    const response = await request(app)
      .post('/api/character/portrait')
      .field('prompt', 'stylized ranger')

    expect(response.status).toBe(200)
    expect(response.body.inputMode).toBe('prompt')
    expect(response.body.modelUsed).toBe('models/gemini-3.1-flash-image-preview')
    expect(portraitService.generatePortrait).toHaveBeenCalledWith({
      prompt: 'stylized ranger',
      referenceImageBuffer: null,
      portraitAspectRatio: '1:1',
      portraitPromptPreset: '',
    })
  })

  it('accepts image-only requests', async () => {
    const { app } = createPortraitApp()

    const response = await request(app)
      .post('/api/character/portrait')
      .attach('referenceImage', Buffer.from('fake-image'), 'ref.png')

    expect(response.status).toBe(200)
    expect(response.body.inputMode).toBe('image')
  })

  it('accepts prompt and image requests', async () => {
    const { app } = createPortraitApp()

    const response = await request(app)
      .post('/api/character/portrait')
      .field('prompt', 'armored scout')
      .attach('referenceImage', Buffer.from('fake-image'), 'ref.png')

    expect(response.status).toBe(200)
    expect(response.body.inputMode).toBe('prompt+image')
  })

  it('rejects empty requests', async () => {
    const { app } = createPortraitApp()

    const response = await request(app)
      .post('/api/character/portrait')

    expect(response.status).toBe(400)
    expect(response.body.error).toMatch(/Provide a prompt/)
  })
})

describe('multiview route', () => {
  it('accepts front-only mode requests', async () => {
    const multiviewService = {
      generateMultiview: vi.fn(async ({ mode }) => ({
        mode,
        views: {
          front: { imageDataUrl: 'data:image/png;base64,Zm9v', source: 'gemini' },
          back: { imageDataUrl: '', source: 'front-test' },
          left: { imageDataUrl: '', source: 'front-test' },
          right: { imageDataUrl: '', source: 'front-test' },
        },
        promptMetadata: {
          frontPrompt: 'front',
          backPrompt: 'back',
          leftPrompt: 'left',
          multiviewPromptBase: DEFAULT_MULTIVIEW_PROMPT,
        },
        modelUsage: {
          front: 'models/gemini-3.1-flash-image-preview',
          back: '',
          left: '',
          right: '',
        },
      })),
    }
    const app = createApp(TEST_CONFIG, {
      portraitService: {
        generatePortrait: vi.fn(),
      },
      multiviewService,
      tripoService: noopTripoService,
      spriteService: noopSpriteService,
    })

    const response = await request(app)
      .post('/api/character/multiview')
      .send({
        portraitImageDataUrl: 'data:image/png;base64,Zm9v',
        originalReferenceImageDataUrl: null,
        characterPrompt: 'pilot',
        multiviewPrompt: DEFAULT_MULTIVIEW_PROMPT,
        mode: 'front-only',
      })

    expect(response.status).toBe(200)
    expect(response.body.mode).toBe('front-only')
    expect(response.body.modelUsage.front).toBe('models/gemini-3.1-flash-image-preview')
    expect(multiviewService.generateMultiview).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'front-only',
      }),
    )
  })
})

describe('sprite route', () => {
  const makeDataUrl = async (color = { r: 255, g: 255, b: 255 }) => {
    const buffer = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: color,
      },
    })
      .png()
      .toBuffer()

    return `data:image/png;base64,${buffer.toString('base64')}`
  }

  const createSpriteApp = () => {
    const spriteService = {
      generateRunSprites: vi.fn(async ({ spriteSize }) => ({
        animation: 'run',
        spriteSize,
        directions: {
          front: { previewDataUrl: 'data:image/png;base64,Zm9v', source: 'pixellab', frames: { count: 8 } },
          back: { previewDataUrl: 'data:image/png;base64,YmFy', source: 'pixellab', frames: { count: 8 } },
          left: { previewDataUrl: 'data:image/png;base64,YmF6', source: 'pixellab', frames: { count: 8 } },
          right: { previewDataUrl: 'data:image/png;base64,cXV4', source: 'pixellab', frames: { count: 8 } },
        },
      })),
    }

    return {
      spriteService,
      app: createApp(TEST_CONFIG, {
        portraitService: { generatePortrait: vi.fn() },
        multiviewService: noopMultiviewService,
        tripoService: noopTripoService,
        spriteService,
      }),
    }
  }

  it('rejects missing direction views', async () => {
    const spriteService = createSpriteService({
      pixellabClient: {
        estimateSkeleton: vi.fn(),
        animateWithSkeleton: vi.fn(),
      },
    })
    const app = createApp(TEST_CONFIG, {
      portraitService: { generatePortrait: vi.fn() },
      multiviewService: noopMultiviewService,
      tripoService: noopTripoService,
      spriteService,
    })

    const response = await request(app)
      .post('/api/sprites/run')
      .send({
        views: {
          front: await makeDataUrl(),
          back: await makeDataUrl(),
        },
        spriteSize: 64,
      })

    expect(response.status).toBe(400)
    expect(response.body.error).toMatch(/Missing required multiview directions/i)
  })

  it('accepts valid payload with spriteSize 64', async () => {
    const { app, spriteService } = createSpriteApp()
    const viewDataUrl = await makeDataUrl()

    const response = await request(app)
      .post('/api/sprites/run')
      .send({
        views: {
          front: viewDataUrl,
          back: viewDataUrl,
          left: viewDataUrl,
          right: viewDataUrl,
        },
        spriteSize: 64,
      })

    expect(response.status).toBe(200)
    expect(response.body.animation).toBe('run')
    expect(response.body.spriteSize).toBe(64)
    expect(spriteService.generateRunSprites).toHaveBeenCalledWith(
      expect.objectContaining({
        spriteSize: 64,
      }),
    )
  })

  it('accepts valid payload with spriteSize 128', async () => {
    const { app, spriteService } = createSpriteApp()
    const viewDataUrl = await makeDataUrl()

    const response = await request(app)
      .post('/api/sprites/run')
      .send({
        views: {
          front: viewDataUrl,
          back: viewDataUrl,
          left: viewDataUrl,
          right: viewDataUrl,
        },
        spriteSize: 128,
      })

    expect(response.status).toBe(200)
    expect(response.body.spriteSize).toBe(128)
    expect(spriteService.generateRunSprites).toHaveBeenCalledWith(
      expect.objectContaining({
        spriteSize: 128,
      }),
    )
  })

  it('accepts valid payload with spriteSize 84', async () => {
    const { app, spriteService } = createSpriteApp()
    const viewDataUrl = await makeDataUrl()

    const response = await request(app)
      .post('/api/sprites/run')
      .send({
        views: {
          front: viewDataUrl,
          back: viewDataUrl,
          left: viewDataUrl,
          right: viewDataUrl,
        },
        spriteSize: 84,
      })

    expect(response.status).toBe(200)
    expect(response.body.spriteSize).toBe(84)
    expect(spriteService.generateRunSprites).toHaveBeenCalledWith(
      expect.objectContaining({
        spriteSize: 84,
      }),
    )
  })

  it('rejects unsupported sprite size', async () => {
    const pngDataUrl = await makeDataUrl()
    const spriteService = createSpriteService({
      pixellabClient: {
        estimateSkeleton: vi.fn(),
        animateWithSkeleton: vi.fn(),
      },
    })
    const app = createApp(TEST_CONFIG, {
      portraitService: { generatePortrait: vi.fn() },
      multiviewService: noopMultiviewService,
      tripoService: noopTripoService,
      spriteService,
    })

    const response = await request(app)
      .post('/api/sprites/run')
      .send({
        views: {
          front: pngDataUrl,
          back: pngDataUrl,
          left: pngDataUrl,
          right: pngDataUrl,
        },
        spriteSize: 96,
      })

    expect(response.status).toBe(400)
    expect(response.body.error).toMatch(/Sprite size must be one of: 64, 84, 128/i)
  })
})

describe('tripoService', () => {
  it('uploads turnaround views in front-left-back-right order', async () => {
    const makeDataUrl = async (color) => {
      const buffer = await sharp({
        create: {
          width: 1,
          height: 1,
          channels: 3,
          background: color,
        },
      })
        .png()
        .toBuffer()

      return `data:image/png;base64,${buffer.toString('base64')}`
    }

    const uploadImageBuffer = vi
      .fn()
      .mockResolvedValueOnce({ file_token: 'front-token', type: 'jpg' })
      .mockResolvedValueOnce({ file_token: 'left-token', type: 'jpg' })
      .mockResolvedValueOnce({ file_token: 'back-token', type: 'jpg' })
      .mockResolvedValueOnce({ file_token: 'right-token', type: 'jpg' })
    const createMultiviewTask = vi.fn().mockResolvedValue('task-123')
    const tripoService = createTripoService({
      tripoClient: {
        uploadImageBuffer,
        createMultiviewTask,
        createImageTask: vi.fn(),
        getTask: vi.fn(),
        fetchRemoteAsset: vi.fn(),
      },
      config: TEST_CONFIG,
    })

    await tripoService.createTaskFromViews({
      front: await makeDataUrl({ r: 255, g: 0, b: 0 }),
      back: await makeDataUrl({ r: 0, g: 255, b: 0 }),
      left: await makeDataUrl({ r: 0, g: 0, b: 255 }),
      right: await makeDataUrl({ r: 255, g: 255, b: 0 }),
    })

    expect(uploadImageBuffer).toHaveBeenCalledTimes(4)
    expect(createMultiviewTask).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [
          { file_token: 'front-token', type: 'jpg' },
          { file_token: 'left-token', type: 'jpg' },
          { file_token: 'back-token', type: 'jpg' },
          { file_token: 'right-token', type: 'jpg' },
        ],
      }),
    )
  })

  it('uploads front+back views into front/back multiview slots', async () => {
    const makeDataUrl = async (color) => {
      const buffer = await sharp({
        create: {
          width: 1,
          height: 1,
          channels: 3,
          background: color,
        },
      })
        .png()
        .toBuffer()

      return `data:image/png;base64,${buffer.toString('base64')}`
    }

    const uploadImageBuffer = vi
      .fn()
      .mockResolvedValueOnce({ file_token: 'front-token', type: 'jpg' })
      .mockResolvedValueOnce({ file_token: 'back-token', type: 'jpg' })
    const createMultiviewTask = vi.fn().mockResolvedValue('task-front-back-123')
    const tripoService = createTripoService({
      tripoClient: {
        uploadImageBuffer,
        createMultiviewTask,
        createImageTask: vi.fn(),
        getTask: vi.fn(),
        fetchRemoteAsset: vi.fn(),
      },
      config: TEST_CONFIG,
    })

    const result = await tripoService.createTaskFromFrontBackViews({
      front: await makeDataUrl({ r: 255, g: 0, b: 0 }),
      back: await makeDataUrl({ r: 0, g: 255, b: 0 }),
    })

    expect(uploadImageBuffer).toHaveBeenCalledTimes(2)
    expect(createMultiviewTask).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [
          { file_token: 'front-token', type: 'jpg' },
          {},
          { file_token: 'back-token', type: 'jpg' },
          {},
        ],
      }),
    )
    expect(result).toEqual({
      taskId: 'task-front-back-123',
      status: 'queued',
    })
  })

  it('creates image-to-model tasks from a single front image', async () => {
    const buffer = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer()

    const uploadImageBuffer = vi.fn().mockResolvedValue({ file_token: 'front-token', type: 'jpg' })
    const createImageTask = vi.fn().mockResolvedValue('task-front-123')
    const tripoService = createTripoService({
      tripoClient: {
        uploadImageBuffer,
        createMultiviewTask: vi.fn(),
        createImageTask,
        getTask: vi.fn(),
        fetchRemoteAsset: vi.fn(),
      },
      config: TEST_CONFIG,
    })

    const result = await tripoService.createTaskFromFrontView(
      `data:image/png;base64,${buffer.toString('base64')}`,
    )

    expect(uploadImageBuffer).toHaveBeenCalledTimes(1)
    expect(createImageTask).toHaveBeenCalledWith(
      expect.objectContaining({
        file: {
          type: 'image',
          file_token: 'front-token',
        },
      }),
    )
    expect(result).toEqual({
      taskId: 'task-front-123',
      status: 'queued',
    })
  })

  it('maps output fallback order for task summaries', async () => {
    const tripoService = createTripoService({
      tripoClient: {
        uploadImageBuffer: vi.fn(),
        createMultiviewTask: vi.fn(),
        createImageTask: vi.fn(),
        getTask: vi.fn().mockResolvedValue({
          status: 'success',
          progress: 100,
          output: {
            model: 'https://example.com/model.glb',
          },
        }),
        fetchRemoteAsset: vi.fn(),
      },
      config: TEST_CONFIG,
    })

    const result = await tripoService.getTaskSummary('task-987')

    expect(result.outputs).toEqual(
      expect.objectContaining({
        modelUrl: '/api/tripo/tasks/task-987/model?variant=model',
        downloadUrl: '/api/tripo/tasks/task-987/model?variant=model',
        variant: 'model',
      }),
    )
    expect(result.outputs.variants).toEqual(
      expect.objectContaining({
        model: '/api/tripo/tasks/task-987/model?variant=model',
      }),
    )
  })

  it('starts a Mixamo rig task when base model succeeds and rigging is enabled', async () => {
    const createRigTask = vi.fn().mockResolvedValue('rig-task-321')
    const tripoService = createTripoService({
      tripoClient: {
        uploadImageBuffer: vi.fn(),
        createMultiviewTask: vi.fn(),
        createImageTask: vi.fn(),
        createRigTask,
        getTask: vi
          .fn()
          .mockResolvedValueOnce({
            task_id: 'task-base-123',
            type: 'multiview_to_model',
            status: 'success',
            progress: 100,
            output: {
              model: 'https://example.com/base.glb',
            },
          })
          .mockResolvedValueOnce({
            task_id: 'rig-task-321',
            type: 'animate_rig',
            status: 'running',
            progress: 45,
            output: {},
          }),
        fetchRemoteAsset: vi.fn(),
      },
      config: {
        ...TEST_CONFIG,
        tripoRigMixamo: true,
      },
    })

    const summary = await tripoService.getTaskSummary('task-base-123')

    expect(createRigTask).toHaveBeenCalledWith({
      originalModelTaskId: 'task-base-123',
      outFormat: 'glb',
      rigType: 'biped',
      spec: 'mixamo',
      modelVersion: 'v2.0-20250506',
    })
    expect(summary.taskId).toBe('rig-task-321')
    expect(summary.status).toBe('running')
    expect(summary.outputs).toBeNull()
  })

  it('returns rigged output URLs once Mixamo rig task succeeds', async () => {
    const createRigTask = vi.fn().mockResolvedValue('rig-task-999')
    const tripoService = createTripoService({
      tripoClient: {
        uploadImageBuffer: vi.fn(),
        createMultiviewTask: vi.fn(),
        createImageTask: vi.fn(),
        createRigTask,
        getTask: vi
          .fn()
          .mockResolvedValueOnce({
            task_id: 'task-base-999',
            type: 'multiview_to_model',
            status: 'success',
            progress: 100,
            output: {
              model: 'https://example.com/base.glb',
            },
          })
          .mockResolvedValueOnce({
            task_id: 'rig-task-999',
            type: 'animate_rig',
            status: 'success',
            progress: 100,
            output: {
              model: 'https://example.com/rigged.glb',
            },
          }),
        fetchRemoteAsset: vi.fn(),
      },
      config: {
        ...TEST_CONFIG,
        tripoRigMixamo: true,
      },
    })

    const summary = await tripoService.getTaskSummary('task-base-999')

    expect(summary.outputs).toEqual(
      expect.objectContaining({
        modelUrl: '/api/tripo/tasks/rig-task-999/model?variant=model',
        downloadUrl: '/api/tripo/tasks/rig-task-999/model?variant=model',
        variant: 'model',
      }),
    )
  })

  it('starts idle animation task after rig success when enabled', async () => {
    const createRigTask = vi.fn().mockResolvedValue('rig-task-idle-1')
    const createAnimationTask = vi.fn().mockResolvedValue('anim-task-777')
    const tripoService = createTripoService({
      tripoClient: {
        uploadImageBuffer: vi.fn(),
        createMultiviewTask: vi.fn(),
        createImageTask: vi.fn(),
        createRigTask,
        createAnimationTask,
        getTask: vi
          .fn()
          .mockResolvedValueOnce({
            task_id: 'task-base-idle-1',
            type: 'multiview_to_model',
            status: 'success',
            progress: 100,
            output: {
              model: 'https://example.com/base.glb',
            },
          })
          .mockResolvedValueOnce({
            task_id: 'rig-task-idle-1',
            type: 'animate_rig',
            status: 'success',
            progress: 100,
            output: {
              rigged_model: 'https://example.com/rigged.glb',
            },
          })
          .mockResolvedValueOnce({
            task_id: 'anim-task-777',
            type: 'animate_model',
            status: 'success',
            progress: 100,
            output: {
              animated_model: 'https://example.com/animated-idle.glb',
            },
          })
          .mockResolvedValueOnce({
            task_id: 'rig-task-idle-1',
            type: 'animate_rig',
            status: 'success',
            progress: 100,
            output: {
              rigged_model: 'https://example.com/rigged.glb',
            },
          })
          .mockResolvedValueOnce({
            task_id: 'task-base-idle-1',
            type: 'multiview_to_model',
            status: 'success',
            progress: 100,
            output: {
              model: 'https://example.com/base.glb',
            },
          }),
        fetchRemoteAsset: vi.fn(),
      },
      config: {
        ...TEST_CONFIG,
        tripoRigMixamo: true,
        tripoIdleAnimationEnabled: true,
      },
    })

    const summary = await tripoService.getTaskSummary('task-base-idle-1')

    expect(createRigTask).toHaveBeenCalledTimes(1)
    expect(createAnimationTask).toHaveBeenCalledWith({
      originalModelTaskId: 'rig-task-idle-1',
      animation: 'idle',
      taskType: 'animate_model',
      animateInPlace: true,
    })
    expect(summary.taskId).toBe('anim-task-777')
    expect(summary.outputs).toEqual(
      expect.objectContaining({
        modelUrl: '/api/tripo/tasks/anim-task-777/model?variant=animated_model',
        downloadUrl: '/api/tripo/tasks/anim-task-777/model?variant=animated_model',
        variant: 'animated_model',
      }),
    )
    expect(summary.outputs.variants).toEqual(
      expect.objectContaining({
        animated_model: '/api/tripo/tasks/anim-task-777/model?variant=animated_model',
        rigged_model: '/api/tripo/tasks/anim-task-777/model?variant=rigged_model',
      }),
    )
  })

  it('skips rig and animation tasks when static mode is requested', async () => {
    const buffer = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer()

    const uploadImageBuffer = vi.fn().mockResolvedValue({ file_token: 'front-token', type: 'jpg' })
    const createImageTask = vi.fn().mockResolvedValue('task-base-static-1')
    const createRigTask = vi.fn().mockResolvedValue('rig-task-static-1')
    const createAnimationTask = vi.fn()
    const tripoService = createTripoService({
      tripoClient: {
        uploadImageBuffer,
        createMultiviewTask: vi.fn(),
        createImageTask,
        createRigTask,
        createAnimationTask,
        getTask: vi
          .fn()
          .mockResolvedValueOnce({
            task_id: 'task-base-static-1',
            type: 'image_to_model',
            status: 'success',
            progress: 100,
            output: {
              model: 'https://example.com/base-static.glb',
            },
          })
          .mockResolvedValueOnce({
            task_id: 'rig-task-static-1',
            type: 'animate_rig',
            status: 'success',
            progress: 100,
            output: {
              rigged_model: 'https://example.com/rigged-static.glb',
            },
          }),
        fetchRemoteAsset: vi.fn(),
      },
      config: {
        ...TEST_CONFIG,
        tripoRigMixamo: true,
        tripoIdleAnimationEnabled: true,
      },
    })

    await tripoService.createTaskFromFrontView(
      `data:image/png;base64,${buffer.toString('base64')}`,
      { animationMode: 'static' },
    )

    const summary = await tripoService.getTaskSummary('task-base-static-1')

    expect(createRigTask).not.toHaveBeenCalled()
    expect(createAnimationTask).not.toHaveBeenCalled()
    expect(summary.taskId).toBe('task-base-static-1')
    expect(summary.outputs).toEqual(
      expect.objectContaining({
        modelUrl: '/api/tripo/tasks/task-base-static-1/model?variant=model',
        downloadUrl: '/api/tripo/tasks/task-base-static-1/model?variant=model',
        variant: 'model',
      }),
    )
  })

  it('honors static mode override for untracked tasks during polling', async () => {
    const createRigTask = vi.fn().mockResolvedValue('rig-task-overridden-static-1')
    const createAnimationTask = vi.fn().mockResolvedValue('anim-task-overridden-static-1')
    const tripoService = createTripoService({
      tripoClient: {
        uploadImageBuffer: vi.fn(),
        createMultiviewTask: vi.fn(),
        createImageTask: vi.fn(),
        createRigTask,
        createAnimationTask,
        getTask: vi.fn().mockResolvedValue({
          task_id: 'task-base-overridden-static-1',
          type: 'multiview_to_model',
          status: 'success',
          progress: 100,
          output: {
            model: 'https://example.com/base-overridden-static.glb',
          },
        }),
        fetchRemoteAsset: vi.fn(),
      },
      config: {
        ...TEST_CONFIG,
        tripoRigMixamo: true,
        tripoIdleAnimationEnabled: true,
      },
    })

    const summary = await tripoService.getTaskSummary('task-base-overridden-static-1', {
      animationMode: 'static',
    })

    expect(createRigTask).not.toHaveBeenCalled()
    expect(createAnimationTask).not.toHaveBeenCalled()
    expect(summary.taskId).toBe('task-base-overridden-static-1')
    expect(summary.outputs).toEqual(
      expect.objectContaining({
        modelUrl: '/api/tripo/tasks/task-base-overridden-static-1/model?variant=model&animationMode=static',
        downloadUrl:
          '/api/tripo/tasks/task-base-overridden-static-1/model?variant=model&animationMode=static',
        variant: 'model',
      }),
    )
  })

  it('forces idle animation task when animated mode is requested', async () => {
    const buffer = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer()

    const uploadImageBuffer = vi.fn().mockResolvedValue({ file_token: 'front-token', type: 'jpg' })
    const createImageTask = vi.fn().mockResolvedValue('task-base-animated-1')
    const createRigTask = vi.fn().mockResolvedValue('rig-task-animated-1')
    const createAnimationTask = vi.fn().mockResolvedValue('anim-task-animated-1')
    const tripoService = createTripoService({
      tripoClient: {
        uploadImageBuffer,
        createMultiviewTask: vi.fn(),
        createImageTask,
        createRigTask,
        createAnimationTask,
        getTask: vi
          .fn()
          .mockResolvedValueOnce({
            task_id: 'task-base-animated-1',
            type: 'image_to_model',
            status: 'success',
            progress: 100,
            output: {
              model: 'https://example.com/base-animated.glb',
            },
          })
          .mockResolvedValueOnce({
            task_id: 'rig-task-animated-1',
            type: 'animate_rig',
            status: 'success',
            progress: 100,
            output: {
              rigged_model: 'https://example.com/rigged-animated.glb',
            },
          })
          .mockResolvedValueOnce({
            task_id: 'anim-task-animated-1',
            type: 'animate_retarget',
            status: 'success',
            progress: 100,
            output: {
              animation_model: 'https://example.com/animated-idle.glb',
            },
          })
          .mockResolvedValueOnce({
            task_id: 'rig-task-animated-1',
            type: 'animate_rig',
            status: 'success',
            progress: 100,
            output: {
              rigged_model: 'https://example.com/rigged-animated.glb',
            },
          })
          .mockResolvedValueOnce({
            task_id: 'task-base-animated-1',
            type: 'image_to_model',
            status: 'success',
            progress: 100,
            output: {
              model: 'https://example.com/base-animated.glb',
            },
          }),
        fetchRemoteAsset: vi.fn(),
      },
      config: {
        ...TEST_CONFIG,
        tripoRigMixamo: true,
        tripoIdleAnimationEnabled: false,
      },
    })

    await tripoService.createTaskFromFrontView(
      `data:image/png;base64,${buffer.toString('base64')}`,
      { animationMode: 'animated' },
    )

    const summary = await tripoService.getTaskSummary('task-base-animated-1')

    expect(createRigTask).toHaveBeenCalledTimes(1)
    expect(createAnimationTask).toHaveBeenCalledWith({
      originalModelTaskId: 'rig-task-animated-1',
      animation: 'idle',
      taskType: 'animate_model',
      animateInPlace: true,
    })
    expect(summary.taskId).toBe('anim-task-animated-1')
    expect(summary.outputs).toEqual(
      expect.objectContaining({
        modelUrl: '/api/tripo/tasks/anim-task-animated-1/model?variant=animation_model',
        downloadUrl: '/api/tripo/tasks/anim-task-animated-1/model?variant=animation_model',
        variant: 'animation_model',
      }),
    )
    expect(summary.outputs.variants).toEqual(
      expect.objectContaining({
        animation_model: '/api/tripo/tasks/anim-task-animated-1/model?variant=animation_model',
        rigged_model: '/api/tripo/tasks/anim-task-animated-1/model?variant=rigged_model',
      }),
    )
  })
})

describe('spriteService', () => {
  const makeDataUrl = async () => {
    const buffer = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .png()
      .toBuffer()

    return `data:image/png;base64,${buffer.toString('base64')}`
  }

  it('maps direction order as front/back/left/right -> south/north/west/east', async () => {
    const directionCalls = []
    const spriteService = createSpriteService({
      pixellabClient: {
        estimateSkeleton: vi.fn().mockResolvedValue({
          keypoints: [
            { x: 32, y: 10, label: 'nose', z_index: 0 },
            { x: 26, y: 18, label: 'left_shoulder', z_index: 0 },
            { x: 38, y: 18, label: 'right_shoulder', z_index: 0 },
            { x: 24, y: 26, label: 'left_elbow', z_index: 0 },
            { x: 40, y: 26, label: 'right_elbow', z_index: 0 },
            { x: 22, y: 32, label: 'left_wrist', z_index: 0 },
            { x: 42, y: 32, label: 'right_wrist', z_index: 0 },
            { x: 28, y: 32, label: 'left_hip', z_index: 0 },
            { x: 36, y: 32, label: 'right_hip', z_index: 0 },
            { x: 28, y: 44, label: 'left_knee', z_index: 0 },
            { x: 36, y: 44, label: 'right_knee', z_index: 0 },
            { x: 28, y: 56, label: 'left_ankle', z_index: 0 },
            { x: 36, y: 56, label: 'right_ankle', z_index: 0 },
          ],
        }),
        animateWithSkeleton: vi.fn(async (_imageDataUrl, _keyframes, options) => {
          directionCalls.push(options.direction)
          return {
            images: [{ type: 'base64', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8LkAAAAASUVORK5CYII=' }],
          }
        }),
      },
    })

    const pngDataUrl = await makeDataUrl()
    const result = await spriteService.generateRunSprites({
      views: {
        front: pngDataUrl,
        back: pngDataUrl,
        left: pngDataUrl,
        right: pngDataUrl,
      },
      spriteSize: 64,
    })

    expect(directionCalls).toEqual(['south', 'north', 'west', 'east'])
    expect(result.directions.front.previewDataUrl).toMatch(/^data:image\/png;base64,/)
    expect(result.directions.back.previewDataUrl).toMatch(/^data:image\/png;base64,/)
    expect(result.directions.left.previewDataUrl).toMatch(/^data:image\/png;base64,/)
    expect(result.directions.right.previewDataUrl).toMatch(/^data:image\/png;base64,/)
  })
})
