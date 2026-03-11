import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import {
  createTripoFrontBackTask,
  createTripoFrontTask,
  createTripoPreRigCheckTask,
  createTripoRetargetTask,
  createTripoRigTask,
  createTripoTask,
  generateMultiview,
  generatePortrait,
  generateSpriteRun,
  getHealth,
  getTripoTask,
  restartDevServer,
} from '../api/characterApi'
import { resolveAnimatedSpriteCaptureDelayMs, resolveAnimatedSpriteDelayMs } from '../lib/spriteTiming'

const DEFAULT_RETARGET_ANIMATIONS = [
  'preset:biped:walk',
  'preset:biped:run',
  'preset:biped:look_around',
]
const DEFAULT_ANIMATION_KEYS = ['walk', 'run', 'look_around']
const getPresetForAnimationKey = (animationKey) =>
  animationKey === 'idle' ? 'preset:biped:wait' : `preset:biped:${animationKey}`
const VALID_CAPTURE_FRAME =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8LkAAAAASUVORK5CYII='
const viewerCaptureAnimatedSpriteDirectionsMock = vi.fn().mockResolvedValue({})
const viewerCaptureEightViewsMock = vi.fn().mockResolvedValue({})
const viewerWaitUntilReadyMock = vi.fn().mockResolvedValue({ modelUrl: '' })
const originalCreateElement = document.createElement.bind(document)
const originalImage = global.Image

vi.mock('../api/characterApi', () => ({
  generatePortrait: vi.fn(),
  generateMultiview: vi.fn(),
  generateSpriteRun: vi.fn(),
  getHealth: vi.fn(),
  createTripoTask: vi.fn(),
  createTripoFrontBackTask: vi.fn(),
  createTripoFrontTask: vi.fn(),
  createTripoPreRigCheckTask: vi.fn(),
  createTripoRigTask: vi.fn(),
  createTripoRetargetTask: vi.fn(),
  getTripoTask: vi.fn(),
  restartDevServer: vi.fn(),
}))

vi.mock('../components/ModelViewer', () => ({
  ModelViewer: ({
    modelUrl,
    animationSelectionKey = 'apose',
    animationClipIndex = null,
    onCaptureApiReady,
  }) => {
    onCaptureApiReady?.({
      captureEightViews: viewerCaptureEightViewsMock,
      captureAnimatedSpriteDirections: viewerCaptureAnimatedSpriteDirectionsMock,
      waitUntilReady: viewerWaitUntilReadyMock,
      getCurrentModelUrl: () => modelUrl,
      getCurrentAnimationSelection: () => animationSelectionKey,
    })
    return (
      <div
        data-testid="viewer-stub"
        data-animation-selection={animationSelectionKey}
        data-animation-clip-index={animationClipIndex === null ? '' : String(animationClipIndex)}
      >
        {modelUrl}
      </div>
    )
  },
}))

const makeDataUrl = (seed) => `data:image/png;base64,${btoa(seed)}`

const makeFullMultiviewResult = () => ({
  mode: 'full',
  views: {
    front: { imageDataUrl: makeDataUrl('front'), source: 'image-service' },
    back: { imageDataUrl: makeDataUrl('back'), source: 'image-service' },
    left: { imageDataUrl: makeDataUrl('left'), source: 'image-service' },
    right: { imageDataUrl: makeDataUrl('right'), source: 'mirrored-left' },
  },
})

const makeSpriteDirection = (seed) => ({
  previewDataUrl: makeDataUrl(`${seed}-a`),
  frameDataUrls: [makeDataUrl(`${seed}-a`), makeDataUrl(`${seed}-b`)],
  source: 'viewer-walk-capture',
  frames: {
    count: 2,
    format: 'base64-frame-sequence',
  },
})

const makeRequiredSpriteDirections = () => ({
  front: makeSpriteDirection('front'),
  front_right: makeSpriteDirection('front_right'),
  right: makeSpriteDirection('right'),
  back_right: makeSpriteDirection('back_right'),
  back: makeSpriteDirection('back'),
  back_left: makeSpriteDirection('back_left'),
  left: makeSpriteDirection('left'),
  front_left: makeSpriteDirection('front_left'),
})

const makeSharedSpriteDirections = () => ({
  view_360: makeSpriteDirection('view_360'),
})

const makeCapturedSpriteDirections = () =>
  Object.fromEntries(
    ['front', 'front_right', 'right', 'back_right', 'back', 'back_left', 'left', 'front_left'].map(
      (directionKey) => [
        directionKey,
        {
          frameDataUrls: [VALID_CAPTURE_FRAME, VALID_CAPTURE_FRAME],
          delayMs: 90,
        },
      ],
    ),
  )

const makeCapturedModelViews = () =>
  Object.fromEntries(
    ['front', 'front_right', 'right', 'back_right', 'back', 'back_left', 'left', 'front_left'].map(
      (directionKey) => [
        directionKey,
        {
          dataUrl: VALID_CAPTURE_FRAME,
        },
      ],
    ),
  )

const makeRequiredSpriteAnimations = () =>
  Object.fromEntries(
    DEFAULT_ANIMATION_KEYS.map((animationKey) => [
      animationKey,
      {
        animation: animationKey,
        label: animationKey,
        preset: getPresetForAnimationKey(animationKey),
        directions: makeRequiredSpriteDirections(),
      },
    ]),
  )

const makeCompleteSpriteResult = () => ({
  animation: 'walk',
  spriteSize: 64,
  directions: makeRequiredSpriteDirections(),
  sharedDirections: makeSharedSpriteDirections(),
  animations: makeRequiredSpriteAnimations(),
})

const makeSuccessfulTask = (taskId, taskType, variant, modelUrl) => ({
  taskId,
  taskType,
  sourceTaskId: '',
  status: 'success',
  progress: 100,
  error: '',
  outputs: {
    modelUrl,
    downloadUrl: modelUrl,
    variant,
    variants: {
      [variant]: modelUrl,
    },
  },
})

const makeMultiAnimationTask = (
  taskId,
  {
    taskType = 'animate_retarget',
    sourceTaskId = 'rig-task',
    animationKeys = DEFAULT_ANIMATION_KEYS,
  } = {},
) => {
  const primaryAnimationKey = animationKeys[0] || DEFAULT_ANIMATION_KEYS[0]
  const animations = Object.fromEntries(
    animationKeys.map((animationKey) => [
      animationKey,
      {
        preset: getPresetForAnimationKey(animationKey),
        label: animationKey[0].toUpperCase() + animationKey.slice(1),
        variant: 'animation_model',
        modelUrl: `/api/tripo/tasks/${taskId}/model?variant=animation_model&animationMode=animated&animationKey=${animationKey}`,
        downloadUrl: `/api/tripo/tasks/${taskId}/model?variant=animation_model&animationMode=animated&animationKey=${animationKey}`,
        variants: {
          animation_model: `/api/tripo/tasks/${taskId}/model?variant=animation_model&animationMode=animated&animationKey=${animationKey}`,
        },
      },
    ]),
  )

  return {
    taskId,
    taskType,
    sourceTaskId,
    status: 'success',
    progress: 100,
    error: '',
    outputs: {
      modelUrl: `/api/tripo/tasks/${taskId}/model?variant=animation_model&animationMode=animated&animationKey=${primaryAnimationKey}`,
      downloadUrl: `/api/tripo/tasks/${taskId}/model?variant=animation_model&animationMode=animated&animationKey=${primaryAnimationKey}`,
      variant: 'animation_model',
      variants: {
        animation_model: `/api/tripo/tasks/${taskId}/model?variant=animation_model&animationMode=animated&animationKey=${primaryAnimationKey}`,
        rigged_model: `/api/tripo/tasks/${taskId}/model?variant=rigged_model&animationMode=animated`,
      },
      animations,
    },
  }
}

