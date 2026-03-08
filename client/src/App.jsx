import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import JSZip from 'jszip'
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
} from './api/characterApi'
import { DEFAULT_MULTIVIEW_PROMPT } from './constants/prompts'
import { CharacterPromptForm } from './components/CharacterPromptForm'
import { HistoryPanel } from './components/HistoryPanel'
import { MultiviewGrid } from './components/MultiviewGrid'
import { MultiviewPromptEditor } from './components/MultiviewPromptEditor'
import { PortraitReviewCard } from './components/PortraitReviewCard'
import { SpriteGrid } from './components/SpriteGrid'
import { downloadBlob, downloadDataUrl, downloadFromUrl } from './lib/download'
import { createHistoryEntry, createRunId, updateHistoryEntry } from './lib/historyStore'
import {
  loadPersistedSession,
  loadPersistedRichSession,
  savePersistedSession,
} from './lib/persistedSession'

const EMPTY_JOB = {
  taskId: '',
  taskType: '',
  sourceTaskId: '',
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
  tripoRetargetAnimationName: '',
  tripoMeshQuality: 'standard',
  tripoTextureQuality: 'standard',
  defaultSpritesEnabled: false,
}

const MULTIVIEW_ORDER = ['front', 'back', 'left', 'right']
const MODEL_VIEW_CAPTURE_ORDER = [
  { key: 'front', label: 'Front' },
  { key: 'front_right', label: 'Front_Right' },
  { key: 'right', label: 'Right' },
  { key: 'back_right', label: 'Back_Right' },
  { key: 'back', label: 'Back' },
  { key: 'back_left', label: 'Back_Left' },
  { key: 'left', label: 'Left' },
  { key: 'front_left', label: 'Front_Left' },
]
const MODEL_VIEW_CAPTURE_SIZE = 128
const MODEL_VIEW_CROP_MARGIN_RATIO = 0.06
const MODEL_VIEW_ALPHA_THRESHOLD = 1
const MODEL_VIEW_PIXEL_ART_MODE = true
const VALID_SPRITE_SIZES = new Set([64, 84, 128])
const TRIPO_QUALITY_LABELS = {
  standard: 'Standard',
  detailed: 'Ultra',
}
const TRIPO_QUALITY_VALUES = new Set(Object.keys(TRIPO_QUALITY_LABELS))
const GIF_TRANSPARENT_HEX = 0xff00ff
const GIF_TRANSPARENT_CSS = '#ff00ff'
const GIF_TRANSPARENT_RGB = { r: 255, g: 0, b: 255 }
const GIF_ALPHA_CUTOFF = 8
const DEFAULT_SPRITE_FILES = {
  view_360: '/default-sprites/360.gif',
  front: '/default-sprites/front.gif',
  front_right: '/default-sprites/front_right.gif',
  right: '/default-sprites/right.gif',
  back_right: '/default-sprites/back_right.gif',
  back: '/default-sprites/back.gif',
  back_left: '/default-sprites/back_left.gif',
  left: '/default-sprites/left.gif',
  front_left: '/default-sprites/front_left.gif',
}

