import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import {
  createTripoFrontBackTask,
  createTripoFrontTask,
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
  createTripoRigTask: vi.fn(),
  createTripoRetargetTask: vi.fn(),
  getTripoTask: vi.fn(),
  restartDevServer: vi.fn(),
}))

vi.mock('../components/ModelViewer', () => ({
  ModelViewer: ({ modelUrl }) => <div data-testid="viewer-stub">{modelUrl}</div>,
}))

const makeDataUrl = (seed) => `data:image/png;base64,${btoa(seed)}`

const makeFullMultiviewResult = () => ({
  mode: 'full',
  views: {
    front: { imageDataUrl: makeDataUrl('front'), source: 'gemini' },
    back: { imageDataUrl: makeDataUrl('back'), source: 'gemini' },
    left: { imageDataUrl: makeDataUrl('left'), source: 'gemini' },
    right: { imageDataUrl: makeDataUrl('right'), source: 'mirrored-left' },
  },
})

const makeSpriteResult = (size = 64) => ({
  animation: 'run',
  spriteSize: size,
  directions: {
    front: {
      previewDataUrl: makeDataUrl('sprite-front-a'),
      frameDataUrls: [makeDataUrl('sprite-front-a'), makeDataUrl('sprite-front-b')],
      source: 'pixellab',
      frames: { count: 2, format: 'base64-frame-sequence' },
    },
    back: {
      previewDataUrl: makeDataUrl('sprite-back-a'),
      frameDataUrls: [makeDataUrl('sprite-back-a'), makeDataUrl('sprite-back-b')],
      source: 'pixellab',
      frames: { count: 2, format: 'base64-frame-sequence' },
    },
    left: {
      previewDataUrl: makeDataUrl('sprite-left-a'),
      frameDataUrls: [makeDataUrl('sprite-left-a'), makeDataUrl('sprite-left-b')],
      source: 'pixellab',
      frames: { count: 2, format: 'base64-frame-sequence' },
    },
    right: {
      previewDataUrl: makeDataUrl('sprite-right-a'),
      frameDataUrls: [makeDataUrl('sprite-right-a'), makeDataUrl('sprite-right-b')],
      source: 'pixellab',
      frames: { count: 2, format: 'base64-frame-sequence' },
    },
  },
})

const openDevPanel = async (user) => {
  await user.click(screen.getByRole('button', { name: 'DEV' }))
}

const generatePortraitThenMultiview = async (user) => {
  await user.type(screen.getByLabelText('Character prompt'), 'pilot')
  await user.click(screen.getByRole('button', { name: 'Generate PFP' }))
  await waitFor(() => expect(generatePortrait).toHaveBeenCalledTimes(1))
  expect(generateMultiview).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Accept Portrait' }))
  await waitFor(() => expect(generateMultiview).toHaveBeenCalledTimes(1))

  await openDevPanel(user)
}