const makeBundledMultiAnimationTask = (
  taskId,
  {
    taskType = 'animate_retarget',
    sourceTaskId = 'rig-task',
    animationKeys = DEFAULT_ANIMATION_KEYS,
  } = {},
) => {
  const primaryAnimationKey = animationKeys[0] || DEFAULT_ANIMATION_KEYS[0]
  const sharedModelUrl = `/api/tripo/tasks/${taskId}/model?variant=model&animationMode=animated&animationKey=${primaryAnimationKey}`
  const animations = Object.fromEntries(
    animationKeys.map((animationKey, clipIndex) => [
      animationKey,
      {
        preset: getPresetForAnimationKey(animationKey),
        label: animationKey[0].toUpperCase() + animationKey.slice(1),
        variant: 'model',
        modelUrl: `/api/tripo/tasks/${taskId}/model?variant=model&animationMode=animated&animationKey=${animationKey}`,
        downloadUrl: `/api/tripo/tasks/${taskId}/model?variant=model&animationMode=animated&animationKey=${animationKey}`,
        variants: {
          model: `/api/tripo/tasks/${taskId}/model?variant=model&animationMode=animated&animationKey=${animationKey}`,
        },
        clipIndex,
      },
    ]),
  )

  return {
    taskId,
    taskType,
    sourceTaskId,
    status: 'success',
    progress: 100,
    error: '',
    outputs: {
      modelUrl: sharedModelUrl,
      downloadUrl: sharedModelUrl,
      variant: 'model',
      variants: {
        model: sharedModelUrl,
        rigged_model: `/api/tripo/tasks/${taskId}/model?variant=rigged_model&animationMode=animated`,
      },
      animations,
    },
  }
}

const getStep01Panel = () => screen.getByLabelText('Step 01 Portrait Panel')
const getStep02Panel = () => screen.getByLabelText('Step 02 Multiview Panel')
const getStep03Panel = () => screen.getByLabelText('Step 03 3D Model Panel')
const getStep04Panel = () => screen.getByLabelText('Step 04 Sprite Panel')
const getDevPanel = () => screen.getByLabelText('Development presets')
const getProgressFill = () => screen.getByTestId('status-progress-fill')
const getDevActionButton = (name) => within(getDevPanel()).getByRole('button', { name })

const openDevPanel = async (user) => {
  if (screen.queryByLabelText('Development presets')) {
    return
  }

  await user.click(screen.getByRole('button', { name: 'DEV' }))
  await waitFor(() => expect(screen.getByLabelText('Development presets')).toBeInTheDocument())
}

const generatePfp = async (user) => {
  await user.type(screen.getByLabelText('Character prompt'), 'pilot')
  await user.click(within(getStep01Panel()).getByRole('button', { name: 'Generate 2D' }))
  await waitFor(() => expect(generatePortrait).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(generateMultiview).toHaveBeenCalledTimes(1))
}

const unlockStep03 = async (user) => {
  await generatePfp(user)
  await waitFor(() => expect(getProgressFill()).toHaveAttribute('data-step-index', '3'))
  await openDevPanel(user)
}