const appendCacheBust = (url, cacheKey) => {
  if (!cacheKey) {
    return url
  }

  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}v=${cacheKey}`
}

const buildDefaultSpriteDirections = (cacheKey) =>
  Object.fromEntries(
    Object.entries(DEFAULT_SPRITE_FILES).map(([direction, fileUrl]) => {
      const resolvedUrl = appendCacheBust(fileUrl, cacheKey)

      return [
        direction,
        {
          previewDataUrl: resolvedUrl,
          frameDataUrls: [resolvedUrl],
          source: 'default-sprite-pack',
        },
      ]
    }),
  )

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

const dataUrlToBase64Payload = (dataUrl) => {
  const match = String(dataUrl || '').match(/^data:[^;]+;base64,(.+)$/)
  return match?.[1] || ''
}

const loadImageFromDataUrl = (dataUrl) =>
  new Promise((resolve, reject) => {
    const image = new Image()

    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to decode screenshot image.'))
    image.src = dataUrl
  })

const buildCanvasFromImage = (image) => {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth || image.width
  canvas.height = image.naturalHeight || image.height
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('2D canvas context is unavailable for screenshot scaling.')
  }

  context.clearRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  return { canvas, context }
}

const getOpaquePixelBounds = (context, width, height) => {
  const pixelData = context.getImageData(0, 0, width, height).data
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = (y * width + x) * 4
      if (pixelData[pixelIndex + 3] < MODEL_VIEW_ALPHA_THRESHOLD) {
        continue
      }

      if (x < minX) {
        minX = x
      }
      if (y < minY) {
        minY = y
      }
      if (x > maxX) {
        maxX = x
      }
      if (y > maxY) {
        maxY = y
      }
    }
  }

  return maxX >= minX && maxY >= minY
    ? { minX, minY, maxX, maxY }
    : null
}

const mergeOpaqueBounds = (currentBounds, nextBounds) => {
  if (!currentBounds) {
    return nextBounds
  }

  if (!nextBounds) {
    return currentBounds
  }

  return {
    minX: Math.min(currentBounds.minX, nextBounds.minX),
    minY: Math.min(currentBounds.minY, nextBounds.minY),
    maxX: Math.max(currentBounds.maxX, nextBounds.maxX),
    maxY: Math.max(currentBounds.maxY, nextBounds.maxY),
  }
}

const expandOpaqueBounds = (bounds, width, height) => {
  const safeBounds = bounds || {
    minX: 0,
    minY: 0,
    maxX: Math.max(width - 1, 0),
    maxY: Math.max(height - 1, 0),
  }
  const cropWidth = Math.max(1, safeBounds.maxX - safeBounds.minX + 1)
  const cropHeight = Math.max(1, safeBounds.maxY - safeBounds.minY + 1)
  const cropMargin = Math.max(
    Math.round(Math.max(cropWidth, cropHeight) * MODEL_VIEW_CROP_MARGIN_RATIO),
    1,
  )
  const expandedX = Math.max(0, safeBounds.minX - cropMargin)
  const expandedY = Math.max(0, safeBounds.minY - cropMargin)
  const expandedRight = Math.min(width, safeBounds.maxX + 1 + cropMargin)
  const expandedBottom = Math.min(height, safeBounds.maxY + 1 + cropMargin)

  return {
    x: expandedX,
    y: expandedY,
    width: Math.max(1, expandedRight - expandedX),
    height: Math.max(1, expandedBottom - expandedY),
  }
}

const resizeFrameSequenceForModelView = async (
  frameDataUrls,
  size = MODEL_VIEW_CAPTURE_SIZE,
) => {
  const validFrameDataUrls = Array.isArray(frameDataUrls)
    ? frameDataUrls.filter((frameDataUrl) => Boolean(frameDataUrl))
    : []

  if (validFrameDataUrls.length === 0) {
    return []
  }

  const loadedFrames = await Promise.all(
    validFrameDataUrls.map(async (frameDataUrl) => {
      const image = await loadImageFromDataUrl(frameDataUrl)
      const { canvas, context } = buildCanvasFromImage(image)
      return {
        canvas,
        bounds: getOpaquePixelBounds(context, canvas.width, canvas.height),
      }
    }),
  )

  const baseWidth = loadedFrames[0]?.canvas.width || size
  const baseHeight = loadedFrames[0]?.canvas.height || size
  const mergedBounds = loadedFrames.reduce(
    (currentBounds, frame) => mergeOpaqueBounds(currentBounds, frame.bounds),
    null,
  )
  const cropBounds = expandOpaqueBounds(mergedBounds, baseWidth, baseHeight)
  const scale = Math.min(size / cropBounds.width, size / cropBounds.height)
  const drawWidth = Math.max(1, Math.round(cropBounds.width * scale))
  const drawHeight = Math.max(1, Math.round(cropBounds.height * scale))
  const drawX = Math.round((size - drawWidth) * 0.5)
  const drawY = Math.round((size - drawHeight) * 0.5)

  return loadedFrames.map((frame) => {
    const outputCanvas = document.createElement('canvas')
    outputCanvas.width = size
    outputCanvas.height = size
    const outputContext = outputCanvas.getContext('2d')

    if (!outputContext) {
      throw new Error('2D canvas context is unavailable for screenshot scaling.')
    }

    outputContext.clearRect(0, 0, size, size)
    outputContext.imageSmoothingEnabled = !MODEL_VIEW_PIXEL_ART_MODE
    outputContext.drawImage(
      frame.canvas,
      cropBounds.x,
      cropBounds.y,
      cropBounds.width,
      cropBounds.height,
      drawX,
      drawY,
      drawWidth,
      drawHeight,
    )

    return outputCanvas.toDataURL('image/png')
  })
}

const resizeDataUrlForModelView = async (dataUrl, size = MODEL_VIEW_CAPTURE_SIZE) => {
  const resizedFrames = await resizeFrameSequenceForModelView([dataUrl], size)
  return resizedFrames[0] || ''
}

const formatModelLabel = (value) => {
  const trimmed = String(value || '').trim()
  return trimmed || 'Not generated yet.'
}

const getAnimationModeForTaskType = (taskType) => {
  const normalizedTaskType = String(taskType || '').trim().toLowerCase()
  return normalizedTaskType === 'animate_retarget' || normalizedTaskType === 'animate_model'
    ? 'animated'
    : 'static'
}

const formatTripoTaskTypeLabel = (value) => {
  const normalizedValue = String(value || '').trim()

  if (!normalizedValue) {
    return 'Not started'
  }

  return normalizedValue.replace(/_/g, ' ')
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

const normalizeSpriteSize = (value) => {
  const numericValue = Number(value)
  return VALID_SPRITE_SIZES.has(numericValue) ? numericValue : DEV_PRESETS.spriteSize
}

const normalizeAnimationMode = (value) => {
  const normalizedValue = String(value || '').trim().toLowerCase()
  return normalizedValue === 'animated' || normalizedValue === 'static' ? normalizedValue : ''
}

const normalizeTripoQuality = (value, fallback = DEV_PRESETS.tripoMeshQuality) => {
  const normalizedValue = String(value || '').trim().toLowerCase()
  return TRIPO_QUALITY_VALUES.has(normalizedValue) ? normalizedValue : fallback
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
    tripoRetargetAnimationName:
      initialSession?.devSettings?.tripoRetargetAnimationName || DEV_PRESETS.tripoRetargetAnimationName,
    tripoMeshQuality: normalizeTripoQuality(
      initialSession?.devSettings?.tripoMeshQuality,
      DEV_PRESETS.tripoMeshQuality,
    ),
    tripoTextureQuality: normalizeTripoQuality(
      initialSession?.devSettings?.tripoTextureQuality,
      DEV_PRESETS.tripoTextureQuality,
    ),
    defaultSpritesEnabled:
      typeof initialSession?.devSettings?.defaultSpritesEnabled === 'boolean'
        ? initialSession.devSettings.defaultSpritesEnabled
        : DEV_PRESETS.defaultSpritesEnabled,
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
  const [isCreatingRigTask, setIsCreatingRigTask] = useState(false)
  const [isCreatingRetargetTask, setIsCreatingRetargetTask] = useState(false)
  const [isGeneratingSprite, setIsGeneratingSprite] = useState(false)
  const [isRefreshingTripoJob, setIsRefreshingTripoJob] = useState(false)
  const [isLoadingExistingTripoTask, setIsLoadingExistingTripoTask] = useState(false)
  const [isRestartingServer, setIsRestartingServer] = useState(false)
  const [hasHydratedPersistedSession, setHasHydratedPersistedSession] = useState(false)
  const [viewerResetSignal, setViewerResetSignal] = useState(0)
  const [isDevPanelOpen, setIsDevPanelOpen] = useState(false)
  const [modelViewPack, setModelViewPack] = useState(null)
  const [isCapturingModelViews, setIsCapturingModelViews] = useState(false)
  const [isCapturingWalkSprites, setIsCapturingWalkSprites] = useState(false)
  const [isBuildingModelViewGif, setIsBuildingModelViewGif] = useState(false)
  const [modelPreviewMode, setModelPreviewMode] = useState('animated')
  const [defaultSpritesCacheKey, setDefaultSpritesCacheKey] = useState(() => Date.now())
  const [existingTripoTaskIdInput, setExistingTripoTaskIdInput] = useState('')
  const [healthVersions, setHealthVersions] = useState(() => ({
    tripoModelVersion: '',
    tripoRigModelVersion: '',
  }))
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
  const activeSpriteDirections = devSettings.defaultSpritesEnabled
    ? buildDefaultSpriteDirections(defaultSpritesCacheKey)
    : spriteResult?.directions
  const retargetStartTaskId =
    tripoJob.taskType === 'animate_rig'
      ? tripoJob.taskId
      : ['animate_retarget', 'animate_model'].includes(tripoJob.taskType)
        ? tripoJob.taskId
        : ''
  const canCreateModel = hasCompleteTurnaround(multiviewResult?.views)
  const canCreateFrontBackModel = Boolean(
    multiviewResult?.views?.front?.imageDataUrl && multiviewResult?.views?.back?.imageDataUrl,
  )
  const canCreateFrontModel = Boolean(multiviewResult?.views?.front?.imageDataUrl)
  const canAcceptPortrait = Boolean(portraitResult?.imageDataUrl && turnaroundGenerationMode === '')
  const canAnimateRig = Boolean(
    tripoJob.taskId &&
      tripoJob.status === 'success' &&
      ['multiview_to_model', 'image_to_model'].includes(tripoJob.taskType),
  )
  const canAnimateRetarget = Boolean(retargetStartTaskId && tripoJob.status === 'success')

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
          : isCapturingWalkSprites
            ? 'Capturing walk sprites'
          : isCreatingModel
            ? 'Submitting multiview model'
            : isCreatingFrontBackModel
              ? 'Submitting front-back model'
              : isCreatingFrontModel
                ? 'Submitting front-view model'
                : isCreatingRigTask
                  ? 'Submitting rig task'
                  : isCreatingRetargetTask
                    ? 'Submitting retarget task'
                  : isRefreshingTripoJob
                    ? 'Refreshing Tripo result'
                    : tripoJob.status === 'success'
                      ? '3D model ready'
                    : tripoJob.status === 'running'
                      ? tripoJob.taskType === 'animate_rig'
                        ? 'Tripo is rigging the model'
                        : tripoJob.taskType === 'animate_retarget'
                          ? 'Tripo is applying animation'
                          : 'Tripo is building the model'
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

    getHealth()
      .then((response) => {
        if (isCancelled) {
          return
        }

        setHealthVersions({
          tripoModelVersion: response?.versions?.tripoModelVersion || '',
          tripoRigModelVersion: response?.versions?.tripoRigModelVersion || '',
        })
      })
      .catch(() => {
        // Health metadata is optional for UI diagnostics.
      })

    return () => {
      isCancelled = true
    }
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
          tripoRetargetAnimationName:
            session.devSettings?.tripoRetargetAnimationName ??
            currentDevSettings.tripoRetargetAnimationName,
          tripoMeshQuality: normalizeTripoQuality(
            session.devSettings?.tripoMeshQuality,
            currentDevSettings.tripoMeshQuality,
          ),
          tripoTextureQuality: normalizeTripoQuality(
            session.devSettings?.tripoTextureQuality,
            currentDevSettings.tripoTextureQuality,
          ),
          defaultSpritesEnabled:
            typeof session.devSettings?.defaultSpritesEnabled === 'boolean'
              ? session.devSettings.defaultSpritesEnabled
              : currentDevSettings.defaultSpritesEnabled,
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

    setModelPreviewMode(
      tripoJob.taskType === 'animate_retarget' || tripoJob.taskType === 'animate_model'
        ? 'animated'
        : 'apose',
    )
  }, [tripoJob.taskId, tripoJob.taskType])

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

  const applyTripoTaskStart = (
    result,
    { animationMode = '', fallbackTaskType = '', fallbackSourceTaskId = '' } = {},
  ) => {
    setTripoJob({
      taskId: result.taskId,
      taskType: result.taskType || fallbackTaskType,
      sourceTaskId: result.sourceTaskId || fallbackSourceTaskId,
      status: result.status || 'queued',
      progress: Number.isFinite(result.progress) ? result.progress : 0,
      error: result.error || '',
      outputs: null,
      animationMode,
    })

    if (currentRunId) {
      setHistory((currentHistory) =>
        updateHistoryEntry(currentHistory, currentRunId, {
          tripoTaskId: result.taskId,
          tripoStatus: result.status || 'queued',
        }),
      )
    }
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

  const runMultiviewGeneration = async ({
    mode = 'full',
    portraitSource = portraitResult,
    runIdForHistory = currentRunId,
  } = {}) => {
    if (!portraitSource?.imageDataUrl) {
      setError('Generate a portrait first to establish the character identity.')
      return null
    }

    setError('')
    setTurnaroundGenerationMode(mode)
    setTripoJob(EMPTY_JOB)
    setSpriteResult(null)

    try {
      const result = await generateMultiview({
        portraitImageDataUrl: portraitSource.imageDataUrl,
        originalReferenceImageDataUrl: portraitSource.originalReferenceImageDataUrl || null,
        characterPrompt: prompt,
        multiviewPrompt,
        mode,
      })

      setMultiviewResult(result)
      if (runIdForHistory) {
        setHistory((currentHistory) =>
          updateHistoryEntry(currentHistory, runIdForHistory, {
            multiview: result.views,
          }),
        )
      }
      return result
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setTurnaroundGenerationMode('')
    }
  }

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
      setIsGeneratingPortrait(false)
      return
    }

    setIsGeneratingPortrait(false)
  }

  const handleAcceptPortrait = async () => {
    await runMultiviewGeneration({
      mode: 'full',
      portraitSource: portraitResult,
      runIdForHistory: currentRunId,
    })
  }

  const handleGenerateTurnaround = async (mode = 'full') => {
    await runMultiviewGeneration({
      mode,
      portraitSource: portraitResult,
      runIdForHistory: currentRunId,
    })
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

  const handleCaptureWalkSprites = async () => {
    const captureApi = viewerCaptureApiRef.current

    if (!captureApi?.captureAnimatedSpriteDirections) {
      setError('3D viewer is not ready for animated sprite capture yet.')
      return
    }

    if (!activeModelUrl) {
      setError('Load an animated model before capturing walk sprites.')
      return
    }

    setError('')
    setIsCapturingWalkSprites(true)
    const captureSize = normalizeSpriteSize(devSettings.spriteSize)

    try {
      const capturedDirections = await captureApi.captureAnimatedSpriteDirections()
      const resizedEntries = await Promise.all(
        MODEL_VIEW_CAPTURE_ORDER.map(async (view) => {
          const directionCapture = capturedDirections?.[view.key]
          if (!directionCapture?.frameDataUrls?.length) {
            return [view.key, null]
          }

          const resizedFrames = await resizeFrameSequenceForModelView(
            directionCapture.frameDataUrls,
            captureSize,
          )

          return [
            view.key,
            {
              previewDataUrl: resizedFrames[0] || '',
              frameDataUrls: resizedFrames,
              delayMs: directionCapture.delayMs,
              source: 'viewer-walk-capture',
              frames: {
                count: resizedFrames.length,
                format: 'base64-frame-sequence',
              },
            },
          ]
        }),
      )

      const nextDirections = Object.fromEntries(
        resizedEntries.filter((entry) => Boolean(entry[1])),
      )
      const fallback360Direction =
        activeSpriteDirections?.view_360 || buildDefaultSpriteDirections(defaultSpritesCacheKey).view_360

      setDevSettings((currentValue) => ({
        ...currentValue,
        defaultSpritesEnabled: false,
      }))
      setSpriteResult({
        animation: 'walk',
        spriteSize: captureSize,
        directions: {
          ...(fallback360Direction ? { view_360: fallback360Direction } : {}),
          ...nextDirections,
        },
      })
    } catch (requestError) {
      setError(requestError?.message || 'Failed to capture animated walk sprites.')
    } finally {
      setIsCapturingWalkSprites(false)
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
        meshQuality: devSettings.tripoMeshQuality,
        textureQuality: devSettings.tripoTextureQuality,
      })
      setModelPreviewMode('apose')
      applyTripoTaskStart(result, {
        animationMode: 'static',
        fallbackTaskType: 'multiview_to_model',
      })
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
        meshQuality: devSettings.tripoMeshQuality,
        textureQuality: devSettings.tripoTextureQuality,
      })
      setModelPreviewMode('apose')
      applyTripoTaskStart(result, {
        animationMode: 'static',
        fallbackTaskType: 'image_to_model',
      })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsCreatingFrontModel(false)
    }
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
        meshQuality: devSettings.tripoMeshQuality,
        textureQuality: devSettings.tripoTextureQuality,
      })
      setModelPreviewMode('apose')
      applyTripoTaskStart(result, {
        animationMode: 'static',
        fallbackTaskType: 'multiview_to_model',
      })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsCreatingFrontBackModel(false)
    }
  }

  const handleAnimateRig = async () => {
    if (!tripoJob.taskId) {
      setError('Create a mesh task before starting rigging.')
      return
    }

    setError('')
    setIsCreatingRigTask(true)

    try {
      const result = await createTripoRigTask(tripoJob.taskId)
      setModelPreviewMode('apose')
      applyTripoTaskStart(result, {
        animationMode: 'static',
        fallbackTaskType: 'animate_rig',
        fallbackSourceTaskId: tripoJob.taskId,
      })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsCreatingRigTask(false)
    }
  }

  const handleAnimateRetarget = async () => {
    if (!retargetStartTaskId) {
      setError('Load a successful rig or animation task before starting retarget.')
      return
    }

    setError('')
    setIsCreatingRetargetTask(true)

    try {
      const result = await createTripoRetargetTask(retargetStartTaskId, {
        animationName: String(devSettings.tripoRetargetAnimationName || '').trim(),
      })
      setModelPreviewMode('animated')
      applyTripoTaskStart(result, {
        animationMode: 'animated',
        fallbackTaskType: 'animate_retarget',
        fallbackSourceTaskId:
          tripoJob.taskType === 'animate_rig' ? tripoJob.taskId : tripoJob.sourceTaskId || '',
      })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsCreatingRetargetTask(false)
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

  const handleLoadExistingTripoTask = async () => {
    const trimmedTaskId = String(existingTripoTaskIdInput || '').trim()

    if (!trimmedTaskId) {
      setError('Enter a Tripo task ID to load an existing result.')
      return
    }

    setError('')
    setIsLoadingExistingTripoTask(true)

    try {
      const nextJob = await refreshTripoJob(trimmedTaskId, 'static')
      const nextAnimationMode = getAnimationModeForTaskType(nextJob.taskType)
      setExistingTripoTaskIdInput(trimmedTaskId)
      setTripoJob({
        ...EMPTY_JOB,
        ...nextJob,
        taskId: nextJob.taskId || trimmedTaskId,
        animationMode: nextAnimationMode,
      })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsLoadingExistingTripoTask(false)
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
    const captureSize = normalizeSpriteSize(devSettings.spriteSize)

    try {
      const captures = await captureApi.captureEightViews()
      const resizedEntries = await Promise.all(
        MODEL_VIEW_CAPTURE_ORDER.map(async (view) => {
          const screenshot = captures?.[view.key]
          if (!screenshot?.dataUrl) {
            return [view.key, null]
          }

          const resizedDataUrl = await resizeDataUrlForModelView(screenshot.dataUrl, captureSize)
          return [
            view.key,
            {
              ...screenshot,
              label: view.label,
              dataUrl: resizedDataUrl,
              width: captureSize,
              height: captureSize,
            },
          ]
        }),
      )

      const resizedCapturePack = Object.fromEntries(
        resizedEntries.filter((entry) => Boolean(entry[1])),
      )
      setModelViewPack(resizedCapturePack)
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
    const zip = new JSZip()
    let filesCount = 0

    for (const view of MODEL_VIEW_CAPTURE_ORDER) {
      const screenshot = modelViewPack?.[view.key]
      if (!screenshot?.dataUrl) {
        continue
      }

      const base64Payload = dataUrlToBase64Payload(screenshot.dataUrl)
      if (!base64Payload) {
        continue
      }

      zip.file(`${view.key}.png`, base64Payload, { base64: true })
      filesCount += 1
    }

    if (filesCount === 0) {
      setError('No model screenshots available to add to zip.')
      return
    }

    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })
    downloadBlob(zipBlob, `model-views-${runSuffix}.zip`)
  }

  const handleDownloadModelViewsGif = async () => {
    if (!hasModelViewPack) {
      setError('Generate model screenshots first.')
      return
    }

    setError('')
    setIsBuildingModelViewGif(true)

    try {
      const captureSize = normalizeSpriteSize(devSettings.spriteSize)
      const orderedFrames = MODEL_VIEW_CAPTURE_ORDER
        .map((view) => modelViewPack?.[view.key]?.dataUrl || '')
        .filter(Boolean)

      if (orderedFrames.length === 0) {
        setError('No model screenshots available to create GIF.')
        return
      }

      const [{ default: GIF }, { default: workerScript }] = await Promise.all([
        import('gif.js'),
        import('gif.js/dist/gif.worker.js?url'),
      ])
      const gif = new GIF({
        workers: 2,
        quality: 10,
        width: captureSize,
        height: captureSize,
        background: GIF_TRANSPARENT_CSS,
        transparent: GIF_TRANSPARENT_HEX,
        workerScript,
      })
      const frameCanvas = document.createElement('canvas')
      frameCanvas.width = captureSize
      frameCanvas.height = captureSize
      const frameContext = frameCanvas.getContext('2d')

      if (!frameContext) {
        throw new Error('2D canvas context is unavailable for GIF generation.')
      }

      for (const frameDataUrl of orderedFrames) {
        const frameImage = await loadImageFromDataUrl(frameDataUrl)
        frameContext.clearRect(0, 0, captureSize, captureSize)
        frameContext.imageSmoothingEnabled = !MODEL_VIEW_PIXEL_ART_MODE
        frameContext.drawImage(frameImage, 0, 0, captureSize, captureSize)
        const frameImageData = frameContext.getImageData(0, 0, captureSize, captureSize)
        const framePixels = frameImageData.data

        for (let pixelIndex = 0; pixelIndex < framePixels.length; pixelIndex += 4) {
          const alpha = framePixels[pixelIndex + 3]
          if (alpha <= GIF_ALPHA_CUTOFF) {
            framePixels[pixelIndex] = GIF_TRANSPARENT_RGB.r
            framePixels[pixelIndex + 1] = GIF_TRANSPARENT_RGB.g
            framePixels[pixelIndex + 2] = GIF_TRANSPARENT_RGB.b
          }
          framePixels[pixelIndex + 3] = 255
        }

        gif.addFrame(frameImageData, {
          delay: 140,
        })
      }

      const gifBlob = await new Promise((resolve) => {
        gif.on('finished', (blob) => resolve(blob))
        gif.render()
      })
      const runSuffix = currentRunId || tripoJob.taskId || 'session'
      downloadBlob(gifBlob, `model-views-${runSuffix}.gif`)
    } catch (requestError) {
      setError(requestError?.message || 'Failed to generate model views GIF.')
    } finally {
      setIsBuildingModelViewGif(false)
    }
  }

  const handleToggleDefaultSprites = () => {
    setDefaultSpritesCacheKey(Date.now())
    setDevSettings((currentValue) => ({
      ...currentValue,
      defaultSpritesEnabled: !currentValue.defaultSpritesEnabled,
    }))
  }

  const handleRefreshDefaultSprites = () => {
    setDefaultSpritesCacheKey(Date.now())
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

        <section className="workspace-grid workspace-grid--screenshot">
          <section
            className="panel-card workspace-slot workspace-slot--portrait workspace-portrait"
            aria-label="Step 01 Portrait Panel"
          >
            <div className="panel-heading-shell">
              <div className="section-heading">
                <p className="step-label">Step 01</p>
                <h2>Portrait</h2>
              </div>
            </div>
            <PortraitReviewCard portraitResult={portraitResult} embedded />
            <div className="workspace-portrait__prompt">
              <CharacterPromptForm
                embedded
                prompt={prompt}
                onPromptChange={setPrompt}
                referenceImage={referenceImage}
                onReferenceImageChange={setReferenceImage}
                onGeneratePortrait={handleGeneratePortrait}
                onAccept={handleAcceptPortrait}
                isGeneratingPortrait={isGeneratingPortrait}
                isAcceptDisabled={!canAcceptPortrait}
              />
            </div>
          </section>

          <section className="panel-card workspace-stage" aria-label="Center Stage Panel">
            <section className="workspace-stage__multiview" aria-label="Step 02 Multiview Panel">
              <div className="panel-heading-shell">
                <div className="section-heading">
                  <p className="step-label">Step 02</p>
                  <h2>Multiview</h2>
                </div>
              </div>
              <div className="workspace-stage__multiview-body">
                <MultiviewGrid
                  views={multiviewResult?.views}
                  mode={multiviewResult?.mode || 'full'}
                  embedded
                />
              </div>
              <div className="action-row action-row--compact">
                <button
                  type="button"
                  className="primary-button"
                  disabled={!canCreateModel || isCreatingModel}
                  onClick={handleCreateModel}
                >
                  {isCreatingModel ? 'Generating 2D...' : 'Generate 2D'}
                </button>
                <button
                  type="button"
                  className="accept-button accept-button--icon-only"
                  disabled={!canCreateFrontBackModel || isCreatingFrontBackModel}
                  onClick={handleCreateFrontBackModel}
                  aria-label={isCreatingFrontBackModel ? 'Accepting Multiview' : 'Accept Multiview'}
                >
                  <span className="accept-button__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M6.5 12.5 10.5 16.5 18 8.8"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </button>
              </div>
            </section>

            <section className="workspace-stage__model" aria-label="Step 03 3D Model Panel">
              <div className="panel-heading-shell">
                <div className="section-heading">
                  <p className="step-label">Step 03</p>
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
              <div className="action-row action-row--compact">
                <button
                  type="button"
                  className="primary-button"
                  disabled={!canCreateModel || isCreatingModel}
                  onClick={handleCreateModel}
                >
                  {isCreatingModel ? 'Generating 3D...' : 'Generate 3D'}
                </button>
                <button
                  type="button"
                  className="accept-button accept-button--icon-only"
                  disabled={!canCreateFrontBackModel || isCreatingFrontBackModel}
                  onClick={handleCreateFrontBackModel}
                  aria-label={isCreatingFrontBackModel ? 'Accepting' : 'Accept'}
                >
                  <span className="accept-button__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M6.5 12.5 10.5 16.5 18 8.8"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </button>
              </div>
            </section>
          </section>

          <section
            className="panel-card workspace-slot workspace-slot--sprite workspace-sprite"
            aria-label="Step 04 Sprite Panel"
          >
            <div className="panel-heading-shell">
              <div className="section-heading">
                <p className="step-label">Step 04</p>
                <h2>Sprite</h2>
              </div>
            </div>
            <div className="workspace-sprite__body">
              <SpriteGrid directions={activeSpriteDirections} embedded />
            </div>
            <div className="action-row action-row--compact">
              <button
                type="button"
                className="primary-button"
                disabled={!canCreateModel || isCreatingModel}
                onClick={handleCreateModel}
              >
                {isCreatingModel ? 'Generating 2.5D...' : 'Generate 2.5D'}
              </button>
              <button
                type="button"
                className="accept-button accept-button--icon-only"
                disabled={!canCreateFrontBackModel || isCreatingFrontBackModel}
                onClick={handleCreateFrontBackModel}
                aria-label={isCreatingFrontBackModel ? 'Accepting Sprite' : 'Accept Sprite'}
              >
                <span className="accept-button__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M6.5 12.5 10.5 16.5 18 8.8"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </button>
            </div>
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
                <option value="84">84x84</option>
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
            <label className="dev-panel__field">
              <span>Retarget Animation</span>
              <input
                type="text"
                value={devSettings.tripoRetargetAnimationName}
                placeholder="Leave blank for server default, e.g. preset:idle"
                onChange={(event) =>
                  setDevSettings((currentValue) => ({
                    ...currentValue,
                    tripoRetargetAnimationName: event.target.value,
                  }))
                }
              />
            </label>
            <label className="dev-panel__field">
              <span>Mesh Quality</span>
              <select
                value={devSettings.tripoMeshQuality}
                onChange={(event) =>
                  setDevSettings((currentValue) => ({
                    ...currentValue,
                    tripoMeshQuality: normalizeTripoQuality(
                      event.target.value,
                      currentValue.tripoMeshQuality,
                    ),
                  }))
                }
              >
                {Object.entries(TRIPO_QUALITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="dev-panel__field">
              <span>Texture Quality</span>
              <select
                value={devSettings.tripoTextureQuality}
                onChange={(event) =>
                  setDevSettings((currentValue) => ({
                    ...currentValue,
                    tripoTextureQuality: normalizeTripoQuality(
                      event.target.value,
                      currentValue.tripoTextureQuality,
                    ),
                  }))
                }
              >
                {Object.entries(TRIPO_QUALITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
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
              <button
                type="button"
                className="secondary-button"
                onClick={handleToggleDefaultSprites}
              >
                {devSettings.defaultSpritesEnabled ? 'Default Sprites: ON' : 'Default Sprites: OFF'}
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={handleRefreshDefaultSprites}
                disabled={!devSettings.defaultSpritesEnabled}
              >
                Refresh Default Sprites
              </button>
            </div>
            <div className="action-row action-row--compact action-row--dev">
              <button
                type="button"
                className="secondary-button"
                onClick={handleCaptureWalkSprites}
                disabled={!activeModelUrl || isCapturingWalkSprites}
              >
                {isCapturingWalkSprites ? 'Capturing Walk Sprites...' : 'Capture Walk Sprites'}
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
                <p>Current task type: {formatTripoTaskTypeLabel(tripoJob.taskType)}</p>
                <p>Selected model version: {healthVersions.tripoModelVersion || 'Unknown'}</p>
                <p>Selected rig version: {healthVersions.tripoRigModelVersion || 'Unknown'}</p>
                <p>
                  Retarget animation:{' '}
                  {String(devSettings.tripoRetargetAnimationName || '').trim() || 'Server default'}
                </p>
                <p>Mesh quality: {TRIPO_QUALITY_LABELS[devSettings.tripoMeshQuality]}</p>
                <p>Texture quality: {TRIPO_QUALITY_LABELS[devSettings.tripoTextureQuality]}</p>
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
              <label className="dev-panel__field">
                <span>Load Existing Tripo Task ID</span>
                <input
                  type="text"
                  value={existingTripoTaskIdInput}
                  placeholder="Paste image_to_model / multiview_to_model / rig / retarget task id"
                  onChange={(event) => setExistingTripoTaskIdInput(event.target.value)}
                />
              </label>
              <div className="action-row action-row--compact action-row--dev">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!existingTripoTaskIdInput.trim() || isLoadingExistingTripoTask}
                  onClick={handleLoadExistingTripoTask}
                >
                  {isLoadingExistingTripoTask ? 'Loading Task...' : 'Load Existing Task'}
                </button>
              </div>
              <div className="action-row action-row--compact action-row--dev">
                <button
                  type="button"
                  className="primary-button"
                  disabled={!canCreateModel || isCreatingModel}
                  onClick={handleCreateModel}
                >
                  {isCreatingModel ? 'Submitting 3D Multiview...' : '3D Multiview'}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!canCreateFrontBackModel || isCreatingFrontBackModel}
                  onClick={handleCreateFrontBackModel}
                >
                  {isCreatingFrontBackModel ? 'Submitting 3D FrontBack...' : '3D FrontBack'}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!canCreateFrontModel || isCreatingFrontModel}
                  onClick={handleCreateFrontModel}
                >
                  {isCreatingFrontModel ? 'Submitting 3D Front...' : '3D Front'}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!canAnimateRig || isCreatingRigTask}
                  onClick={handleAnimateRig}
                >
                  {isCreatingRigTask ? 'Submitting Rig...' : 'Animate Rig'}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!canAnimateRetarget || isCreatingRetargetTask}
                  onClick={handleAnimateRetarget}
                >
                  {isCreatingRetargetTask ? 'Submitting Retarget...' : 'Animate Retarget'}
                </button>
              </div>
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
                  Download 8 Views ZIP
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleDownloadModelViewsGif}
                  disabled={!hasModelViewPack || isBuildingModelViewGif}
                >
                  {isBuildingModelViewGif ? 'Building GIF...' : 'Download GIF'}
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