describe('App', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.useRealTimers()
    window.localStorage.clear()
  })

  it('keeps Create 3D Model disabled until turnaround exists', async () => {
    render(<App />)
    const user = userEvent.setup()
    await openDevPanel(user)

    expect(screen.getByRole('button', { name: 'Generate 3D' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '3D Front' })).toBeDisabled()
  })

  beforeEach(() => {
    getHealth.mockResolvedValue({
      status: 'ok',
      versions: {
        tripoModelVersion: 'v3.1-20260211',
        tripoRigModelVersion: 'v2.0-20250506',
      },
    })
  })

  it('shows DEV sprite controls and keeps sprite button disabled until full multiview exists', async () => {
    render(<App />)
    const user = userEvent.setup()

    await openDevPanel(user)

    expect(screen.getByRole('button', { name: 'Generate Sprite Run' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Sprite Size' })).toHaveValue('64')
  })

  it('starts multiview only after clicking prompt Accept', async () => {
    generatePortrait.mockResolvedValue({
      imageDataUrl: makeDataUrl('portrait'),
      promptUsed: 'pilot',
      inputMode: 'prompt',
      normalizedReferenceImageDataUrl: null,
    })
    generateMultiview.mockResolvedValue(makeFullMultiviewResult())

    render(<App />)
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Character prompt'), 'pilot')
    await user.click(screen.getByRole('button', { name: 'Generate PFP' }))
    await waitFor(() => expect(generatePortrait).toHaveBeenCalledTimes(1))
    expect(generateMultiview).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Accept Portrait' }))
    await waitFor(() => expect(generateMultiview).toHaveBeenCalledTimes(1))
  })

  it('generates sprite run and renders four animated direction tiles', async () => {
    generatePortrait.mockResolvedValue({
      imageDataUrl: makeDataUrl('portrait'),
      promptUsed: 'pilot',
      inputMode: 'prompt',
      normalizedReferenceImageDataUrl: null,
    })
    generateMultiview.mockResolvedValue(makeFullMultiviewResult())
    generateSpriteRun.mockResolvedValue(makeSpriteResult(64))

    render(<App />)
    const user = userEvent.setup()

    await generatePortraitThenMultiview(user)

    const spriteButton = screen.getByRole('button', { name: 'Generate Sprite Run' })
    expect(spriteButton).toBeEnabled()

    await user.click(spriteButton)

    await waitFor(() =>
      expect(generateSpriteRun).toHaveBeenCalledWith({
        views: {
          front: makeDataUrl('front'),
          back: makeDataUrl('back'),
          left: makeDataUrl('left'),
          right: makeDataUrl('right'),
        },
        spriteSize: 64,
      }),
    )

    await waitFor(() => {
      expect(screen.getByAltText('Front run sprite preview')).toBeInTheDocument()
      expect(screen.getByAltText('Back run sprite preview')).toBeInTheDocument()
      expect(screen.getByAltText('Left run sprite preview')).toBeInTheDocument()
      expect(screen.getByAltText('Right run sprite preview')).toBeInTheDocument()
    })
  })

  it('shows sprite API failure in the top-bar Message', async () => {
    generatePortrait.mockResolvedValue({
      imageDataUrl: makeDataUrl('portrait'),
      promptUsed: 'pilot',
      inputMode: 'prompt',
      normalizedReferenceImageDataUrl: null,
    })
    generateMultiview.mockResolvedValue(makeFullMultiviewResult())
    generateSpriteRun.mockRejectedValue(new Error('PixelLab auth failure'))

    render(<App />)
    const user = userEvent.setup()

    await generatePortraitThenMultiview(user)
    await user.click(screen.getByRole('button', { name: 'Generate Sprite Run' }))

    await waitFor(() => {
      expect(screen.getByText(/PixelLab auth failure/i)).toBeInTheDocument()
    })
  })

  it('restores persisted sprite result and sprite size across refresh', async () => {
    window.localStorage.setItem(
      'ww-character-session-v1',
      JSON.stringify({
        prompt: 'pilot',
        multiviewPrompt: 'default multiview',
        devSettings: {
          portraitAspectRatio: '1:1',
          portraitPromptPreset: 'preset',
          spriteSize: 128,
        },
        portraitResult: {
          imageDataUrl: makeDataUrl('portrait'),
          promptUsed: 'pilot',
          inputMode: 'prompt',
          originalReferenceImageDataUrl: '',
        },
        multiviewResult: makeFullMultiviewResult(),
        spriteResult: makeSpriteResult(128),
        currentRunId: 'run-1',
        history: [],
        tripoJob: {
          taskId: '',
          status: 'idle',
          progress: 0,
          error: '',
          outputs: null,
        },
      }),
    )

    render(<App />)
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByAltText('Front run sprite preview')).toBeInTheDocument()
    })

    await openDevPanel(user)
    expect(screen.getByRole('combobox', { name: 'Sprite Size' })).toHaveValue('128')
  })

  it('loads an existing Tripo task id from DEV without regenerating mesh', async () => {
    getTripoTask.mockResolvedValue({
      taskId: 'existing-mesh-1',
      taskType: 'image_to_model',
      sourceTaskId: '',
      status: 'success',
      progress: 100,
      error: '',
      outputs: {
        modelUrl: '/api/tripo/tasks/existing-mesh-1/model?variant=model&animationMode=static',
        downloadUrl: '/api/tripo/tasks/existing-mesh-1/model?variant=model&animationMode=static',
        variant: 'model',
        variants: {
          model: '/api/tripo/tasks/existing-mesh-1/model?variant=model&animationMode=static',
        },
      },
    })

    render(<App />)
    const user = userEvent.setup()

    await openDevPanel(user)
    await user.type(screen.getByRole('textbox', { name: 'Load Existing Tripo Task ID' }), 'existing-mesh-1')
    await user.click(screen.getByRole('button', { name: 'Load Existing Task' }))

    await waitFor(() => expect(getTripoTask).toHaveBeenCalledWith('existing-mesh-1', 'static'))
    await waitFor(() => {
      expect(screen.getByTestId('viewer-stub')).toHaveTextContent(
        '/api/tripo/tasks/existing-mesh-1/model?variant=model&animationMode=static',
      )
    })
  })

  it('submits mesh-only Tripo creation from multiview', async () => {
    generatePortrait.mockResolvedValue({
      imageDataUrl: makeDataUrl('portrait'),
      promptUsed: 'pilot',
      inputMode: 'prompt',
      normalizedReferenceImageDataUrl: null,
    })
    generateMultiview.mockResolvedValue(makeFullMultiviewResult())
    createTripoTask.mockResolvedValue({
      taskId: 'task-static-1',
      status: 'queued',
    })

    render(<App />)
    const user = userEvent.setup()

    await generatePortraitThenMultiview(user)
    await user.click(screen.getByRole('button', { name: 'Generate 3D' }))

    await waitFor(() =>
      expect(createTripoTask).toHaveBeenCalledWith({
        views: {
          front: makeDataUrl('front'),
          back: makeDataUrl('back'),
          left: makeDataUrl('left'),
          right: makeDataUrl('right'),
        },
        meshQuality: 'standard',
        textureQuality: 'standard',
      }),
    )
  })

  it('supports front+back Tripo task creation', async () => {
    generatePortrait.mockResolvedValue({
      imageDataUrl: makeDataUrl('portrait'),
      promptUsed: 'pilot',
      inputMode: 'prompt',
      normalizedReferenceImageDataUrl: null,
    })
    generateMultiview.mockResolvedValue(makeFullMultiviewResult())
    createTripoFrontBackTask.mockResolvedValue({
      taskId: 'task-front-back-1',
      status: 'queued',
    })

    render(<App />)
    const user = userEvent.setup()

    await generatePortraitThenMultiview(user)
    await user.click(screen.getByRole('button', { name: 'Accept' }))

    await waitFor(() =>
      expect(createTripoFrontBackTask).toHaveBeenCalledWith({
        views: {
          front: makeDataUrl('front'),
          back: makeDataUrl('back'),
        },
        meshQuality: 'standard',
        textureQuality: 'standard',
      }),
    )
  })

  it('runs explicit rig and retarget steps before switching preview pose', async () => {
    generatePortrait.mockResolvedValue({
      imageDataUrl: makeDataUrl('portrait'),
      promptUsed: 'pilot',
      inputMode: 'prompt',
      normalizedReferenceImageDataUrl: null,
    })
    generateMultiview.mockResolvedValue(makeFullMultiviewResult())
    createTripoTask.mockResolvedValue({
      taskId: 'task-base-1',
      taskType: 'multiview_to_model',
      status: 'success',
      progress: 100,
    })
    createTripoRigTask.mockResolvedValue({
      taskId: 'task-rig-1',
      taskType: 'animate_rig',
      sourceTaskId: 'task-base-1',
      status: 'success',
      progress: 100,
    })
    createTripoRetargetTask.mockResolvedValue({
      taskId: 'task-anim-1',
      taskType: 'animate_retarget',
      sourceTaskId: 'task-rig-1',
      status: 'success',
      progress: 100,
    })
    getTripoTask.mockResolvedValue({
      taskId: 'task-anim-1',
      taskType: 'animate_retarget',
      sourceTaskId: 'task-rig-1',
      status: 'success',
      progress: 100,
      error: '',
      outputs: {
        modelUrl: '/api/tripo/tasks/task-anim-1/model?variant=animation_model',
        downloadUrl: '/api/tripo/tasks/task-anim-1/model?variant=animation_model',
        variant: 'animation_model',
        variants: {
          animation_model: '/api/tripo/tasks/task-anim-1/model?variant=animation_model',
          rigged_model: '/api/tripo/tasks/task-anim-1/model?variant=rigged_model',
        },
      },
    })

    render(<App />)
    const user = userEvent.setup()

    await generatePortraitThenMultiview(user)
    await user.click(screen.getByRole('button', { name: 'Generate 3D' }))
    await user.click(screen.getAllByRole('button', { name: 'Animate Rig' })[0])
    await waitFor(() => expect(createTripoRigTask).toHaveBeenCalledWith('task-base-1'))
    await user.type(screen.getByRole('textbox', { name: 'Retarget Animation' }), 'preset:walk')
    await user.click(screen.getAllByRole('button', { name: 'Animate Retarget' })[0])
    await waitFor(() =>
      expect(createTripoRetargetTask).toHaveBeenCalledWith('task-rig-1', {
        animationName: 'preset:walk',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Force Pull Result' }))

    await waitFor(() => {
      expect(screen.getByTestId('viewer-stub')).toHaveTextContent(
        '/api/tripo/tasks/task-anim-1/model?variant=animation_model',
      )
    })

    await user.selectOptions(screen.getByRole('combobox', { name: 'Preview Pose' }), 'apose')

    await waitFor(() => {
      expect(screen.getByTestId('viewer-stub')).toHaveTextContent(
        '/api/tripo/tasks/task-anim-1/model?variant=rigged_model',
      )
    })
  })

  it('allows retargeting again from a successful animation task by using its source rig task', async () => {
    window.localStorage.setItem(
      'ww-character-session-v1',
      JSON.stringify({
        prompt: 'pilot',
        multiviewPrompt: 'default multiview',
        devSettings: {
          portraitAspectRatio: '1:1',
          portraitPromptPreset: 'preset',
          spriteSize: 128,
          tripoRetargetAnimationName: '',
        },
        portraitResult: {
          imageDataUrl: makeDataUrl('portrait'),
          promptUsed: 'pilot',
          inputMode: 'prompt',
          originalReferenceImageDataUrl: '',
        },
        multiviewResult: makeFullMultiviewResult(),
        spriteResult: makeSpriteResult(128),
        currentRunId: 'run-1',
        history: [],
        tripoJob: {
          taskId: 'task-anim-existing-1',
          taskType: 'animate_retarget',
          sourceTaskId: 'task-rig-existing-1',
          status: 'success',
          progress: 100,
          error: '',
          outputs: {
            modelUrl: '/api/tripo/tasks/task-anim-existing-1/model?variant=animation_model',
            downloadUrl: '/api/tripo/tasks/task-anim-existing-1/model?variant=animation_model',
            variant: 'animation_model',
            variants: {
              animation_model: '/api/tripo/tasks/task-anim-existing-1/model?variant=animation_model',
              rigged_model: '/api/tripo/tasks/task-anim-existing-1/model?variant=rigged_model',
            },
          },
          animationMode: 'animated',
        },
      }),
    )
    createTripoRetargetTask.mockResolvedValue({
      taskId: 'task-anim-new-1',
      taskType: 'animate_retarget',
      sourceTaskId: 'task-rig-existing-1',
      status: 'queued',
      progress: 0,
    })

    render(<App />)
    const user = userEvent.setup()

    await openDevPanel(user)
    await user.clear(screen.getByRole('textbox', { name: 'Retarget Animation' }))
    await user.type(screen.getByRole('textbox', { name: 'Retarget Animation' }), 'preset:run')
    await user.click(screen.getAllByRole('button', { name: 'Animate Retarget' })[0])

    await waitFor(() =>
      expect(createTripoRetargetTask).toHaveBeenCalledWith('task-anim-existing-1', {
        animationName: 'preset:run',
      }),
    )
  })

  it('still supports front-only Tripo task creation', async () => {
    generatePortrait.mockResolvedValue({
      imageDataUrl: makeDataUrl('portrait'),
      promptUsed: 'pilot',
      inputMode: 'prompt',
      normalizedReferenceImageDataUrl: null,
    })
    generateMultiview.mockResolvedValue({
      mode: 'front-only',
      views: {
        front: { imageDataUrl: makeDataUrl('front-only'), source: 'gemini' },
        back: { imageDataUrl: '', source: 'front-test' },
        left: { imageDataUrl: '', source: 'front-test' },
        right: { imageDataUrl: '', source: 'front-test' },
      },
    })
    createTripoFrontTask.mockResolvedValue({
      taskId: 'task-front-1',
      status: 'queued',
    })
    createTripoTask.mockResolvedValue({
      taskId: 'task-full-1',
      status: 'queued',
    })
    getTripoTask.mockResolvedValue({
      taskId: 'task-front-1',
      status: 'running',
      progress: 30,
      error: '',
      outputs: null,
    })

    render(<App />)
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Character prompt'), 'pilot')
    await user.click(screen.getByRole('button', { name: 'Generate PFP' }))
    await waitFor(() => expect(generatePortrait).toHaveBeenCalledTimes(1))
    expect(generateMultiview).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Accept Portrait' }))
    await waitFor(() => expect(generateMultiview).toHaveBeenCalledTimes(1))

    await openDevPanel(user)
    await user.click(screen.getByRole('button', { name: 'Generate only front view' }))
    await waitFor(() => expect(generateMultiview).toHaveBeenCalledTimes(2))
    expect(generateMultiview).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'front-only',
      }),
    )

    expect(screen.getByRole('button', { name: 'Generate 3D' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '3D Front' })).toBeEnabled()
  })
})
