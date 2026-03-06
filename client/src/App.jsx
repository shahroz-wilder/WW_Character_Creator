import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  createTripoFrontBackTask,
  createTripoFrontTask,
  createTripoTask,
  generateMultiview,
  generatePortrait,
  generateSpriteRun,
  getTripoTask,
  restartDevServer,
} from './api/characterApi'
import { DEFAULT_MULTIVIEW_PROMPT } from './constants/prompts'
import { CharacterPromptForm } from './components/CharacterPromptForm'
import { HistoryPanel } from './components/HistoryPanel'
import { MultiviewGrid } from './components/MultiviewGrid'
import { MultiviewPromptEditor } from './components/MultiviewPromptEditor'
import { PortraitReviewCard } from './components/PortraitReviewCard'
import { SpriteGrid } from './components/SpriteGrid'
import { TripoJobPanel } from './components/TripoJobPanel'
import { downloadDataUrl, downloadFromUrl } from './lib/download'
import { createHistoryEntry, createRunId, updateHistoryEntry } from './lib/historyStore'
import {
  clearPersistedSession,
  loadPersistedSession,
  loadPersistedRichSession,
  savePersistedSession,
} from './lib/persistedSession'

const EMPTY_JOB = {
  taskId: '',
  status: 'idle',
  progress: 0,
  error: '',
  outputs: null,
  animationMode: '',
}

const hasCompleteTurnaround = (views) =>
  Boolean(
    views?.front?.imageDataUrl &&
      views?.back?.imageDataUrl &&
      views?.left?.imageDataUrl &&
      views?.right?.imageDataUrl,
  )

const ModelViewer = lazy(() =>
  import('./components/ModelViewer').then((module) => ({ default: module.ModelViewer })),
)

const DEV_PRESETS = {
  portraitAspectRatio: '1:1',
  portraitPreset:
    'Character identity portrait front with torso and head in frame centered framing, Grey seamless background, no cape, no weapon',
  multiviewPreset: DEFAULT_MULTIVIEW_PROMPT,
  spriteSize: 64,
  tripoAnimationMode: 'static',
}

const MULTIVIEW_ORDER = ['front', 'back', 'left', 'right']
const MODEL_VIEW_CAPTURE_ORDER = [
  { key: 'front', label: 'Front' },
  { key: 'back', label: 'Back' },
  { key: 'sideLeft', label: 'SideLeft' },
  { key: 'sideRight', label: 'SideRight' },
  { key: 'frontRight', label: 'FrontRight' },
  { key: 'frontLeft', label: 'FrontLeft' },
  { key: 'backtRight', label: 'BacktRight' },
  { key: 'backtLeft', label: 'BacktLeft' },
]

const mimeTypeToExtension = (mimeType = 'image/png') => {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) {
    return 'jpg'
  }

  if (mimeType.includes('webp')) {
    return 'webp'
  }

  if (mimeType.includes('gif')) {
    return 'gif'
  }

  return 'png'
}

const getDataUrlFileExtension = (dataUrl) => {
  const match = String(dataUrl || '').match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/)
  return mimeTypeToExtension(match?.[1] || 'image/png')
}

const formatModelLabel = (value) => {
  const trimmed = String(value || '').trim()
  return trimmed || 'Not generated yet.'
}

const MODEL_OUTPUT_VARIANT_ORDER = [
  'animation_model',
  'animated_model',
  'rigged_model',
  'pbr_model',
  'model',
  'base_model',
]

const ANIMATED_MODEL_VARIANT_PRIORITY = ['animation_model', 'animated_model']
const APOSE_MODEL_VARIANT_PRIORITY = ['rigged_model', 'model', 'pbr_model', 'base_model']

const MODEL_OUTPUT_VARIANT_LABELS = {
  animation_model: 'Animated',
  animated_model: 'Animated',
  rigged_model: 'A-pose',
  pbr_model: 'PBR Model',
  model: 'Model',
  base_model: 'Base Model',
}

const formatModelOutputVariantLabel = (variant) =>
  MODEL_OUTPUT_VARIANT_LABELS[variant] ||
  String(variant || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())

const findFirstAvailableVariant = (variants, priority) =>
  priority.find((variant) => Boolean(variants?.[variant])) || ''

const normalizeAnimationMode = (value) => {
  const normalizedValue = String(value || '').trim().toLowerCase()
  return normalizedValue === 'animated' || normalizedValue === 'static' ? normalizedValue : ''
}

