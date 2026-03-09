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
  ModelViewer: ({ modelUrl, onCaptureApiReady }) => {
    onCaptureApiReady?.({
      captureAnimatedSpriteDirections: vi.fn().mockResolvedValue({}),
    })
    return <div data-testid="viewer-stub">{modelUrl}</div>
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
  view_360: makeSpriteDirection('view_360'),
  front: makeSpriteDirection('front'),
  front_right: makeSpriteDirection('front_right'),
  right: makeSpriteDirection('right'),
  back_right: makeSpriteDirection('back_right'),
  back: makeSpriteDirection('back'),
  back_left: makeSpriteDirection('back_left'),
  left: makeSpriteDirection('left'),
  front_left: makeSpriteDirection('front_left'),
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

const getStep01Panel = () => screen.getByLabelText('Step 01 Portrait Panel')
const getStep02Panel = () => screen.getByLabelText('Step 02 Multiview Panel')
const getStep03Panel = () => screen.getByLabelText('Step 03 3D Model Panel')
const getStep04Panel = () => screen.getByLabelText('Step 04 Sprite Panel')
const getProgressFill = () => screen.getByTestId('status-progress-fill')

const generatePortraitAndAccept = async (user) => {
  await user.type(screen.getByLabelText('Character prompt'), 'pilot')
  await user.click(screen.getByRole('button', { name: 'Generate PFP' }))
  await waitFor(() => expect(generatePortrait).toHaveBeenCalledTimes(1))
  const acceptPortraitButton = screen.getByRole('button', { name: 'Accept Portrait' })
  expect(acceptPortraitButton).toBeEnabled()
  await user.click(acceptPortraitButton)
}

const unlockStep03 = async (user) => {
  await generatePortraitAndAccept(user)

  const step02Panel = getStep02Panel()
  const generate2DButton = within(step02Panel).getByRole('button', { name: 'Generate 2D' })
  await user.click(generate2DButton)
  await waitFor(() => expect(generateMultiview).toHaveBeenCalledTimes(1))

  const accept2DButton = within(step02Panel).getByRole('button', { name: 'Accept Multiview' })
  expect(accept2DButton).toBeEnabled()
  await user.click(accept2DButton)
}

describe('App', () => {
  beforeEach(() => {
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
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.useRealTimers()
    window.localStorage.clear()
  })

  it('renders unified top progress bar and initial step gating', () => {
    render(<App />)

    expect(screen.getByRole('progressbar', { name: 'Pipeline step progress' })).toBeInTheDocument()
    expect(screen.queryByText(/^Session:/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Message:\s*SUCCESS/i)).not.toBeInTheDocument()
    expect(getProgressFill()).toHaveAttribute('data-step-index', '1')

    expect(within(getStep01Panel()).getByRole('button', { name: 'Generate PFP' })).toBeEnabled()
    expect(within(getStep01Panel()).getByRole('button', { name: 'Accept Portrait' })).toBeDisabled()

    expect(within(getStep02Panel()).getByRole('button', { name: 'Generate 2D' })).toBeDisabled()
    expect(within(getStep02Panel()).getByRole('button', { name: 'Accept Multiview' })).toBeDisabled()

    expect(within(getStep03Panel()).getByRole('button', { name: 'Generate 3D' })).toBeDisabled()
    expect(within(getStep03Panel()).getByRole('button', { name: 'Accept 3D' })).toBeDisabled()

    expect(within(getStep04Panel()).getByRole('button', { name: 'Generate 2.5D' })).toBeDisabled()
    expect(within(getStep04Panel()).getByRole('button', { name: 'Download' })).toBeDisabled()
  })

  it('unlocks step 02 only after Accept Portrait and does not auto-generate multiview', async () => {
    render(<App />)
    const user = userEvent.setup()

    await generatePortraitAndAccept(user)

    expect(generateMultiview).not.toHaveBeenCalled()
    expect(within(getStep02Panel()).getByRole('button', { name: 'Generate 2D' })).toBeEnabled()
    expect(getProgressFill()).toHaveAttribute('data-step-index', '2')
  })

  it('runs step 02 generation and unlocks step 03 on step 02 accept', async () => {
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
    expect(within(getStep03Panel()).getByRole('button', { name: 'Generate 3D' })).toBeEnabled()
    expect(getProgressFill()).toHaveAttribute('data-step-index', '3')
  })

  it('runs step 03 chain in order with 3-second delays between stages', async () => {
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
        return makeSuccessfulTask(
          'retarget-task',
          'animate_retarget',
          'animation_model',
          '/api/tripo/tasks/retarget-task/model?variant=animation_model&animationMode=animated',
        )
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
    const step04Panel = getStep04Panel()

    expect(within(step04Panel).getByRole('button', { name: 'Generate 2.5D' })).toBeDisabled()

    const chainStartTimestamp = Date.now()
    await user.click(within(step03Panel).getByRole('button', { name: 'Generate 3D' }))
    await waitFor(() => expect(createTripoTask).toHaveBeenCalledTimes(1))

    expect(createTripoRigTask).not.toHaveBeenCalled()
    await waitFor(() => expect(createTripoRigTask).toHaveBeenCalledWith('model-task'), {
      timeout: 10000,
    })
    const rigCallDelayMs = Date.now() - chainStartTimestamp
    expect(rigCallDelayMs).toBeGreaterThanOrEqual(2800)

    expect(createTripoRetargetTask).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(createTripoRetargetTask).toHaveBeenCalledWith('rig-task', { animationName: '' }),
      { timeout: 10000 },
    )
    const retargetCallDelayMs = Date.now() - chainStartTimestamp
    expect(retargetCallDelayMs).toBeGreaterThanOrEqual(5800)

    const accept3DButton = within(step03Panel).getByRole('button', { name: 'Accept 3D' })
    await waitFor(() => expect(accept3DButton).toBeEnabled())
    await user.click(accept3DButton)

    expect(within(step04Panel).getByRole('button', { name: 'Generate 2.5D' })).toBeEnabled()
    expect(getProgressFill()).toHaveAttribute('data-step-index', '3')
  }, 20000)

  it('keeps step 04 locked when step 03 fails and sanitizes provider names in top bar', async () => {
    createTripoTask.mockRejectedValue(new Error('Tripo failed via Gemini backend'))

    render(<App />)
    const user = userEvent.setup()
    await unlockStep03(user)

    await user.click(within(getStep03Panel()).getByRole('button', { name: 'Generate 3D' }))

    await waitFor(() => {
      expect(screen.getByText(/3D service failed via image service backend/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/tripo failed via gemini backend/i)).not.toBeInTheDocument()
    expect(within(getStep04Panel()).getByRole('button', { name: 'Generate 2.5D' })).toBeDisabled()
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
        tripoJob: makeSuccessfulTask(
          'retarget-task',
          'animate_retarget',
          'animation_model',
          '/api/tripo/tasks/retarget-task/model?variant=animation_model',
        ),
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
        spriteResult: {
          animation: 'walk',
          spriteSize: 64,
          directions: makeRequiredSpriteDirections(),
        },
        currentRunId: 'run-step4',
        history: [],
        tripoJob: makeSuccessfulTask(
          'retarget-task',
          'animate_retarget',
          'animation_model',
          '/api/tripo/tasks/retarget-task/model?variant=animation_model',
        ),
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
})