describe('App', () => {
  beforeEach(() => {
    vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
      const element = originalCreateElement(tagName, options)

      if (String(tagName).toLowerCase() === 'canvas') {
        element.getContext = vi.fn(() => ({
          clearRect: vi.fn(),
          drawImage: vi.fn(),
          getImageData: vi.fn(() => ({
            data: new Uint8ClampedArray(4),
          })),
          imageSmoothingEnabled: true,
        }))
        element.toDataURL = vi.fn(() => VALID_CAPTURE_FRAME)
      }

      return element
    })
    global.Image = class {
      constructor() {
        this.onload = null
        this.onerror = null
        this.width = 1
        this.height = 1
        this.naturalWidth = 1
        this.naturalHeight = 1
        this._src = ''
      }

      get src() {
        return this._src
      }

      set src(value) {
        this._src = value
        window.setTimeout(() => {
          if (String(value).startsWith('data:image/')) {
            this.onload?.()
            return
          }

          this.onerror?.(new Error('Unsupported test image source.'))
        }, 0)
      }
    }

    getHealth.mockResolvedValue({
      status: 'ok',
      versions: {
        tripoModelVersion: 'v3.1-20260211',
        tripoRigModelVersion: 'v2.0-20250506',
      },
    })

    generatePortrait.mockResolvedValue({
      imageDataUrl: makeDataUrl('portrait'),
      promptUsed: 'pilot',
      inputMode: 'prompt',
      normalizedReferenceImageDataUrl: null,
    })
    generateMultiview.mockResolvedValue(makeFullMultiviewResult())
    generateSpriteRun.mockResolvedValue({
      animation: 'walk',
      spriteSize: 64,
      directions: makeRequiredSpriteDirections(),
    })

    createTripoTask.mockReset()
    createTripoFrontBackTask.mockReset()
    createTripoFrontTask.mockReset()
    createTripoPreRigCheckTask.mockReset()
    createTripoRigTask.mockReset()
    createTripoRetargetTask.mockReset()
    getTripoTask.mockReset()
    restartDevServer.mockReset()
    viewerCaptureEightViewsMock.mockReset()
    viewerCaptureEightViewsMock.mockResolvedValue({})
    viewerCaptureAnimatedSpriteDirectionsMock.mockReset()
    viewerCaptureAnimatedSpriteDirectionsMock.mockResolvedValue({})
    viewerWaitUntilReadyMock.mockReset()
    viewerWaitUntilReadyMock.mockResolvedValue({ modelUrl: '' })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.useRealTimers()
    window.localStorage.clear()
    global.Image = originalImage
  })

  it('renders unified top progress bar and initial step gating', async () => {
    render(<App />)
    const user = userEvent.setup()
    await openDevPanel(user)

    expect(screen.getByRole('progressbar', { name: 'Pipeline step progress' })).toBeInTheDocument()
    expect(screen.queryByText(/^Session:/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Message:\s*SUCCESS/i)).not.toBeInTheDocument()
    expect(getProgressFill()).toHaveAttribute('data-step-index', '1')

    expect(within(getStep01Panel()).getByRole('button', { name: 'Generate 2D' })).toBeEnabled()
    expect(within(getStep01Panel()).queryByRole('button', { name: 'Accept Portrait' })).toBeNull()

    expect(within(getStep02Panel()).queryByRole('button', { name: 'Generate 2D' })).toBeNull()
    expect(within(getStep02Panel()).queryByRole('button', { name: 'Accept Multiview' })).toBeNull()

    expect(within(getStep03Panel()).queryByRole('button', { name: 'Generate 3D' })).toBeNull()
    expect(within(getStep03Panel()).queryByRole('button', { name: 'AutoRig' })).toBeNull()
    expect(within(getStep03Panel()).queryByRole('button', { name: 'Animate' })).toBeNull()
    expect(within(getStep03Panel()).queryByRole('button', { name: 'Accept 3D' })).toBeNull()

    expect(within(getStep04Panel()).queryByRole('button', { name: 'Generate 2.5D' })).toBeNull()
    expect(within(getStep04Panel()).getByRole('button', { name: 'Download' })).toBeDisabled()

    expect(getDevActionButton('Generate 2D')).toBeDisabled()
    expect(getDevActionButton('Generate 3D')).toBeDisabled()
    expect(getDevActionButton('AutoRig')).toBeDisabled()
    expect(getDevActionButton('Animate')).toBeDisabled()
    expect(getDevActionButton('Generate 2.5D')).toBeDisabled()
  })

  it('adapts sprite timing to clip duration with sane bounds', () => {
    expect(resolveAnimatedSpriteCaptureDelayMs(2.4, 16, 90)).toBe(150)
    expect(resolveAnimatedSpriteCaptureDelayMs(2.4, 16, 90, 'look_around')).toBe(300)
    expect(resolveAnimatedSpriteCaptureDelayMs(0.8, 16, 90)).toBe(50)
    expect(resolveAnimatedSpriteDelayMs(undefined, 90)).toBe(90)
  })

  it('auto-generates multiview after Generate 2D and unlocks step 03', async () => {
    render(<App />)
    const user = userEvent.setup()

    await generatePfp(user)

    expect(generateMultiview).toHaveBeenCalledTimes(1)
    expect(getProgressFill()).toHaveAttribute('data-step-index', '3')
  })

  it('uses the expected payload for automatic multiview generation', async () => {
    render(<App />)
    const user = userEvent.setup()

    await unlockStep03(user)

    expect(generateMultiview).toHaveBeenCalledWith({
      portraitImageDataUrl: makeDataUrl('portrait'),
      originalReferenceImageDataUrl: null,
      characterPrompt: 'pilot',
      multiviewPrompt: expect.any(String),
      mode: 'full',
    })
    expect(getDevActionButton('Generate 3D')).toBeEnabled()
    expect(getProgressFill()).toHaveAttribute('data-step-index', '3')
  })

  it('runs step 03 as manual Generate 3D -> AutoRig -> Animate sequence', async () => {
    createTripoTask.mockResolvedValue({ taskId: 'model-task', status: 'queued' })
    createTripoRigTask.mockResolvedValue({ taskId: 'rig-task', status: 'queued' })
    createTripoRetargetTask.mockResolvedValue({ taskId: 'retarget-task', status: 'queued' })
    getTripoTask.mockImplementation(async (taskId) => {
      if (taskId === 'model-task') {
        return makeSuccessfulTask(
          'model-task',
          'multiview_to_model',
          'model',
          '/api/tripo/tasks/model-task/model?variant=model&animationMode=static',
        )
      }
      if (taskId === 'rig-task') {
        return makeSuccessfulTask(
          'rig-task',
          'animate_rig',
          'rigged_model',
          '/api/tripo/tasks/rig-task/model?variant=rigged_model&animationMode=static',
        )
      }
      if (taskId === 'retarget-task') {
        return makeMultiAnimationTask('retarget-task')
      }
      return {
        taskId,
        status: 'running',
        progress: 40,
        outputs: null,
      }
    })

    render(<App />)
    const user = userEvent.setup()
    await unlockStep03(user)

    const step03Panel = getStep03Panel()
    const generate3DButton = getDevActionButton('Generate 3D')
    const autoRigButton = getDevActionButton('AutoRig')
    const animateButton = getDevActionButton('Animate')
    const generate25dButton = getDevActionButton('Generate 2.5D')

    expect(autoRigButton).toBeDisabled()
    expect(animateButton).toBeDisabled()
    expect(generate25dButton).toBeDisabled()

    await user.click(generate3DButton)
    await waitFor(() => expect(createTripoTask).toHaveBeenCalledTimes(1))
    expect(createTripoRigTask).not.toHaveBeenCalled()
    expect(autoRigButton).toBeDisabled()

    await waitFor(() => expect(autoRigButton).toBeEnabled(), { timeout: 8000 })

    await user.click(autoRigButton)
    await waitFor(() => expect(createTripoRigTask).toHaveBeenCalledWith('model-task'))
    expect(createTripoRetargetTask).not.toHaveBeenCalled()
    expect(animateButton).toBeDisabled()

    await waitFor(() => expect(animateButton).toBeEnabled(), { timeout: 8000 })

    await user.click(animateButton)
    await waitFor(() =>
      expect(createTripoRetargetTask).toHaveBeenCalledWith('rig-task', {
        animations: DEFAULT_RETARGET_ANIMATIONS,
      }),
    )
    await waitFor(() => expect(generate25dButton).toBeEnabled(), { timeout: 8000 })

    expect(generate25dButton).toBeEnabled()
    expect(getProgressFill()).toHaveAttribute('data-step-index', '3')
  }, 25000)

  it('runs main Generate 3D through rigging, animation, and 2.5D capture', async () => {
    createTripoTask.mockResolvedValue({ taskId: 'model-task', status: 'queued' })
    createTripoRigTask.mockResolvedValue({ taskId: 'rig-task', status: 'queued' })
    createTripoRetargetTask.mockResolvedValue({ taskId: 'retarget-task', status: 'queued' })
    viewerCaptureEightViewsMock.mockResolvedValue(makeCapturedModelViews())
    viewerCaptureAnimatedSpriteDirectionsMock.mockResolvedValue(makeCapturedSpriteDirections())
    getTripoTask.mockImplementation(async (taskId) => {
      if (taskId === 'model-task') {
        return makeSuccessfulTask(
          'model-task',
          'multiview_to_model',
          'model',
          '/api/tripo/tasks/model-task/model?variant=model&animationMode=static',
        )
      }
      if (taskId === 'rig-task') {
        return makeSuccessfulTask(
          'rig-task',
          'animate_rig',
          'rigged_model',
          '/api/tripo/tasks/rig-task/model?variant=rigged_model&animationMode=static',
        )
      }
      if (taskId === 'retarget-task') {
        return makeMultiAnimationTask('retarget-task')
      }
      return { taskId, status: 'running', progress: 35, outputs: null }
    })

    render(<App />)
    const user = userEvent.setup()
    await unlockStep03(user)

    await user.click(within(getStep02Panel()).getByRole('button', { name: 'Generate 3D' }))

    await waitFor(() =>
      expect(createTripoTask).toHaveBeenCalledWith(
        expect.objectContaining({
          meshQuality: 'detailed',
          textureQuality: 'detailed',
          faceLimit: 64000,
        }),
      ),
    )
    await waitFor(() => expect(createTripoRigTask).toHaveBeenCalledWith('model-task'))
    await waitFor(() =>
      expect(createTripoRetargetTask).toHaveBeenCalledWith('rig-task', {
        animations: DEFAULT_RETARGET_ANIMATIONS,
      }),
    )
    await waitFor(() => expect(viewerCaptureEightViewsMock).toHaveBeenCalledTimes(1), {
      timeout: 12000,
    })
    await waitFor(() => expect(viewerCaptureAnimatedSpriteDirectionsMock).toHaveBeenCalledTimes(2), {
      timeout: 12000,
    })
    await waitFor(
      () => expect(within(getStep04Panel()).getByRole('button', { name: 'Download' })).toBeEnabled(),
      { timeout: 15000 },
    )
  }, 30000)

  it('continues the auto pipeline to retarget when rig success arrives before rigged output normalization', async () => {
    createTripoTask.mockResolvedValue({ taskId: 'model-task', status: 'queued' })
    createTripoRigTask.mockResolvedValue({ taskId: 'rig-task', status: 'queued' })
    createTripoRetargetTask.mockResolvedValue({ taskId: 'retarget-task', status: 'queued' })
    viewerCaptureEightViewsMock.mockResolvedValue(makeCapturedModelViews())
    viewerCaptureAnimatedSpriteDirectionsMock.mockResolvedValue(makeCapturedSpriteDirections())
    getTripoTask.mockImplementation(async (taskId) => {
      if (taskId === 'model-task') {
        return makeSuccessfulTask(
          'model-task',
          'multiview_to_model',
          'model',
          '/api/tripo/tasks/model-task/model?variant=model&animationMode=static',
        )
      }
      if (taskId === 'rig-task') {
        return {
          taskId: 'rig-task',
          taskType: 'animate_rig',
          sourceTaskId: 'model-task',
          status: 'success',
          progress: 100,
          error: '',
          outputs: null,
        }
      }
      if (taskId === 'retarget-task') {
        return makeMultiAnimationTask('retarget-task')
      }
      return { taskId, status: 'running', progress: 35, outputs: null }
    })

    render(<App />)
    const user = userEvent.setup()
    await unlockStep03(user)

    await user.click(within(getStep02Panel()).getByRole('button', { name: 'Generate 3D' }))

    await waitFor(() => expect(createTripoRigTask).toHaveBeenCalledWith('model-task'))
    await waitFor(() =>
      expect(createTripoRetargetTask).toHaveBeenCalledWith('rig-task', {
        animations: DEFAULT_RETARGET_ANIMATIONS,
      }),
    )
    await waitFor(
      () => expect(within(getStep04Panel()).getByRole('button', { name: 'Download' })).toBeEnabled(),
      { timeout: 15000 },
    )
  }, 30000)

  it('re-enables Download after rerunning Generate 2.5D over an existing sprite bundle', async () => {
    createTripoTask.mockResolvedValue({ taskId: 'model-task', status: 'queued' })
    createTripoRigTask.mockResolvedValue({ taskId: 'rig-task', status: 'queued' })
    createTripoRetargetTask.mockResolvedValue({ taskId: 'retarget-task', status: 'queued' })
    viewerCaptureEightViewsMock.mockResolvedValue(makeCapturedModelViews())
    viewerCaptureAnimatedSpriteDirectionsMock.mockResolvedValue(makeCapturedSpriteDirections())
    getTripoTask.mockImplementation(async (taskId) => {
      if (taskId === 'model-task') {
        return makeSuccessfulTask(
          'model-task',
          'multiview_to_model',
          'model',
          '/api/tripo/tasks/model-task/model?variant=model&animationMode=static',
        )
      }
      if (taskId === 'rig-task') {
        return makeSuccessfulTask(
          'rig-task',
          'animate_rig',
          'rigged_model',
          '/api/tripo/tasks/rig-task/model?variant=rigged_model&animationMode=static',
        )
      }
      if (taskId === 'retarget-task') {
        return makeMultiAnimationTask('retarget-task')
      }
      return { taskId, status: 'running', progress: 35, outputs: null }
    })

    render(<App />)
    const user = userEvent.setup()
    await unlockStep03(user)

    const step04Panel = getStep04Panel()
    const generate3DButton = getDevActionButton('Generate 3D')
    const autoRigButton = getDevActionButton('AutoRig')
    const animateButton = getDevActionButton('Animate')
    const generate25dButton = getDevActionButton('Generate 2.5D')

    await user.click(generate3DButton)
    await waitFor(() => expect(autoRigButton).toBeEnabled(), { timeout: 8000 })
    await user.click(autoRigButton)
    await waitFor(() => expect(animateButton).toBeEnabled(), { timeout: 8000 })
    await user.click(animateButton)
    await waitFor(() => expect(generate25dButton).toBeEnabled(), { timeout: 12000 })

    const downloadButton = within(step04Panel).getByRole('button', { name: 'Download' })

    await user.click(generate25dButton)
    await waitFor(() => expect(downloadButton).toBeEnabled(), { timeout: 12000 })

    await user.click(generate25dButton)
    await waitFor(() => expect(downloadButton).toBeEnabled(), { timeout: 12000 })
  }, 30000)

  it('switches 3D preview to Walk when the configured animation set completes', async () => {
    createTripoTask.mockResolvedValue({ taskId: 'model-task', status: 'queued' })
    createTripoRigTask.mockResolvedValue({ taskId: 'rig-task', status: 'queued' })
    createTripoRetargetTask.mockResolvedValue({ taskId: 'retarget-task', status: 'queued' })
    const retargetPolls = { count: 0 }
    getTripoTask.mockImplementation(async (taskId) => {
      if (taskId === 'model-task') {
        return makeSuccessfulTask(
          'model-task',
          'multiview_to_model',
          'model',
          '/api/tripo/tasks/model-task/model?variant=model&animationMode=static',
        )
      }
      if (taskId === 'rig-task') {
        return makeSuccessfulTask(
          'rig-task',
          'animate_rig',
          'rigged_model',
          '/api/tripo/tasks/rig-task/model?variant=rigged_model&animationMode=static',
        )
      }
      if (taskId === 'retarget-task') {
        retargetPolls.count += 1
        if (retargetPolls.count < 2) {
          return {
            taskId: 'retarget-task',
            taskType: 'animate_retarget',
            sourceTaskId: 'rig-task',
            status: 'running',
            progress: 55,
            error: '',
            outputs: null,
          }
        }
        return makeMultiAnimationTask('retarget-task')
      }
      return { taskId, status: 'running', progress: 35, outputs: null }
    })

    render(<App />)
    const user = userEvent.setup()
    await unlockStep03(user)

    const step03Panel = getStep03Panel()
    const generate3DButton = getDevActionButton('Generate 3D')
    const autoRigButton = getDevActionButton('AutoRig')
    const animateButton = getDevActionButton('Animate')
    const previewSelect = within(step03Panel).getByLabelText('3D model animation preview')

    await user.click(generate3DButton)
    await waitFor(() => expect(autoRigButton).toBeEnabled(), { timeout: 8000 })
    await user.click(autoRigButton)
    await waitFor(() => expect(animateButton).toBeEnabled(), { timeout: 8000 })
    await user.click(animateButton)

    await user.selectOptions(previewSelect, 'apose')
    expect(previewSelect).toHaveValue('apose')

    await waitFor(() => expect(previewSelect).toHaveValue('walk'), { timeout: 12000 })
  }, 30000)

  it('keeps polling animate tasks until the full animation catalog is available', async () => {
    createTripoTask.mockResolvedValue({ taskId: 'model-task', status: 'queued' })
    createTripoRigTask.mockResolvedValue({ taskId: 'rig-task', status: 'queued' })
    createTripoRetargetTask.mockResolvedValue({ taskId: 'retarget-task', status: 'queued' })
    const retargetPolls = { count: 0 }
    getTripoTask.mockImplementation(async (taskId) => {
      if (taskId === 'model-task') {
        return makeSuccessfulTask(
          'model-task',
          'multiview_to_model',
          'model',
          '/api/tripo/tasks/model-task/model?variant=model&animationMode=static',
        )
      }
      if (taskId === 'rig-task') {
        return makeSuccessfulTask(
          'rig-task',
          'animate_rig',
          'rigged_model',
          '/api/tripo/tasks/rig-task/model?variant=rigged_model&animationMode=static',
        )
      }
      if (taskId === 'retarget-task') {
        retargetPolls.count += 1
        if (retargetPolls.count === 1) {
          return {
            taskId: 'retarget-task',
            taskType: 'animate_retarget',
            sourceTaskId: 'rig-task',
            status: 'success',
            progress: 100,
            error: '',
            outputs: {
              modelUrl:
                '/api/tripo/tasks/retarget-task/model?variant=animation_model&animationMode=animated&animationKey=walk',
              downloadUrl:
                '/api/tripo/tasks/retarget-task/model?variant=animation_model&animationMode=animated&animationKey=walk',
              variant: 'animation_model',
              variants: {
                animation_model:
                  '/api/tripo/tasks/retarget-task/model?variant=animation_model&animationMode=animated&animationKey=walk',
                rigged_model:
                  '/api/tripo/tasks/retarget-task/model?variant=rigged_model&animationMode=animated',
              },
              animations: {
                walk: {
                  preset: 'preset:biped:walk',
                  label: 'Walk',
                  variant: 'animation_model',
                  modelUrl:
                    '/api/tripo/tasks/retarget-task/model?variant=animation_model&animationMode=animated&animationKey=walk',
                  downloadUrl:
                    '/api/tripo/tasks/retarget-task/model?variant=animation_model&animationMode=animated&animationKey=walk',
                  variants: {
                    animation_model:
                      '/api/tripo/tasks/retarget-task/model?variant=animation_model&animationMode=animated&animationKey=walk',
                  },
                },
              },
            },
          }
        }

        return makeMultiAnimationTask('retarget-task')
      }
      return { taskId, status: 'running', progress: 35, outputs: null }
    })

    render(<App />)
    const user = userEvent.setup()
    await unlockStep03(user)

    const step03Panel = getStep03Panel()
    const generate3DButton = getDevActionButton('Generate 3D')
    const autoRigButton = getDevActionButton('AutoRig')
    const animateButton = getDevActionButton('Animate')
    const previewSelect = within(step03Panel).getByLabelText('3D model animation preview')

    await user.click(generate3DButton)
    await waitFor(() => expect(autoRigButton).toBeEnabled(), { timeout: 8000 })
    await user.click(autoRigButton)
    await waitFor(() => expect(animateButton).toBeEnabled(), { timeout: 8000 })
    await user.click(animateButton)

    await waitFor(() => expect(retargetPolls.count).toBeGreaterThanOrEqual(2), { timeout: 15000 })
    await waitFor(
      () =>
        expect(screen.getByTestId('viewer-stub')).toHaveTextContent(
          '/api/tripo/tasks/retarget-task/model?variant=animation_model&animationMode=animated&animationKey=walk',
        ),
      { timeout: 15000 },
    )
    expect(previewSelect).toHaveValue('walk')
  }, 30000)

  it('switches bundled retarget clips in the viewer when animations share one GLB', async () => {
    createTripoTask.mockResolvedValue({ taskId: 'model-task', status: 'queued' })
    createTripoRigTask.mockResolvedValue({ taskId: 'rig-task', status: 'queued' })
    createTripoRetargetTask.mockResolvedValue({ taskId: 'retarget-task', status: 'queued' })
    getTripoTask.mockImplementation(async (taskId) => {
      if (taskId === 'model-task') {
        return makeSuccessfulTask(
          'model-task',
          'multiview_to_model',
          'model',
          '/api/tripo/tasks/model-task/model?variant=model&animationMode=static',
        )
      }
      if (taskId === 'rig-task') {
        return makeSuccessfulTask(
          'rig-task',
          'animate_rig',
          'rigged_model',
          '/api/tripo/tasks/rig-task/model?variant=rigged_model&animationMode=static',
        )
      }
      if (taskId === 'retarget-task') {
        return makeBundledMultiAnimationTask('retarget-task')
      }
      return { taskId, status: 'running', progress: 35, outputs: null }
    })

    render(<App />)
    const user = userEvent.setup()
    await unlockStep03(user)

    const step03Panel = getStep03Panel()
    const generate3DButton = getDevActionButton('Generate 3D')
    const autoRigButton = getDevActionButton('AutoRig')
    const animateButton = getDevActionButton('Animate')
    const previewSelect = within(step03Panel).getByLabelText('3D model animation preview')

    await user.click(generate3DButton)
    await waitFor(() => expect(autoRigButton).toBeEnabled(), { timeout: 8000 })
    await user.click(autoRigButton)
    await waitFor(() => expect(animateButton).toBeEnabled(), { timeout: 8000 })
    await user.click(animateButton)

    await waitFor(() => expect(screen.getByTestId('viewer-stub')).toBeInTheDocument(), {
      timeout: 12000,
    })
    expect(screen.getByTestId('viewer-stub')).toHaveAttribute('data-animation-selection', 'walk')
    expect(screen.getByTestId('viewer-stub')).toHaveAttribute('data-animation-clip-index', '0')

    await user.selectOptions(previewSelect, 'run')

    await waitFor(() =>
      expect(screen.getByTestId('viewer-stub')).toHaveAttribute('data-animation-selection', 'run'),
    )
    expect(screen.getByTestId('viewer-stub')).toHaveAttribute('data-animation-clip-index', '1')
  }, 30000)

  it('switches back to the original static model when A-pose is selected after animation', async () => {
    createTripoTask.mockResolvedValue({ taskId: 'model-task', status: 'queued' })
    createTripoRigTask.mockResolvedValue({ taskId: 'rig-task', status: 'queued' })
    createTripoRetargetTask.mockResolvedValue({ taskId: 'retarget-task', status: 'queued' })
    getTripoTask.mockImplementation(async (taskId) => {
      if (taskId === 'model-task') {
        return makeSuccessfulTask(
          'model-task',
          'multiview_to_model',
          'model',
          '/api/tripo/tasks/model-task/model?variant=model&animationMode=static',
        )
      }
      if (taskId === 'rig-task') {
        return makeSuccessfulTask(
          'rig-task',
          'animate_rig',
          'rigged_model',
          '/api/tripo/tasks/rig-task/model?variant=rigged_model&animationMode=static',
        )
      }
      if (taskId === 'retarget-task') {
        return makeMultiAnimationTask('retarget-task')
      }
      return { taskId, status: 'running', progress: 35, outputs: null }
    })

    render(<App />)
    const user = userEvent.setup()
    await unlockStep03(user)

    const step03Panel = getStep03Panel()
    const generate3DButton = getDevActionButton('Generate 3D')
    const autoRigButton = getDevActionButton('AutoRig')
    const animateButton = getDevActionButton('Animate')
    const previewSelect = within(step03Panel).getByLabelText('3D model animation preview')

    await user.click(generate3DButton)
    await waitFor(() => expect(autoRigButton).toBeEnabled(), { timeout: 8000 })
    await user.click(autoRigButton)
    await waitFor(() => expect(animateButton).toBeEnabled(), { timeout: 8000 })
    await user.click(animateButton)

    await waitFor(() => expect(previewSelect).toHaveValue('walk'), { timeout: 12000 })
    await user.selectOptions(previewSelect, 'apose')

    await waitFor(() =>
      expect(screen.getByTestId('viewer-stub')).toHaveTextContent(
        '/api/tripo/tasks/model-task/model?variant=model&animationMode=static',
      ),
    )
    expect(screen.getByTestId('viewer-stub')).toHaveAttribute('data-animation-selection', 'apose')
  }, 30000)

  it('maps single-animation retarget outputs to the matching preview key', async () => {
    window.localStorage.setItem(
      'ww-character-session-v1',
      JSON.stringify({
        prompt: 'pilot',
        multiviewPrompt: 'mv',
        devSettings: {
          portraitAspectRatio: '1:1',
          portraitPromptPreset: 'preset',
          spriteSize: 64,
          tripoAnimationMode: 'animated',
          tripoRetargetAnimationName: 'preset:run',
          tripoMeshQuality: 'standard',
          tripoTextureQuality: 'standard',
          defaultSpritesEnabled: false,
        },
        tripoJob: {
          taskId: 'single-retarget-task',
          taskType: 'animate_retarget',
          sourceTaskId: 'rig-task',
          status: 'success',
          progress: 100,
          error: '',
          requestedAnimations: ['preset:run'],
          outputs: {
            modelUrl:
              '/api/tripo/tasks/single-retarget-task/model?variant=animation_model&animationMode=animated',
            downloadUrl:
              '/api/tripo/tasks/single-retarget-task/model?variant=animation_model&animationMode=animated',
            variant: 'animation_model',
            variants: {
              animation_model:
                '/api/tripo/tasks/single-retarget-task/model?variant=animation_model&animationMode=animated',
            },
          },
        },
        pipelineState: {
          unlocked: { step1: true, step2: true, step3: true, step4: false },
          approved: { step1: true, step2: true, step3: false, step4: false },
        },
      }),
    )

    render(<App />)

    await waitFor(() =>
      expect(within(getStep03Panel()).getByLabelText('3D model animation preview')).toHaveValue('run'),
    )
  })

  it('uses the dev single-animation button with the retarget animation field value', async () => {
    window.localStorage.setItem(
      'ww-character-session-v1',
      JSON.stringify({
        prompt: 'pilot',
        multiviewPrompt: 'mv',
        devSettings: {
          portraitAspectRatio: '1:1',
          portraitPromptPreset: 'preset',
          spriteSize: 64,
          tripoAnimationMode: 'animated',
          tripoRetargetAnimationName: '',
          tripoMeshQuality: 'standard',
          tripoTextureQuality: 'standard',
          defaultSpritesEnabled: false,
        },
        tripoJob: makeSuccessfulTask(
          'rig-task-dev',
          'animate_rig',
          'rigged_model',
          '/api/tripo/tasks/rig-task-dev/model?variant=rigged_model&animationMode=static',
        ),
      }),
    )

    createTripoRetargetTask.mockResolvedValue({ taskId: 'single-retarget-task', status: 'queued' })

    render(<App />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'DEV' }))
    await user.clear(screen.getByLabelText('Retarget Animation'))
    await user.type(screen.getByLabelText('Retarget Animation'), 'preset:slash')
    await user.click(screen.getByRole('button', { name: 'Animate Single' }))

    await waitFor(() =>
      expect(createTripoRetargetTask).toHaveBeenCalledWith('rig-task-dev', {
        animationName: 'preset:slash',
      }),
    )
  })

  it('uses the dev retarget animations field for the main Animate button', async () => {
    window.localStorage.setItem(
      'ww-character-session-v1',
      JSON.stringify({
        prompt: 'pilot',
        multiviewPrompt: 'mv',
        devSettings: {
          portraitAspectRatio: '1:1',
          portraitPromptPreset: 'preset',
          spriteSize: 64,
          tripoAnimationMode: 'animated',
          tripoRetargetAnimations: 'preset:biped:walk preset:biped:run',
          tripoRetargetAnimationName: '',
          tripoMeshQuality: 'standard',
          tripoTextureQuality: 'standard',
          defaultSpritesEnabled: false,
        },
        portraitResult: {
          imageDataUrl: makeDataUrl('portrait'),
          promptUsed: 'pilot',
          inputMode: 'prompt',
          originalReferenceImageDataUrl: '',
        },
        multiviewResult: makeFullMultiviewResult(),
        tripoJob: makeSuccessfulTask(
          'rig-task-dev',
          'animate_rig',
          'rigged_model',
          '/api/tripo/tasks/rig-task-dev/model?variant=rigged_model&animationMode=static',
        ),
        pipelineState: {
          unlocked: { step1: true, step2: true, step3: true, step4: false },
          approved: { step1: true, step2: true, step3: false, step4: false },
        },
        step03TaskState: {
          modelTaskId: 'model-task-dev',
          rigTaskId: 'rig-task-dev',
          animateTaskId: '',
        },
      }),
    )

    createTripoRetargetTask.mockResolvedValue({ taskId: 'retarget-task-dev', status: 'queued' })

    render(<App />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'DEV' }))
    await user.clear(screen.getByLabelText('Retarget Animations'))
    await user.type(
      screen.getByLabelText('Retarget Animations'),
      'preset:biped:run preset:biped:slash',
    )
    await user.click(getDevActionButton('Animate'))

    await waitFor(() =>
      expect(createTripoRetargetTask).toHaveBeenCalledWith('rig-task-dev', {
        animations: ['preset:biped:run', 'preset:biped:slash'],
      }),
    )
  })

  it('recognizes look around in the configured animation list and sends it through Animate', async () => {
    window.localStorage.setItem(
      'ww-character-session-v1',
      JSON.stringify({
        prompt: 'pilot',
        multiviewPrompt: 'mv',
        devSettings: {
          portraitAspectRatio: '1:1',
          portraitPromptPreset: 'preset',
          spriteSize: 64,
          tripoAnimationMode: 'animated',
          tripoRetargetAnimations: 'preset:biped:run preset:biped:look_around',
          tripoRetargetAnimationName: '',
          tripoMeshQuality: 'standard',
          tripoTextureQuality: 'standard',
          defaultSpritesEnabled: false,
        },
        portraitResult: {
          imageDataUrl: makeDataUrl('portrait'),
          promptUsed: 'pilot',
          inputMode: 'prompt',
          originalReferenceImageDataUrl: '',
        },
        multiviewResult: makeFullMultiviewResult(),
        tripoJob: makeSuccessfulTask(
          'rig-task-look-around',
          'animate_rig',
          'rigged_model',
          '/api/tripo/tasks/rig-task-look-around/model?variant=rigged_model&animationMode=static',
        ),
        pipelineState: {
          unlocked: { step1: true, step2: true, step3: true, step4: false },
          approved: { step1: true, step2: true, step3: false, step4: false },
        },
        step03TaskState: {
          modelTaskId: 'model-task-look-around',
          rigTaskId: 'rig-task-look-around',
          animateTaskId: '',
        },
      }),
    )

    createTripoRetargetTask.mockResolvedValue({ taskId: 'retarget-task-look-around', status: 'queued' })

    render(<App />)
    const user = userEvent.setup()
    const step03Select = within(getStep03Panel()).getByLabelText('3D model animation preview')
    const step04Select = within(getStep04Panel()).getByLabelText('Sprite animation preview')

    expect(within(step03Select).getByRole('option', { name: 'Idle' })).toBeInTheDocument()
    expect(within(step04Select).getByRole('option', { name: 'Idle' })).toBeInTheDocument()

    await openDevPanel(user)
    await user.click(getDevActionButton('Animate'))

    await waitFor(() =>
      expect(createTripoRetargetTask).toHaveBeenCalledWith('rig-task-look-around', {
        animations: ['preset:biped:run', 'preset:biped:look_around'],
      }),
    )
  })

  it('keeps Generate 3D and AutoRig enabled after Animate starts', async () => {
    createTripoTask.mockResolvedValue({ taskId: 'model-task', status: 'queued' })
    createTripoRigTask.mockResolvedValue({ taskId: 'rig-task', status: 'queued' })
    createTripoRetargetTask.mockResolvedValue({ taskId: 'retarget-task', status: 'queued' })
    getTripoTask.mockImplementation(async (taskId) => {
      if (taskId === 'model-task') {
        return makeSuccessfulTask(
          'model-task',
          'multiview_to_model',
          'model',
          '/api/tripo/tasks/model-task/model?variant=model&animationMode=static',
        )
      }
      if (taskId === 'rig-task') {
        return makeSuccessfulTask(
          'rig-task',
          'animate_rig',
          'rigged_model',
          '/api/tripo/tasks/rig-task/model?variant=rigged_model&animationMode=static',
        )
      }
      if (taskId === 'retarget-task') {
        return {
          taskId: 'retarget-task',
          taskType: 'animate_retarget',
          sourceTaskId: 'rig-task',
          status: 'running',
          progress: 55,
          error: '',
          outputs: null,
        }
      }
      return { taskId, status: 'running', progress: 35, outputs: null }
    })

    render(<App />)
    const user = userEvent.setup()
    await unlockStep03(user)

    const generate3DButton = getDevActionButton('Generate 3D')
    const autoRigButton = getDevActionButton('AutoRig')
    const animateButton = getDevActionButton('Animate')

    await user.click(generate3DButton)
    await waitFor(() => expect(autoRigButton).toBeEnabled(), { timeout: 8000 })
    await user.click(autoRigButton)
    await waitFor(() => expect(animateButton).toBeEnabled(), { timeout: 8000 })
    await user.click(animateButton)

    await waitFor(() =>
      expect(createTripoRetargetTask).toHaveBeenCalledWith('rig-task', {
        animations: DEFAULT_RETARGET_ANIMATIONS,
      }),
    )
    expect(generate3DButton).toBeEnabled()
    expect(autoRigButton).toBeEnabled()
  }, 25000)

  it('clears downstream step 03 stages when Generate 3D is run again', async () => {
    createTripoTask
      .mockResolvedValueOnce({ taskId: 'model-task-1', status: 'queued' })
      .mockResolvedValueOnce({ taskId: 'model-task-2', status: 'queued' })
    createTripoRigTask.mockResolvedValue({ taskId: 'rig-task-1', status: 'queued' })
    createTripoRetargetTask.mockResolvedValue({ taskId: 'retarget-task-1', status: 'queued' })
    getTripoTask.mockImplementation(async (taskId) => {
      if (taskId === 'model-task-1' || taskId === 'model-task-2') {
        return makeSuccessfulTask(
          taskId,
          'multiview_to_model',
          'model',
          `/api/tripo/tasks/${taskId}/model?variant=model&animationMode=static`,
        )
      }
      if (taskId === 'rig-task-1') {
        return makeSuccessfulTask(
          'rig-task-1',
          'animate_rig',
          'rigged_model',
          '/api/tripo/tasks/rig-task-1/model?variant=rigged_model&animationMode=static',
        )
      }
      if (taskId === 'retarget-task-1') {
        return makeMultiAnimationTask('retarget-task-1')
      }
      return { taskId, status: 'running', progress: 35, outputs: null }
    })

    render(<App />)
    const user = userEvent.setup()
    await unlockStep03(user)
    const step03Panel = getStep03Panel()

    const generate3DButton = getDevActionButton('Generate 3D')
    const autoRigButton = getDevActionButton('AutoRig')
    const animateButton = getDevActionButton('Animate')
    const generate25dButton = getDevActionButton('Generate 2.5D')

    await user.click(generate3DButton)
    await waitFor(() => expect(autoRigButton).toBeEnabled(), { timeout: 8000 })
    await user.click(autoRigButton)
    await waitFor(() => expect(animateButton).toBeEnabled(), { timeout: 8000 })
    await user.click(animateButton)
    await waitFor(() => expect(generate25dButton).toBeEnabled(), { timeout: 8000 })
    expect(generate25dButton).toBeEnabled()

    await user.click(generate3DButton)
    expect(autoRigButton).toBeDisabled()
    expect(animateButton).toBeDisabled()
    expect(generate25dButton).toBeDisabled()
  }, 25000)

  it('keeps step 04 locked when step 03 fails and sanitizes provider names in top bar', async () => {
    createTripoTask.mockRejectedValue(new Error('Tripo failed via Gemini backend'))

    render(<App />)
    const user = userEvent.setup()
    await unlockStep03(user)

    await user.click(getDevActionButton('Generate 3D'))

    await waitFor(() => {
      expect(screen.getByText(/3D service failed via image service backend/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/tripo failed via gemini backend/i)).not.toBeInTheDocument()
    expect(getDevActionButton('Generate 2.5D')).toBeDisabled()
  })

  it('keeps progress on step 03 while step 04 is unlocked but not complete', () => {
    window.localStorage.setItem(
      'ww-character-session-v1',
      JSON.stringify({
        prompt: 'pilot',
        multiviewPrompt: 'mv',
        devSettings: {
          portraitAspectRatio: '1:1',
          portraitPromptPreset: 'preset',
          spriteSize: 64,
          tripoAnimationMode: 'animated',
          tripoRetargetAnimationName: '',
          tripoMeshQuality: 'standard',
          tripoTextureQuality: 'standard',
          defaultSpritesEnabled: false,
        },
        portraitResult: {
          imageDataUrl: makeDataUrl('portrait'),
          promptUsed: 'pilot',
          inputMode: 'prompt',
          originalReferenceImageDataUrl: '',
        },
        multiviewResult: makeFullMultiviewResult(),
        spriteResult: null,
        currentRunId: 'run-step3',
        history: [],
        tripoJob: makeMultiAnimationTask('retarget-task'),
        pipelineState: {
          unlocked: { step1: true, step2: true, step3: true, step4: true },
          approved: { step1: true, step2: true, step3: true, step4: false },
        },
      }),
    )

    render(<App />)
    expect(getProgressFill()).toHaveAttribute('data-step-index', '3')
  })

  it('reaches full-width step 04 progress when required sprite bundle exists', () => {
    window.localStorage.setItem(
      'ww-character-session-v1',
      JSON.stringify({
        prompt: 'pilot',
        multiviewPrompt: 'mv',
        devSettings: {
          portraitAspectRatio: '1:1',
          portraitPromptPreset: 'preset',
          spriteSize: 64,
          tripoAnimationMode: 'animated',
          tripoRetargetAnimationName: '',
          tripoMeshQuality: 'standard',
          tripoTextureQuality: 'standard',
          defaultSpritesEnabled: false,
        },
        portraitResult: {
          imageDataUrl: makeDataUrl('portrait'),
          promptUsed: 'pilot',
          inputMode: 'prompt',
          originalReferenceImageDataUrl: '',
        },
        multiviewResult: makeFullMultiviewResult(),
        spriteResult: makeCompleteSpriteResult(),
        currentRunId: 'run-step4',
        history: [],
        tripoJob: makeMultiAnimationTask('retarget-task'),
        pipelineState: {
          unlocked: { step1: true, step2: true, step3: true, step4: true },
          approved: { step1: true, step2: true, step3: true, step4: true },
        },
      }),
    )

    render(<App />)
    expect(getProgressFill()).toHaveAttribute('data-step-index', '4')
  })

  it('shows Download as the final step action instead of an accept icon button', () => {
    render(<App />)

    expect(within(getStep04Panel()).getByRole('button', { name: 'Download' })).toBeInTheDocument()
    expect(within(getStep04Panel()).queryByRole('button', { name: 'Accept Sprite' })).toBeNull()
  })

  it('shows the configured animation dropdown options in Step 03 and Step 04', async () => {
    render(<App />)
    const user = userEvent.setup()
    await unlockStep03(user)

    const step03Select = within(getStep03Panel()).getByLabelText('3D model animation preview')
    const step04Select = within(getStep04Panel()).getByLabelText('Sprite animation preview')

    expect(within(step03Select).getByRole('option', { name: 'A-pose' })).toBeInTheDocument()
    expect(within(step03Select).getByRole('option', { name: 'Walk' })).toBeInTheDocument()
    expect(within(step03Select).getByRole('option', { name: 'Run' })).toBeInTheDocument()
    expect(within(step03Select).getByRole('option', { name: 'Idle' })).toBeInTheDocument()
    expect(within(step03Select).queryByRole('option', { name: 'Slash' })).toBeNull()
    expect(within(step04Select).getByRole('option', { name: '360' })).toBeInTheDocument()
    expect(within(step04Select).getByRole('option', { name: 'Walk' })).toBeInTheDocument()
    expect(within(step04Select).getByRole('option', { name: 'Run' })).toBeInTheDocument()
    expect(within(step04Select).getByRole('option', { name: 'Idle' })).toBeInTheDocument()
    expect(within(step04Select).queryByRole('option', { name: 'Slash' })).toBeNull()
    expect(within(step04Select).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Walk',
      'Run',
      'Idle',
      '360',
    ])
  })

  it('defaults the DEV sprite size to 128 and exposes a 256 option', async () => {
    render(<App />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'DEV' }))

    const spriteSizeSelect = screen.getByRole('combobox', { name: 'Sprite Size' })
    expect(spriteSizeSelect).toHaveValue('128')
    expect(within(spriteSizeSelect).getByRole('option', { name: '256x256' })).toBeInTheDocument()
  })

  it('shows Look controls in DEV with the configured default relight values', async () => {
    render(<App />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'DEV' }))

    expect(screen.getByRole('combobox', { name: /Tone Mapping/i })).toHaveValue('aces')
    expect(screen.getByRole('slider', { name: /Exposure/i })).toHaveValue('0.68')
    expect(screen.getByRole('slider', { name: /Environment/i })).toHaveValue('0.75')
    expect(screen.getByRole('slider', { name: /Key Light/i })).toHaveValue('1.22')
    expect(screen.getByRole('slider', { name: /Fill Light/i })).toHaveValue('1.22')
    expect(screen.getByRole('slider', { name: /Rim Light/i })).toHaveValue('1.2')
    expect(screen.getByRole('slider', { name: /Ambient/i })).toHaveValue('0.82')
    expect(screen.getByRole('slider', { name: /Material Roughness/i })).toHaveValue('0.48')
    expect(screen.getByRole('slider', { name: /Contrast/i })).toHaveValue('1')
    expect(screen.getByRole('slider', { name: /Vibrance/i })).toHaveValue('0')
    expect(screen.getByRole('slider', { name: /Sharpen/i })).toHaveValue('0.04')
  })

  it('defaults DEV model quality settings to Ultra / Ultra / 64000', async () => {
    render(<App />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'DEV' }))

    expect(screen.getByRole('combobox', { name: 'Mesh Quality' })).toHaveValue('detailed')
    expect(screen.getByRole('combobox', { name: 'Texture Quality' })).toHaveValue('detailed')
    expect(screen.getByRole('spinbutton', { name: 'Face Limit' })).toHaveValue(64000)
  })

  it('defaults DEV PBR to false and lets Generate 3D send true', async () => {
    createTripoTask.mockResolvedValue({ taskId: 'model-task', status: 'queued' })

    render(<App />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'DEV' }))
    const pbrSelect = screen.getByRole('combobox', { name: 'PBR' })
    expect(pbrSelect).toHaveValue('false')
    await user.selectOptions(pbrSelect, 'true')

    await unlockStep03(user)
    await user.click(getDevActionButton('Generate 3D'))

    await waitFor(() =>
      expect(createTripoTask).toHaveBeenCalledWith(
        expect.objectContaining({
          pbr: true,
        }),
      ),
    )
  })

  it('switches the sprite browser by dropdown across animation bundles', async () => {
    window.localStorage.setItem(
      'ww-character-session-v1',
      JSON.stringify({
        prompt: 'pilot',
        multiviewPrompt: 'mv',
        devSettings: {
          portraitAspectRatio: '1:1',
          portraitPromptPreset: 'preset',
          spriteSize: 64,
          tripoAnimationMode: 'animated',
          tripoRetargetAnimationName: '',
          tripoMeshQuality: 'standard',
          tripoTextureQuality: 'standard',
          defaultSpritesEnabled: false,
        },
        portraitResult: {
          imageDataUrl: makeDataUrl('portrait'),
          promptUsed: 'pilot',
          inputMode: 'prompt',
          originalReferenceImageDataUrl: '',
        },
        multiviewResult: makeFullMultiviewResult(),
        spriteResult: makeCompleteSpriteResult(),
        currentRunId: 'run-step4-generate',
        history: [],
        tripoJob: makeMultiAnimationTask('retarget-task'),
        pipelineState: {
          unlocked: { step1: true, step2: true, step3: true, step4: true },
          approved: { step1: true, step2: true, step3: true, step4: false },
        },
        step03TaskState: {
          modelTaskId: 'model-task',
          rigTaskId: 'rig-task',
          animateTaskId: 'retarget-task',
        },
      }),
    )

    render(<App />)
    const user = userEvent.setup()
    const step04Panel = getStep04Panel()
    const spriteSelect = within(step04Panel).getByLabelText('Sprite animation preview')

    expect(spriteSelect).toHaveValue('walk')
    await waitFor(() => expect(within(step04Panel).getAllByRole('img')).toHaveLength(8))
    await user.selectOptions(spriteSelect, 'run')
    expect(spriteSelect).toHaveValue('run')
    await waitFor(() => expect(within(step04Panel).getAllByRole('img')).toHaveLength(8))
  })

})