function App() {
  const [initialSession] = useState(() => loadPersistedSession())
  const [prompt, setPrompt] = useState(() => initialSession?.prompt || '')
  const [referenceImage, setReferenceImage] = useState(null)
  const [devSettings, setDevSettings] = useState(() => ({
    portraitAspectRatio: initialSession?.devSettings?.portraitAspectRatio || DEV_PRESETS.portraitAspectRatio,
    portraitPromptPreset:
      initialSession?.devSettings?.portraitPromptPreset || DEV_PRESETS.portraitPreset,
    spriteSize: Number(initialSession?.devSettings?.spriteSize) || DEV_PRESETS.spriteSize,
    tripoAnimationMode:
      initialSession?.devSettings?.tripoAnimationMode || DEV_PRESETS.tripoAnimationMode,
  }))
  const [portraitResult, setPortraitResult] = useState(() => initialSession?.portraitResult || null)
  const [multiviewPrompt, setMultiviewPrompt] = useState(
    () => initialSession?.multiviewPrompt || DEFAULT_MULTIVIEW_PROMPT,
  )
  const [multiviewResult, setMultiviewResult] = useState(() => initialSession?.multiviewResult || null)
  const [spriteResult, setSpriteResult] = useState(() => initialSession?.spriteResult || null)
  const [tripoJob, setTripoJob] = useState(() => ({
    ...EMPTY_JOB,
    ...(initialSession?.tripoJob || {}),
    animationMode:
      normalizeAnimationMode(initialSession?.tripoJob?.animationMode) ||
      normalizeAnimationMode(initialSession?.devSettings?.tripoAnimationMode),
  }))
  const [history, setHistory] = useState(() => initialSession?.history || [])
  const [currentRunId, setCurrentRunId] = useState(() => initialSession?.currentRunId || '')
  const [error, setError] = useState('')
  const [isGeneratingPortrait, setIsGeneratingPortrait] = useState(false)
  const [turnaroundGenerationMode, setTurnaroundGenerationMode] = useState('')
  const [isCreatingModel, setIsCreatingModel] = useState(false)
  const [isCreatingFrontBackModel, setIsCreatingFrontBackModel] = useState(false)
  const [isCreatingFrontModel, setIsCreatingFrontModel] = useState(false)
  const [isGeneratingSprite, setIsGeneratingSprite] = useState(false)
  const [isRefreshingTripoJob, setIsRefreshingTripoJob] = useState(false)
  const [isRestartingServer, setIsRestartingServer] = useState(false)
  const [hasHydratedPersistedSession, setHasHydratedPersistedSession] = useState(false)
  const [viewerResetSignal, setViewerResetSignal] = useState(0)
  const [isDevPanelOpen, setIsDevPanelOpen] = useState(false)
  const [modelViewPack, setModelViewPack] = useState(null)
  const [isCapturingModelViews, setIsCapturingModelViews] = useState(false)
  const [modelPreviewMode, setModelPreviewMode] = useState('animated')
  const viewerCaptureApiRef = useRef(null)
  const modelOutputVariants = tripoJob.outputs?.variants || null
  const hasModelViewPack = MODEL_VIEW_CAPTURE_ORDER.some((view) => Boolean(modelViewPack?.[view.key]?.dataUrl))
  const availableModelVariants = MODEL_OUTPUT_VARIANT_ORDER.filter((variant) =>
    Boolean(modelOutputVariants?.[variant]),
  )
  const animatedModelVariant = findFirstAvailableVariant(
    modelOutputVariants,
    ANIMATED_MODEL_VARIANT_PRIORITY,
  )
  const aposeModelVariant = findFirstAvailableVariant(modelOutputVariants, APOSE_MODEL_VARIANT_PRIORITY)
  const requestedModelVariant = modelPreviewMode === 'apose' ? aposeModelVariant : animatedModelVariant
  const fallbackModelVariant = modelPreviewMode === 'apose' ? animatedModelVariant : aposeModelVariant
  const resolvedModelVariant =
    requestedModelVariant ||
    fallbackModelVariant ||
    (tripoJob.outputs?.variant && availableModelVariants.includes(tripoJob.outputs.variant)
      ? tripoJob.outputs.variant
      : availableModelVariants[0] || '')
  const isPreviewModeUnavailable = Boolean(tripoJob.taskId && !requestedModelVariant)
  const activeModelUrl =
    (resolvedModelVariant && modelOutputVariants?.[resolvedModelVariant]) ||
    tripoJob.outputs?.modelUrl ||
    ''
  const activeDownloadUrl =
    (resolvedModelVariant && modelOutputVariants?.[resolvedModelVariant]) ||
    tripoJob.outputs?.downloadUrl ||
    ''

  const currentPipelineState = error
    ? 'Attention needed'
    : isGeneratingPortrait
      ? 'Generating portrait'
      : turnaroundGenerationMode === 'front-only'
        ? 'Generating front view'
      : turnaroundGenerationMode === 'full'
        ? 'Generating turnaround'
        : isGeneratingSprite
          ? 'Generating sprite run'
          : isCreatingModel
            ? 'Submitting multiview model'
            : isCreatingFrontBackModel
              ? 'Submitting front-back model'
              : isCreatingFrontModel
                ? 'Submitting front-view model'
                : isRefreshingTripoJob
                  ? 'Refreshing Tripo result'
                  : tripoJob.status === 'success'
                    ? '3D model ready'
                    : tripoJob.status === 'running'
                      ? 'Tripo is building the model'
                      : tripoJob.status === 'queued'
                        ? 'Tripo task queued'
                        : portraitResult?.imageDataUrl
                          ? 'Portrait ready for next step'
                          : 'Ready for a new character'

  const pipelineSummary = tripoJob.taskId
    ? `${tripoJob.status.toUpperCase()}${tripoJob.progress ? ` ${tripoJob.progress}%` : ''}`
    : portraitResult?.imageDataUrl
      ? 'PORTRAIT READY'
      : 'IDLE'
  const topBarMessage = error || pipelineSummary

  useEffect(() => {
    document.title = 'WW Character Creator'
  }, [])

  useEffect(() => {
    let isCancelled = false

    loadPersistedRichSession()
      .then((session) => {
        if (!session || isCancelled) {
          return
        }

        setPrompt((currentPrompt) => session.prompt || currentPrompt)
        setMultiviewPrompt(
          (currentMultiviewPrompt) =>
            session.multiviewPrompt || currentMultiviewPrompt || DEFAULT_MULTIVIEW_PROMPT,
        )
        setDevSettings((currentDevSettings) => ({
          portraitAspectRatio:
            session.devSettings?.portraitAspectRatio || currentDevSettings.portraitAspectRatio,
          portraitPromptPreset:
            session.devSettings?.portraitPromptPreset || currentDevSettings.portraitPromptPreset,
          spriteSize:
            Number(session.devSettings?.spriteSize) || currentDevSettings.spriteSize,
          tripoAnimationMode:
            session.devSettings?.tripoAnimationMode || currentDevSettings.tripoAnimationMode,
        }))
        setPortraitResult((currentPortraitResult) =>
          session.portraitResult?.imageDataUrl ? session.portraitResult : currentPortraitResult,
        )
        setMultiviewResult((currentMultiviewResult) =>
          session.multiviewResult?.views ? session.multiviewResult : currentMultiviewResult,
        )
        setSpriteResult((currentSpriteResult) =>
          session.spriteResult?.directions ? session.spriteResult : currentSpriteResult,
        )
        setCurrentRunId((currentRunIdValue) => session.currentRunId || currentRunIdValue)
        setHistory((currentHistory) =>
          Array.isArray(session.history) && session.history.length > 0 ? session.history : currentHistory,
        )
        setTripoJob((currentTripoJob) =>
          session.tripoJob?.taskId || session.tripoJob?.status !== 'idle' || session.tripoJob?.outputs
            ? {
                ...EMPTY_JOB,
                ...session.tripoJob,
                animationMode:
                  normalizeAnimationMode(session.tripoJob?.animationMode) ||
                  normalizeAnimationMode(session.devSettings?.tripoAnimationMode),
              }
            : currentTripoJob,
        )
      })
      .finally(() => {
        if (!isCancelled) {
          setHasHydratedPersistedSession(true)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [])

  useEffect(() => {
    if (!hasHydratedPersistedSession) {
      return
    }

    savePersistedSession({
      prompt,
      multiviewPrompt,
      devSettings,
      portraitResult,
      multiviewResult,
      spriteResult,
      currentRunId,
      history,
      tripoJob,
    })
  }, [
    currentRunId,
    devSettings,
    hasHydratedPersistedSession,
    history,
    multiviewPrompt,
    multiviewResult,
    spriteResult,
    portraitResult,
    prompt,
    tripoJob,
  ])

  useEffect(() => {
    setModelViewPack(null)
  }, [activeModelUrl])

  useEffect(() => {
    if (!tripoJob.taskId) {
      setModelPreviewMode('animated')
      return
    }

    setModelPreviewMode(tripoJob.animationMode === 'static' ? 'apose' : 'animated')
  }, [tripoJob.taskId])

  const handleViewerCaptureApiReady = useCallback((captureApi) => {
    viewerCaptureApiRef.current = captureApi || null
  }, [])

  const applyTripoJobUpdate = (nextJob, runId = currentRunId) => {
    setTripoJob((currentJob) => ({ ...currentJob, ...nextJob }))
    if (runId) {
      setHistory((currentHistory) =>
        updateHistoryEntry(currentHistory, runId, {
          tripoTaskId: nextJob.taskId,
          tripoStatus: nextJob.status,
          modelUrl: nextJob.outputs?.modelUrl || '',
        }),
      )
    }
  }

  const refreshTripoJob = async (taskId, animationMode = '') => {
    const nextJob = await getTripoTask(taskId, animationMode)

    return nextJob
  }

  useEffect(() => {
    if (!tripoJob.taskId || !['queued', 'running'].includes(tripoJob.status)) {
      return undefined
    }

    let isCancelled = false
    let isPolling = false

    const poll = async () => {
      if (isPolling || isCancelled) {
        return
      }

      isPolling = true

      try {
        const nextJob = await refreshTripoJob(
          tripoJob.taskId,
          tripoJob.animationMode || devSettings.tripoAnimationMode,
        )
        if (isCancelled) {
          return
        }

        applyTripoJobUpdate(nextJob, currentRunId)
      } catch (pollError) {
        if (!isCancelled) {
          setTripoJob((currentJob) => ({
            ...currentJob,
            status: 'failed',
            error: pollError.message,
          }))
        }
      } finally {
        isPolling = false
      }
    }

    const intervalId = window.setInterval(poll, 3000)

    return () => {
      isCancelled = true
      window.clearInterval(intervalId)
    }
  }, [currentRunId, devSettings.tripoAnimationMode, tripoJob.animationMode, tripoJob.taskId, tripoJob.status])

  const handleGeneratePortrait = async () => {
    if (!prompt.trim() && !referenceImage?.file) {
      setError('Add a prompt, a reference image, or both before generating a portrait.')
      return
    }

    setError('')
    setIsGeneratingPortrait(true)
    setMultiviewResult(null)
    setSpriteResult(null)
    setTripoJob(EMPTY_JOB)

    try {
      const result = await generatePortrait({
        prompt,
        referenceImage: referenceImage?.file || null,
        portraitAspectRatio: devSettings.portraitAspectRatio,
        portraitPromptPreset: devSettings.portraitPromptPreset,
      })
      const runId = createRunId()
      const nextPortrait = {
        imageDataUrl: result.imageDataUrl,
        modelUsed: result.modelUsed || '',
        promptUsed: result.promptUsed,
        inputMode: result.inputMode,
        originalReferenceImageDataUrl:
          result.normalizedReferenceImageDataUrl || referenceImage?.previewUrl || '',
      }

      setPortraitResult(nextPortrait)
      setCurrentRunId(runId)
      setHistory((currentHistory) => [
        createHistoryEntry({
          id: runId,
          prompt,
          inputMode: result.inputMode,
          portraitUrl: result.imageDataUrl,
        }),
        ...currentHistory,
      ])
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsGeneratingPortrait(false)
    }
  }

  const handleGenerateTurnaround = async (mode = 'full') => {
    if (!portraitResult?.imageDataUrl) {
      setError('Generate a portrait first to establish the character identity.')
      return
    }

    setError('')
    setTurnaroundGenerationMode(mode)
    setTripoJob(EMPTY_JOB)
    setSpriteResult(null)

    try {
      const result = await generateMultiview({
        portraitImageDataUrl: portraitResult.imageDataUrl,
        originalReferenceImageDataUrl: portraitResult.originalReferenceImageDataUrl || null,
        characterPrompt: prompt,
        multiviewPrompt,
        mode,
      })

      setMultiviewResult(result)
      if (currentRunId) {
        setHistory((currentHistory) =>
          updateHistoryEntry(currentHistory, currentRunId, {
            multiview: result.views,
          }),
        )
      }
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setTurnaroundGenerationMode('')
    }
  }

  const handleGenerateSpriteRun = async () => {
    if (!hasCompleteTurnaround(multiviewResult?.views)) {
      setError('Generate full multiview (front, back, left, right) before creating sprite run.')
      return
    }

    setError('')
    setIsGeneratingSprite(true)

    try {
      const result = await generateSpriteRun({
        views: {
          front: multiviewResult.views.front.imageDataUrl,
          back: multiviewResult.views.back.imageDataUrl,
          left: multiviewResult.views.left.imageDataUrl,
          right: multiviewResult.views.right.imageDataUrl,
        },
        spriteSize: Number(devSettings.spriteSize) || DEV_PRESETS.spriteSize,
      })

      setSpriteResult(result)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsGeneratingSprite(false)
    }
  }

  const handleCreateModel = async () => {
    if (!multiviewResult?.views) {
      setError('Generate the turnaround views before creating the 3D model.')
      return
    }

    setError('')
    setIsCreatingModel(true)

    try {
      const result = await createTripoTask({
        views: {
          front: multiviewResult.views.front.imageDataUrl,
          back: multiviewResult.views.back.imageDataUrl,
          left: multiviewResult.views.left.imageDataUrl,
          right: multiviewResult.views.right.imageDataUrl,
        },
        animationMode: devSettings.tripoAnimationMode,
      })
      setModelPreviewMode(devSettings.tripoAnimationMode === 'static' ? 'apose' : 'animated')

      setTripoJob({
        taskId: result.taskId,
        status: result.status,
        progress: 0,
        error: '',
        outputs: null,
        animationMode: devSettings.tripoAnimationMode,
      })

      if (currentRunId) {
        setHistory((currentHistory) =>
          updateHistoryEntry(currentHistory, currentRunId, {
            tripoTaskId: result.taskId,
            tripoStatus: result.status,
          }),
        )
      }
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsCreatingModel(false)
    }
  }

  const handleCreateFrontModel = async () => {
    const frontImageDataUrl = multiviewResult?.views?.front?.imageDataUrl

    if (!frontImageDataUrl) {
      setError('Generate a front view before creating a 3D model from it.')
      return
    }

    setError('')
    setIsCreatingFrontModel(true)

    try {
      const result = await createTripoFrontTask({
        imageDataUrl: frontImageDataUrl,
        animationMode: devSettings.tripoAnimationMode,
      })
      setModelPreviewMode(devSettings.tripoAnimationMode === 'static' ? 'apose' : 'animated')

      setTripoJob({
        taskId: result.taskId,
        status: result.status,
        progress: 0,
        error: '',
        outputs: null,
        animationMode: devSettings.tripoAnimationMode,
      })

      if (currentRunId) {
        setHistory((currentHistory) =>
          updateHistoryEntry(currentHistory, currentRunId, {
            tripoTaskId: result.taskId,
            tripoStatus: result.status,
          }),
        )
      }
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsCreatingFrontModel(false)
    }
  }

  const handleReset = () => {
    setPrompt('')
    setReferenceImage(null)
    setPortraitResult(null)
    setMultiviewPrompt(DEFAULT_MULTIVIEW_PROMPT)
    setMultiviewResult(null)
    setSpriteResult(null)
    setTripoJob(EMPTY_JOB)
    setCurrentRunId('')
    setError('')
    setTurnaroundGenerationMode('')
    setModelViewPack(null)
    setModelPreviewMode('animated')
    clearPersistedSession()
  }

  const handleCreateFrontBackModel = async () => {
    const frontImageDataUrl = multiviewResult?.views?.front?.imageDataUrl
    const backImageDataUrl = multiviewResult?.views?.back?.imageDataUrl

    if (!frontImageDataUrl || !backImageDataUrl) {
      setError('Generate front and back views before creating a 3D model from them.')
      return
    }

    setError('')
    setIsCreatingFrontBackModel(true)

    try {
      const result = await createTripoFrontBackTask({
        views: {
          front: frontImageDataUrl,
          back: backImageDataUrl,
        },
        animationMode: devSettings.tripoAnimationMode,
      })
      setModelPreviewMode(devSettings.tripoAnimationMode === 'static' ? 'apose' : 'animated')

      setTripoJob({
        taskId: result.taskId,
        status: result.status,
        progress: 0,
        error: '',
        outputs: null,
        animationMode: devSettings.tripoAnimationMode,
      })

      if (currentRunId) {
        setHistory((currentHistory) =>
          updateHistoryEntry(currentHistory, currentRunId, {
            tripoTaskId: result.taskId,
            tripoStatus: result.status,
          }),
        )
      }
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsCreatingFrontBackModel(false)
    }
  }

  const handleDownloadModel = async () => {
    if (!activeDownloadUrl) {
      return
    }

    await downloadFromUrl(activeDownloadUrl, `${tripoJob.taskId || 'ww-character'}.glb`)
  }

  const handleForcePullResult = async () => {
    if (!tripoJob.taskId) {
      return
    }

    setError('')
    setIsRefreshingTripoJob(true)

    try {
      const nextJob = await refreshTripoJob(
        tripoJob.taskId,
        tripoJob.animationMode || devSettings.tripoAnimationMode,
      )
      applyTripoJobUpdate(nextJob)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsRefreshingTripoJob(false)
    }
  }

  const handleResetView = () => {
    setViewerResetSignal((signal) => signal + 1)
  }

  const handleRestartServer = async () => {
    if (isRestartingServer) {
      return
    }

    setError('')
    setIsRestartingServer(true)

    try {
      await restartDevServer()
    } catch (requestError) {
      const message = String(requestError?.message || '')
      const canIgnoreRestartDrop = /network request failed|failed to fetch/i.test(message)

      if (!canIgnoreRestartDrop) {
        setError(requestError.message)
      }
    } finally {
      window.setTimeout(() => {
        setIsRestartingServer(false)
      }, 1200)
    }
  }

  const handleDownloadMultiview = async () => {
    const views = multiviewResult?.views

    if (!views) {
      setError('No multiview images available to download.')
      return
    }

    const readyViews = MULTIVIEW_ORDER
      .map((direction) => ({
        direction,
        dataUrl: views[direction]?.imageDataUrl || '',
      }))
      .filter((view) => Boolean(view.dataUrl))

    if (readyViews.length === 0) {
      setError('No multiview images available to download.')
      return
    }

    setError('')

    for (const view of readyViews) {
      const extension = getDataUrlFileExtension(view.dataUrl)
      const runSuffix = currentRunId || 'session'
      downloadDataUrl(view.dataUrl, `multiview-${runSuffix}-${view.direction}.${extension}`)
      await new Promise((resolve) => window.setTimeout(resolve, 120))
    }
  }

  const handleCaptureModelViews = async () => {
    const captureApi = viewerCaptureApiRef.current

    if (!captureApi?.captureEightViews) {
      setError('3D viewer is not ready for screenshot capture yet.')
      return
    }

    setError('')
    setIsCapturingModelViews(true)

    try {
      const captures = await captureApi.captureEightViews()
      setModelViewPack(captures)
    } catch (requestError) {
      setError(requestError?.message || 'Failed to capture model view screenshots.')
    } finally {
      setIsCapturingModelViews(false)
    }
  }

  const handleDownloadModelViews = async () => {
    if (!hasModelViewPack) {
      setError('Generate model screenshots first.')
      return
    }

    setError('')
    const runSuffix = currentRunId || tripoJob.taskId || 'session'

    for (const view of MODEL_VIEW_CAPTURE_ORDER) {
      const screenshot = modelViewPack?.[view.key]
      if (!screenshot?.dataUrl) {
        continue
      }

      downloadDataUrl(screenshot.dataUrl, `model-view-${runSuffix}-${view.label.toLowerCase()}.png`)
      await new Promise((resolve) => window.setTimeout(resolve, 120))
    }
  }

  return (
    <div className="page-shell">
      <div className="page-backdrop" aria-hidden="true" />
      <main className="workspace-shell">
        <header className="status-bar">
          <div className="status-bar__account">
            <span className="status-dot" aria-hidden="true" />
            <p className="status-bar__inline">
              <span className="status-bar__label">Session:</span> Local workspace
            </p>
          </div>
          <div className="status-bar__message">
            <p className="status-bar__inline">
              <span className="status-bar__label">Status:</span> {currentPipelineState}
            </p>
          </div>
          <div className="status-bar__metric">
            <p className="status-bar__inline">
              <span className="status-bar__label">Message:</span> {topBarMessage}
            </p>
          </div>
        </header>

        <section className="workspace-grid workspace-grid--skeleton">
          <div className="workspace-slot workspace-slot--prompt">
            <CharacterPromptForm
              prompt={prompt}
              onPromptChange={setPrompt}
              referenceImage={referenceImage}
              onReferenceImageChange={setReferenceImage}
              onGeneratePortrait={handleGeneratePortrait}
              onReset={handleReset}
              isGeneratingPortrait={isGeneratingPortrait}
              title="Prompt"
              stepLabel="Step 01"
            />
          </div>

          <section className="panel-card workspace-slot workspace-slot--portrait">
            <div className="panel-heading-shell">
              <div className="section-heading">
                <p className="step-label">Step 02</p>
                <h2>Portrait</h2>
              </div>
            </div>
            <PortraitReviewCard portraitResult={portraitResult} embedded square />
          </section>

          <section className="workspace-viewer">
            <div className="panel-heading-shell">
              <div className="section-heading">
                <p className="step-label">Step 05</p>
                <h2>3D Model</h2>
              </div>
            </div>

            <div className="workspace-viewer__viewport">
              {activeModelUrl ? (
                <Suspense
                  fallback={
                    <div className="viewer-placeholder">
                      <p>Loading viewer...</p>
                    </div>
                  }
                >
                  <ModelViewer
                    modelUrl={activeModelUrl}
                    resetSignal={viewerResetSignal}
                    onCaptureApiReady={handleViewerCaptureApiReady}
                  />
                </Suspense>
              ) : (
                <div className="viewer-placeholder">
                  <p>The textured GLB appears here after Tripo completes.</p>
                </div>
              )}
            </div>

            <TripoJobPanel
              embedded
              showMeta={false}
              showUtilityActions={false}
              job={tripoJob}
              canCreateModel={hasCompleteTurnaround(multiviewResult?.views)}
              canCreateFrontBackModel={Boolean(
                multiviewResult?.views?.front?.imageDataUrl &&
                  multiviewResult?.views?.back?.imageDataUrl,
              )}
              canCreateFrontModel={Boolean(multiviewResult?.views?.front?.imageDataUrl)}
              isCreatingModel={isCreatingModel}
              isCreatingFrontBackModel={isCreatingFrontBackModel}
              isCreatingFrontModel={isCreatingFrontModel}
              isRefreshingJob={isRefreshingTripoJob}
              onCreateModel={handleCreateModel}
              onCreateFrontBackModel={handleCreateFrontBackModel}
              onCreateFrontModel={handleCreateFrontModel}
              onForcePullResult={handleForcePullResult}
              onDownloadModel={handleDownloadModel}
              onResetView={handleResetView}
              hasViewer={Boolean(activeModelUrl)}
            />
          </section>

          <section className="panel-card workspace-slot workspace-slot--turnaround">
            <div className="panel-heading-shell">
              <div className="section-heading">
                <p className="step-label">Step 03</p>
                <h2>Multiview</h2>
              </div>
            </div>
            <MultiviewGrid
              views={multiviewResult?.views}
              mode={multiviewResult?.mode || 'full'}
              embedded
            />
          </section>

          <section className="panel-card workspace-slot workspace-slot--multiview">
            <div className="panel-heading-shell">
              <div className="section-heading">
                <p className="step-label">Step 04</p>
                <h2>Sprite</h2>
              </div>
            </div>
            <SpriteGrid directions={spriteResult?.directions} embedded />
          </section>
        </section>
      </main>
      <button
        type="button"
        className="dev-toggle"
        onClick={() => setIsDevPanelOpen((currentValue) => !currentValue)}
      >
        DEV
      </button>
      {isDevPanelOpen ? (
        <aside className="dev-panel" aria-label="Development presets">
          <div className="dev-panel__header">
            <strong>Presets</strong>
            <button type="button" className="text-button" onClick={() => setIsDevPanelOpen(false)}>
              Close
            </button>
          </div>
          <div className="dev-panel__list">
            <label className="dev-panel__field">
              <span>Portrait Ratio</span>
              <input
                type="text"
                value={devSettings.portraitAspectRatio}
                onChange={(event) =>
                  setDevSettings((currentValue) => ({
                    ...currentValue,
                    portraitAspectRatio: event.target.value,
                  }))
                }
              />
            </label>
            <label className="dev-panel__field">
              <span>Portrait Preset</span>
              <textarea
                rows={6}
                value={devSettings.portraitPromptPreset}
                onChange={(event) =>
                  setDevSettings((currentValue) => ({
                    ...currentValue,
                    portraitPromptPreset: event.target.value,
                  }))
                }
              />
            </label>
            <label className="dev-panel__field">
              <span>Multiview Preset</span>
              <textarea
                rows={5}
                value={multiviewPrompt}
                onChange={(event) => setMultiviewPrompt(event.target.value)}
              />
            </label>
            <label className="dev-panel__field">
              <span>Sprite Size</span>
              <select
                value={String(devSettings.spriteSize)}
                onChange={(event) =>
                  setDevSettings((currentValue) => ({
                    ...currentValue,
                    spriteSize: Number(event.target.value),
                  }))
                }
              >
                <option value="64">64x64</option>
                <option value="128">128x128</option>
              </select>
            </label>
            <label className="dev-panel__field">
              <span>Tripo Mode</span>
              <select
                value={devSettings.tripoAnimationMode}
                onChange={(event) =>
                  setDevSettings((currentValue) => ({
                    ...currentValue,
                    tripoAnimationMode: event.target.value,
                  }))
                }
              >
                <option value="animated">Animated</option>
                <option value="static">Static</option>
              </select>
            </label>
            <div className="action-row action-row--compact action-row--dev">
              <button
                type="button"
                className="secondary-button"
                onClick={() => handleGenerateTurnaround('front-only')}
                disabled={!portraitResult?.imageDataUrl || turnaroundGenerationMode !== ''}
              >
                {turnaroundGenerationMode === 'front-only'
                  ? 'Generating only front view...'
                  : 'Generate only front view'}
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => handleGenerateTurnaround('full')}
                disabled={!portraitResult?.imageDataUrl || turnaroundGenerationMode !== ''}
              >
                {turnaroundGenerationMode === 'full'
                  ? 'Generating multiview...'
                  : 'Generate Multiview'}
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={handleDownloadMultiview}
                disabled={!multiviewResult?.views?.front?.imageDataUrl}
              >
                Download Multiview
              </button>
            </div>
            <div className="action-row action-row--compact action-row--dev">
              <button
                type="button"
                className="primary-button"
                onClick={handleGenerateSpriteRun}
                disabled={!hasCompleteTurnaround(multiviewResult?.views) || isGeneratingSprite}
              >
                {isGeneratingSprite ? 'Generating sprite run...' : 'Generate Sprite Run'}
              </button>
            </div>
            <div className="dev-panel__field">
              <span>Gemini</span>
              <div className="dev-panel__status">
                <strong>Model Usage</strong>
                <p>Portrait: {formatModelLabel(portraitResult?.modelUsed)}</p>
                <p>Front: {formatModelLabel(multiviewResult?.modelUsage?.front)}</p>
                <p>Back: {formatModelLabel(multiviewResult?.modelUsage?.back)}</p>
                <p>Left: {formatModelLabel(multiviewResult?.modelUsage?.left)}</p>
                <p>Right: {formatModelLabel(multiviewResult?.modelUsage?.right)}</p>
              </div>
            </div>
            <div className="dev-panel__field">
              <span>Tripo</span>
              <div className="dev-panel__status">
                <strong>Task Controls</strong>
                <p>{activeModelUrl ? 'Preview ready' : 'Preview unavailable'}</p>
                <p>Output mode: {devSettings.tripoAnimationMode === 'animated' ? 'Animated' : 'Static'}</p>
                <p>Preview pose: {modelPreviewMode === 'apose' ? 'A-pose' : 'Animated'}</p>
                <p>
                  Preview variant:{' '}
                  {resolvedModelVariant
                    ? formatModelOutputVariantLabel(resolvedModelVariant)
                    : 'Unavailable'}
                </p>
                <p>Animated file: {animatedModelVariant ? 'available' : 'unavailable'}</p>
                <p>A-pose file: {aposeModelVariant ? 'available' : 'unavailable'}</p>
                {isPreviewModeUnavailable ? (
                  <p>Requested pose is unavailable for this task. Showing fallback preview.</p>
                ) : null}
                <p>Status: {tripoJob.status}</p>
                <p>
                  {tripoJob.taskId
                    ? `Task ${tripoJob.taskId}${tripoJob.progress ? ` - ${tripoJob.progress}%` : ''}`
                    : 'No Tripo job has started yet.'}
                </p>
                {tripoJob.error ? <p className="error-copy">{tripoJob.error}</p> : null}
              </div>
              <label className="dev-panel__field">
                <span>Preview Pose</span>
                <select
                  value={modelPreviewMode}
                  onChange={(event) => setModelPreviewMode(event.target.value)}
                >
                  <option value="animated">Animated</option>
                  <option value="apose">A-pose</option>
                </select>
              </label>
              <div className="action-row action-row--compact action-row--dev">
                <button
                  type="button"
                  className="ghost-button"
                  disabled={!tripoJob.taskId || isRefreshingTripoJob}
                  onClick={handleForcePullResult}
                >
                  {isRefreshingTripoJob ? 'Pulling Result...' : 'Force Pull Result'}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!activeDownloadUrl}
                  onClick={handleDownloadModel}
                >
                  Download GLB
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={!activeModelUrl}
                  onClick={handleResetView}
                >
                  Reset View
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={isRestartingServer}
                  onClick={handleRestartServer}
                >
                  {isRestartingServer ? 'Restarting Server...' : 'Restart Server'}
                </button>
              </div>
            </div>
            <div className="dev-panel__field">
              <span>Model Views</span>
              <div className="action-row action-row--compact action-row--dev">
                <button
                  type="button"
                  className="primary-button"
                  onClick={handleCaptureModelViews}
                  disabled={!activeModelUrl || isCapturingModelViews}
                >
                  {isCapturingModelViews ? 'Capturing 8 views...' : 'Capture 8 Views'}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={handleDownloadModelViews}
                  disabled={!hasModelViewPack}
                >
                  Download 8 Views
                </button>
              </div>
              {hasModelViewPack ? (
                <div className="dev-viewpack-grid">
                  {MODEL_VIEW_CAPTURE_ORDER.map((view) => {
                    const screenshot = modelViewPack?.[view.key]
                    if (!screenshot?.dataUrl) {
                      return null
                    }

                    return (
                      <div key={view.key} className="dev-viewpack-item">
                        <img src={screenshot.dataUrl} alt={`${view.label} model screenshot`} />
                        <p>{view.label}</p>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="dev-panel__status">
                  <p>No model screenshots captured yet.</p>
                </div>
              )}
            </div>
          </div>
        </aside>
      ) : null}
    </div>
  )
}

export default App

