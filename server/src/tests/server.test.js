import request from 'supertest'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { loadEnv } from '../config/env.js'
import { createApp } from '../index.js'
import { mirrorHorizontally } from '../services/imageTransformService.js'
import { buildViewPrompt, DEFAULT_MULTIVIEW_PROMPT } from '../services/promptBuilder.js'
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
}

const noopMultiviewService = {
  generateMultiview: vi.fn(),
}

const noopTripoService = {
  createTaskFromViews: vi.fn(),
  createTaskFromFrontView: vi.fn(),
  getTaskSummary: vi.fn(),
  getModelAsset: vi.fn(),
}

describe('loadEnv', () => {
  it('rejects missing API keys', () => {
    expect(() => loadEnv({})).toThrow(/GEMINI_API_KEY, TRIPO_API_KEY/)
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
    ).toContain('Side VIEW ONLY')
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
      })),
    }
    const app = createApp(TEST_CONFIG, {
      portraitService: {
        generatePortrait: vi.fn(),
      },
      multiviewService,
      tripoService: noopTripoService,
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
    expect(multiviewService.generateMultiview).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'front-only',
      }),
    )
  })
})

describe('tripoService', () => {
  it('uploads turnaround views in front-back-left-right order', async () => {
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
      .mockResolvedValueOnce({ file_token: 'left-token', type: 'jpg' })
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
          { file_token: 'back-token', type: 'jpg' },
          { file_token: 'left-token', type: 'jpg' },
          { file_token: 'right-token', type: 'jpg' },
        ],
      }),
    )
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

    expect(result.outputs).toEqual({
      modelUrl: '/api/tripo/tasks/task-987/model?variant=model',
      downloadUrl: '/api/tripo/tasks/task-987/model?variant=model',
    })
  })
})
