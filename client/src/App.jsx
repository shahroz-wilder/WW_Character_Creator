import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import JSZip from 'jszip'
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
const DEFAULT_PROGRESS_BOUNDARIES = Object.freeze([0.2, 0.34, 0.8, 1])
const PIPELINE_POLL_INTERVAL_MS = 3000
const MODEL_CHAIN_STAGE_DELAY_MS = 3000
const PIPELINE_POLL_MAX_ATTEMPTS = 120
const SPRITE_REQUIRED_KEYS = Object.freeze([
  'view_360',
  ...MODEL_VIEW_CAPTURE_ORDER.map((view) => view.key),
])
const PIPELINE_INITIAL_STATE = Object.freeze({
  unlocked: Object.freeze({
    step1: true,
    step2: false,
    step3: false,
    step4: false,
  }),
  approved: Object.freeze({
    step1: false,
    step2: false,
    step3: false,
    step4: false,
  }),
})
const SPRITE_DIRECTION_ALIASES = Object.freeze({
  view_360: ['view_360', 'view360', '360'],
  front: ['front'],
  front_right: ['front_right', 'frontRight', 'frontright'],
  right: ['right'],
  back_right: ['back_right', 'backRight', 'backright'],
  back: ['back'],
  back_left: ['back_left', 'backLeft', 'backleft', 'beckleft'],
  left: ['left'],
  front_left: ['front_left', 'frontLeft', 'frontleft'],
})

const createInitialPipelineState = () => ({
  unlocked: { ...PIPELINE_INITIAL_STATE.unlocked },
  approved: { ...PIPELINE_INITIAL_STATE.approved },
})

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

const base64PayloadToBlob = (base64Payload, mimeType = 'application/octet-stream') => {
  const binaryString = window.atob(base64Payload)
  const binaryLength = binaryString.length
  const bytes = new Uint8Array(binaryLength)

  for (let index = 0; index < binaryLength; index += 1) {
    bytes[index] = binaryString.charCodeAt(index)
  }

  return new Blob([bytes], { type: mimeType })
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

const sanitizeProviderNames = (value) =>
  String(value || '')
    .replace(/tripo/gi, '3D service')
    .replace(/gemini/gi, 'image service')

const clampToProgressRange = (value) => Math.min(1, Math.max(0, Number(value) || 0))

const resolveSpriteDirection = (directions, key) => {
  if (!directions || typeof directions !== 'object') {
    return null
  }

  const aliases = SPRITE_DIRECTION_ALIASES[key] || [key]
  for (const alias of aliases) {
    if (directions[alias]) {
      return directions[alias]
    }
  }

  return null
}

const hasUsableSpriteDirection = (direction) => {
  if (!direction || typeof direction !== 'object') {
    return false
  }

  const source = String(direction.source || '').trim().toLowerCase()
  if (source === 'default-sprite-pack') {
    return false
  }

  if (Array.isArray(direction.frameDataUrls) && direction.frameDataUrls.length > 0) {
    return true
  }

  return Boolean(direction.previewDataUrl)
}

const hasRequiredSpriteBundle = (spritePayload) => {
  const directions = spritePayload?.directions
  if (!directions || typeof directions !== 'object') {
    return false
  }

  return SPRITE_REQUIRED_KEYS.every((directionKey) =>
    hasUsableSpriteDirection(resolveSpriteDirection(directions, directionKey)),
  )
}

const normalizePipelineState = (value) => {
  if (!value || typeof value !== 'object') {
    return null
  }

  return {
    unlocked: {
      step1:
        typeof value?.unlocked?.step1 === 'boolean'
          ? value.unlocked.step1
          : PIPELINE_INITIAL_STATE.unlocked.step1,
      step2: Boolean(value?.unlocked?.step2),
      step3: Boolean(value?.unlocked?.step3),
      step4: Boolean(value?.unlocked?.step4),
    },
    approved: {
      step1: Boolean(value?.approved?.step1),
      step2: Boolean(value?.approved?.step2),
      step3: Boolean(value?.approved?.step3),
      step4: Boolean(value?.approved?.step4),
    },
  }
}

const derivePipelineStateFromArtifacts = ({
  portraitResult,
  multiviewResult,
  tripoJob,
  spriteResult,
  pipelineState,
}) => {
  const normalizedPipelineState = normalizePipelineState(pipelineState)
  if (normalizedPipelineState) {
    return normalizedPipelineState
  }

  const nextPipelineState = createInitialPipelineState()
  if (portraitResult?.imageDataUrl) {
    nextPipelineState.approved.step1 = true
    nextPipelineState.unlocked.step2 = true
  }

  if (hasCompleteTurnaround(multiviewResult?.views)) {
    nextPipelineState.approved.step2 = true
    nextPipelineState.unlocked.step3 = true
  }

  const hasModel = Boolean(
    tripoJob?.status === 'success' &&
      (tripoJob?.outputs?.modelUrl ||
        tripoJob?.outputs?.downloadUrl ||
        (tripoJob?.outputs?.variants && Object.keys(tripoJob.outputs.variants).length > 0)),
  )
  if (hasModel) {
    nextPipelineState.approved.step3 = true
    nextPipelineState.unlocked.step4 = true
  }

  if (hasRequiredSpriteBundle(spriteResult)) {
    nextPipelineState.approved.step4 = true
    nextPipelineState.unlocked.step4 = true
  }

  return nextPipelineState
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
  const [isCreatingPreRigCheckTask, setIsCreatingPreRigCheckTask] = useState(false)
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
  const [modelPreviewMode, setModelPreviewMode] = useState('apose')
  const [spritePreviewMode, setSpritePreviewMode] = useState('walk_8')
  const [defaultSpritesCacheKey, setDefaultSpritesCacheKey] = useState(() => Date.now())
  const [existingTripoTaskIdInput, setExistingTripoTaskIdInput] = useState('')
  const [animateRigTaskIdInput, setAnimateRigTaskIdInput] = useState('')
  const [progressBoundaries, setProgressBoundaries] = useState(() => [...DEFAULT_PROGRESS_BOUNDARIES])
  const [pipelineState, setPipelineState] = useState(
    () => normalizePipelineState(initialSession?.pipelineState) || createInitialPipelineState(),
  )
  const [isPreparingDownloadBundle, setIsPreparingDownloadBundle] = useState(false)
  const [healthVersions, setHealthVersions] = useState(() => ({
    tripoModelVersion: '',
    tripoRigModelVersion: '',
  }))
  const viewerCaptureApiRef = useRef(null)
  const statusProgressTrackRef = useRef(null)
  const step01PanelRef = useRef(null)
  const step02PanelRef = useRef(null)
  const step03BoundaryRef = useRef(null)
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
  const resolvedSpritePreviewMode = spritePreviewMode === 'view_360' ? 'view_360' : 'walk_8'
  const isStep01Unlocked = pipelineState.unlocked.step1
  const isStep02Unlocked = pipelineState.unlocked.step2
  const isStep03Unlocked = pipelineState.unlocked.step3
  const isStep04Unlocked = pipelineState.unlocked.step4
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
  const resolvedAnimateRigTaskId = String(animateRigTaskIdInput || '').trim() || tripoJob.taskId
  const canAnimateRig = Boolean(resolvedAnimateRigTaskId)
  const canAnimateRetarget = Boolean(retargetStartTaskId && tripoJob.status === 'success')
  const preRigCheckResult = tripoJob.outputs?.preRigCheck || null
  const preRigCheckRiggableLabel =
    preRigCheckResult?.riggable === true
      ? 'true'
      : preRigCheckResult?.riggable === false
        ? 'false'
        : 'unknown'
  const hasPortraitStepReady = Boolean(portraitResult?.imageDataUrl)
  const hasTurnaroundStepReady = hasCompleteTurnaround(multiviewResult?.views)
  const hasStep03ChainResult = Boolean(
    activeModelUrl &&
      tripoJob.status === 'success' &&
      ['animate_retarget', 'animate_model'].includes(
        String(tripoJob.taskType || '').trim().toLowerCase(),
      ),
  )
  const hasStep04Output = hasRequiredSpriteBundle(spriteResult)
  const canApproveStep01 = isStep01Unlocked && hasPortraitStepReady && !isGeneratingPortrait
  const canRunStep02Generation =
    isStep02Unlocked && hasPortraitStepReady && !turnaroundGenerationMode && !isGeneratingPortrait
  const canApproveStep02 = isStep02Unlocked && hasTurnaroundStepReady && !turnaroundGenerationMode
  const canRunStep03Generation =
    isStep03Unlocked &&
    hasTurnaroundStepReady &&
    !isCreatingModel &&
    !isCreatingRigTask &&
    !isCreatingRetargetTask
  const canApproveStep03 = isStep03Unlocked && hasStep03ChainResult && !isCreatingRetargetTask
  const canRunStep04Generation =
    isStep04Unlocked &&
    hasStep03ChainResult &&
    !isGeneratingSprite &&
    !isCapturingWalkSprites &&
    !isPreparingDownloadBundle
  const canDownloadFinalBundle =
    isStep04Unlocked && pipelineState.approved.step4 && hasStep04Output && !isPreparingDownloadBundle

  const currentStepIndex = pipelineState.approved.step4 && hasStep04Output
    ? 4
    : pipelineState.unlocked.step4 || pipelineState.unlocked.step3
      ? 3
      : pipelineState.unlocked.step2
        ? 2
        : 1
  const progressFillRatio = clampToProgressRange(
    progressBoundaries[Math.max(0, Math.min(currentStepIndex - 1, progressBoundaries.length - 1))] ||
      progressBoundaries[0] ||
      DEFAULT_PROGRESS_BOUNDARIES[0],
  )
  const progressFillWidth = `${(progressFillRatio * 100).toFixed(2)}%`

  const currentPipelineState = error
    ? 'Attention needed'
    : isPreparingDownloadBundle
      ? 'Preparing final bundle'
      : isGeneratingPortrait
        ? 'Generating portrait'
        : !pipelineState.approved.step1 && hasPortraitStepReady
          ? 'Portrait ready for approval'
          : turnaroundGenerationMode
            ? 'Generating multiview'
            : !pipelineState.approved.step2 && hasTurnaroundStepReady
              ? 'Multiview ready for approval'
              : isCreatingModel || isCreatingRigTask || isCreatingRetargetTask
                ? isCreatingRetargetTask
                  ? 'Applying animation'
                  : isCreatingRigTask
                    ? 'Rigging model'
                    : 'Generating 3D model'
                : !pipelineState.approved.step3 && hasStep03ChainResult
                  ? '3D model ready for approval'
                  : isGeneratingSprite || isCapturingWalkSprites
                    ? 'Generating 2.5D sprites'
                    : pipelineState.approved.step4 && hasStep04Output
                      ? 'Pipeline complete'
                      : isStep04Unlocked
                        ? 'Ready for 2.5D generation'
                        : isStep03Unlocked
                          ? 'Ready for 3D generation'
                          : isStep02Unlocked
                            ? 'Ready for 2D generation'
                            : 'Ready for portrait generation'

  const pipelineSummary = pipelineState.approved.step4
    ? 'COMPLETE'
    : pipelineState.unlocked.step4
      ? 'STEP 04'
      : pipelineState.unlocked.step3
        ? 'STEP 03'
        : pipelineState.unlocked.step2
          ? 'STEP 02'
          : 'STEP 01'
  const topBarMessage = sanitizeProviderNames(error) || pipelineSummary

  const recalculateProgressBoundaries = useCallback(() => {
    const trackElement = statusProgressTrackRef.current

    if (!trackElement) {
      return
    }

    const trackRect = trackElement.getBoundingClientRect()
    if (!trackRect.width || !Number.isFinite(trackRect.width)) {
      return
    }

    const toBoundary = (element, fallbackValue) => {
      if (!element) {
        return fallbackValue
      }

      const elementRect = element.getBoundingClientRect()
      if (!Number.isFinite(elementRect.right)) {
        return fallbackValue
      }

      return clampToProgressRange((elementRect.right - trackRect.left) / trackRect.width)
    }

    const nextStep01 = toBoundary(step01PanelRef.current, DEFAULT_PROGRESS_BOUNDARIES[0])
    const nextStep02Raw = toBoundary(step02PanelRef.current, DEFAULT_PROGRESS_BOUNDARIES[1])
    const nextStep02 = clampToProgressRange(Math.max(nextStep02Raw, nextStep01 + 0.01))
    const nextStep03Raw = toBoundary(step03BoundaryRef.current, DEFAULT_PROGRESS_BOUNDARIES[2])
    const nextStep03 = clampToProgressRange(Math.max(nextStep03Raw, nextStep02 + 0.01))
    const nextBoundaries = [nextStep01, nextStep02, nextStep03, 1]

    setProgressBoundaries((currentBoundaries) => {
      const hasMeaningfulDifference = nextBoundaries.some(
        (value, index) => Math.abs(value - (currentBoundaries[index] || 0)) > 0.002,
      )

      return hasMeaningfulDifference ? nextBoundaries : currentBoundaries
    })
  }, [])

  useEffect(() => {
    const refreshBoundaries = () => {
      window.requestAnimationFrame(recalculateProgressBoundaries)
    }

    refreshBoundaries()

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refreshBoundaries)
    const observedElements = [
      statusProgressTrackRef.current,
      step01PanelRef.current,
      step02PanelRef.current,
      step03BoundaryRef.current,
    ].filter(Boolean)

    observedElements.forEach((element) => resizeObserver?.observe(element))
    window.addEventListener('resize', refreshBoundaries)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', refreshBoundaries)
    }
  }, [recalculateProgressBoundaries])

  useEffect(() => {
    window.requestAnimationFrame(recalculateProgressBoundaries)
  }, [isDevPanelOpen, recalculateProgressBoundaries])

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
        setPipelineState(
          derivePipelineStateFromArtifacts({
            portraitResult: session.portraitResult,
            multiviewResult: session.multiviewResult,
            tripoJob: session.tripoJob,
            spriteResult: session.spriteResult,
            pipelineState: session.pipelineState,
          }),
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
      pipelineState,
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
    pipelineState,
    prompt,
    tripoJob,
  ])

  useEffect(() => {
    setPipelineState((currentState) => {
      const shouldApproveStep4 = currentState.unlocked.step4 && hasStep04Output
      if (currentState.approved.step4 === shouldApproveStep4) {
        return currentState
      }

      return {
        unlocked: { ...currentState.unlocked },
        approved: {
          ...currentState.approved,
          step4: shouldApproveStep4,
        },
      }
    })
  }, [hasStep04Output])

  useEffect(() => {
    setModelViewPack(null)
  }, [activeModelUrl])

  useEffect(() => {
    if (!tripoJob.taskId) {
      setModelPreviewMode('apose')
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

  const updatePipelineState = useCallback((updater) => {
    setPipelineState((currentState) => {
      const draftState = {
        unlocked: { ...currentState.unlocked },
        approved: { ...currentState.approved },
      }
      updater(draftState)
      return draftState
    })
  }, [])

  const resetPipelineFromStep = useCallback(
    (stepNumber) => {
      updatePipelineState((nextState) => {
        nextState.unlocked.step1 = true
        if (stepNumber <= 1) {
          nextState.approved.step1 = false
          nextState.unlocked.step2 = false
        }
        if (stepNumber <= 2) {
          nextState.approved.step2 = false
          nextState.unlocked.step3 = false
        }
        if (stepNumber <= 3) {
          nextState.approved.step3 = false
          nextState.unlocked.step4 = false
        }
        if (stepNumber <= 4) {
          nextState.approved.step4 = false
        }
      })
    },
    [updatePipelineState],
  )

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

  const waitForDelay = (durationMs) =>
    new Promise((resolve) => {
      window.setTimeout(resolve, durationMs)
    })

  const waitForTripoTaskSuccess = async (taskId, animationMode = '') => {
    for (let attempt = 0; attempt < PIPELINE_POLL_MAX_ATTEMPTS; attempt += 1) {
      const nextJob = await refreshTripoJob(taskId, animationMode || devSettings.tripoAnimationMode)
      applyTripoJobUpdate(nextJob, currentRunId)

      if (nextJob.status === 'success') {
        return nextJob
      }

      if (nextJob.status === 'failed') {
        throw new Error(sanitizeProviderNames(nextJob.error) || '3D generation failed.')
      }

      await waitForDelay(PIPELINE_POLL_INTERVAL_MS)
    }

    throw new Error('3D generation timed out.')
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

  const buildGifBlobFromFrames = useCallback(async ({ frameDataUrls, width, height, delayMs = 110 }) => {
    const frames = Array.isArray(frameDataUrls)
      ? frameDataUrls.filter((frameDataUrl) => Boolean(frameDataUrl))
      : []
    if (frames.length === 0) {
      throw new Error('No sprite frames are available for GIF generation.')
    }

    const [{ default: GIF }, { default: workerScript }] = await Promise.all([
      import('gif.js'),
      import('gif.js/dist/gif.worker.js?url'),
    ])
    const gif = new GIF({
      workers: 2,
      quality: 10,
      width,
      height,
      background: GIF_TRANSPARENT_CSS,
      transparent: GIF_TRANSPARENT_HEX,
      workerScript,
    })
    const frameCanvas = document.createElement('canvas')
    frameCanvas.width = width
    frameCanvas.height = height
    const frameContext = frameCanvas.getContext('2d')

    if (!frameContext) {
      throw new Error('2D canvas context is unavailable for GIF generation.')
    }

    for (const frameDataUrl of frames) {
      const frameImage = await loadImageFromDataUrl(frameDataUrl)
      frameContext.clearRect(0, 0, width, height)
      frameContext.imageSmoothingEnabled = !MODEL_VIEW_PIXEL_ART_MODE
      frameContext.drawImage(frameImage, 0, 0, width, height)
      const frameImageData = frameContext.getImageData(0, 0, width, height)
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
        delay: delayMs,
      })
    }

    return new Promise((resolve) => {
      gif.on('finished', (blob) => resolve(blob))
      gif.render()
    })
  }, [])

  const buildDirectionGifBlob = useCallback(
    async (direction, fallbackSize = DEV_PRESETS.spriteSize) => {
      if (!hasUsableSpriteDirection(direction)) {
        throw new Error('Missing sprite output.')
      }

      const frameDataUrls = Array.isArray(direction?.frameDataUrls)
        ? direction.frameDataUrls.filter((frameDataUrl) => Boolean(frameDataUrl))
        : []
      const previewDataUrl = String(direction?.previewDataUrl || '').trim()
      if (frameDataUrls.length === 0 && /^data:image\/gif;base64,/i.test(previewDataUrl)) {
        const base64Payload = dataUrlToBase64Payload(previewDataUrl)
        if (base64Payload) {
          return base64PayloadToBlob(base64Payload, 'image/gif')
        }
      }

      if (frameDataUrls.length === 0 && /\.gif(?:$|\?)/i.test(previewDataUrl)) {
        const response = await fetch(previewDataUrl)
        if (response.ok) {
          return response.blob()
        }
      }

      const usableFrames = frameDataUrls.length > 0 ? frameDataUrls : previewDataUrl ? [previewDataUrl] : []

      if (usableFrames.length === 0) {
        throw new Error('Missing sprite output.')
      }

      const firstFrame = await loadImageFromDataUrl(usableFrames[0])
      const width = firstFrame.naturalWidth || firstFrame.width || fallbackSize
      const height = firstFrame.naturalHeight || firstFrame.height || fallbackSize
      const frameDelay = Number(direction?.delayMs) > 0 ? Number(direction.delayMs) : 110
      return buildGifBlobFromFrames({
        frameDataUrls: usableFrames,
        width,
        height,
        delayMs: frameDelay,
      })
    },
    [buildGifBlobFromFrames],
  )

  const buildViewerWalkDirections = useCallback(async (capturedDirections, captureSize) => {
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

    return Object.fromEntries(resizedEntries.filter((entry) => Boolean(entry[1])))
  }, [])

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
            error: sanitizeProviderNames(pollError.message),
          }))
        }
      } finally {
        isPolling = false
      }
    }

    const intervalId = window.setInterval(poll, PIPELINE_POLL_INTERVAL_MS)

    return () => {
      isCancelled = true
      window.clearInterval(intervalId)
    }
  }, [currentRunId, devSettings.tripoAnimationMode, tripoJob.animationMode, tripoJob.taskId, tripoJob.status])

  const runMultiviewGeneration = async ({
    mode = 'full',
    portraitSource = portraitResult,
    runIdForHistory = currentRunId,
    resetDownstream = true,
  } = {}) => {
    if (!portraitSource?.imageDataUrl) {
      setError('Generate a portrait first to establish the character identity.')
      return null
    }

    setError('')
    if (resetDownstream) {
      resetPipelineFromStep(2)
    }
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
    resetPipelineFromStep(1)
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

  const handleAcceptPortrait = () => {
    if (!canApproveStep01) {
      return
    }

    setError('')
    updatePipelineState((nextState) => {
      nextState.approved.step1 = true
      nextState.unlocked.step2 = true
    })
  }

  const handleGenerateStep02 = async () => {
    if (!canRunStep02Generation) {
      return
    }

    await runMultiviewGeneration({
      mode: 'full',
      portraitSource: portraitResult,
      runIdForHistory: currentRunId,
    })
  }

  const handleAcceptStep02 = () => {
    if (!canApproveStep02) {
      return
    }

    setError('')
    updatePipelineState((nextState) => {
      nextState.approved.step2 = true
      nextState.unlocked.step3 = true
    })
  }

  const handleGenerateTurnaround = async (mode = 'full') => {
    await runMultiviewGeneration({
      mode,
      portraitSource: portraitResult,
      runIdForHistory: currentRunId,
      resetDownstream: false,
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

  const handleGenerateStep03 = async () => {
    if (!canRunStep03Generation) {
      return
    }

    setError('')
    resetPipelineFromStep(3)
    setSpriteResult(null)
    setIsCreatingModel(true)

    try {
      const modelTask = await createTripoTask({
        views: {
          front: multiviewResult.views.front.imageDataUrl,
          back: multiviewResult.views.back.imageDataUrl,
          left: multiviewResult.views.left.imageDataUrl,
          right: multiviewResult.views.right.imageDataUrl,
        },
        meshQuality: devSettings.tripoMeshQuality,
        textureQuality: devSettings.tripoTextureQuality,
      })
      if (!modelTask?.taskId) {
        throw new Error('Failed to start 3D model generation task.')
      }
      setModelPreviewMode('apose')
      applyTripoTaskStart(modelTask, {
        animationMode: 'static',
        fallbackTaskType: 'multiview_to_model',
      })

      const completedModelTask = await waitForTripoTaskSuccess(modelTask.taskId, 'static')
      if (!completedModelTask?.taskId) {
        throw new Error('3D model generation did not return a valid task id.')
      }

      setIsCreatingModel(false)
      setIsCreatingRigTask(true)
      await waitForDelay(MODEL_CHAIN_STAGE_DELAY_MS)

      const rigTask = await createTripoRigTask(completedModelTask.taskId)
      if (!rigTask?.taskId) {
        throw new Error('Failed to start rig generation task.')
      }
      applyTripoTaskStart(rigTask, {
        animationMode: 'static',
        fallbackTaskType: 'animate_rig',
        fallbackSourceTaskId: completedModelTask.taskId,
      })

      const completedRigTask = await waitForTripoTaskSuccess(rigTask.taskId, 'static')
      if (!completedRigTask?.taskId) {
        throw new Error('Rig generation did not return a valid task id.')
      }

      setIsCreatingRigTask(false)
      setIsCreatingRetargetTask(true)
      await waitForDelay(MODEL_CHAIN_STAGE_DELAY_MS)

      const retargetTask = await createTripoRetargetTask(completedRigTask.taskId, {
        animationName: String(devSettings.tripoRetargetAnimationName || '').trim(),
      })
      if (!retargetTask?.taskId) {
        throw new Error('Failed to start animation task.')
      }
      setModelPreviewMode('animated')
      applyTripoTaskStart(retargetTask, {
        animationMode: 'animated',
        fallbackTaskType: 'animate_retarget',
        fallbackSourceTaskId: completedRigTask.taskId,
      })

      await waitForTripoTaskSuccess(retargetTask.taskId, 'animated')
    } catch (requestError) {
      setError(sanitizeProviderNames(requestError?.message || 'Failed to complete 3D generation.'))
    } finally {
      setIsCreatingModel(false)
      setIsCreatingRigTask(false)
      setIsCreatingRetargetTask(false)
    }
  }

  const handleAcceptStep03 = () => {
    if (!canApproveStep03) {
      return
    }

    setError('')
    updatePipelineState((nextState) => {
      nextState.approved.step3 = true
      nextState.unlocked.step4 = true
    })
  }

  const handleGenerateStep04 = async () => {
    if (!canRunStep04Generation) {
      return
    }

    setError('')
    resetPipelineFromStep(4)
    setIsGeneratingSprite(true)
    setIsCapturingWalkSprites(true)
    const captureSize = normalizeSpriteSize(devSettings.spriteSize)

    try {
      const captureApi = viewerCaptureApiRef.current
      if (!captureApi?.captureAnimatedSpriteDirections) {
        throw new Error('3D viewer is not ready for animated sprite capture yet.')
      }

      if (!activeModelUrl) {
        throw new Error('Load an animated model before capturing walk sprites.')
      }

      const capturedDirections = await captureApi.captureAnimatedSpriteDirections()
      const nextDirections = await buildViewerWalkDirections(capturedDirections, captureSize)
      const fallback360Direction =
        resolveSpriteDirection(activeSpriteDirections, 'view_360') ||
        buildDefaultSpriteDirections(defaultSpritesCacheKey).view_360
      const mergedDirections =
        fallback360Direction && hasUsableSpriteDirection(fallback360Direction)
          ? {
              ...nextDirections,
              view_360: fallback360Direction,
            }
          : nextDirections

      setDevSettings((currentValue) => ({
        ...currentValue,
        defaultSpritesEnabled: false,
      }))
      setSpriteResult({
        animation: 'walk',
        spriteSize: captureSize,
        directions: mergedDirections,
      })
    } catch (requestError) {
      setError(sanitizeProviderNames(requestError?.message || 'Failed to capture animated walk sprites.'))
    } finally {
      setIsGeneratingSprite(false)
      setIsCapturingWalkSprites(false)
    }
  }

  const handleDownloadFinalBundle = async () => {
    if (!canDownloadFinalBundle) {
      return
    }

    setError('')
    setIsPreparingDownloadBundle(true)

    try {
      if (!portraitResult?.imageDataUrl) {
        throw new Error('Portrait output is missing for download.')
      }

      if (!hasCompleteTurnaround(multiviewResult?.views)) {
        throw new Error('Multiview output is missing for download.')
      }

      if (!activeDownloadUrl) {
        throw new Error('3D model output is missing for download.')
      }

      if (!hasRequiredSpriteBundle(spriteResult)) {
        throw new Error('Sprite output is incomplete for download.')
      }

      const zip = new JSZip()
      const portraitFolder = zip.folder('01_Portrait')
      const multiviewFolder = zip.folder('02_Multiview')
      const modelFolder = zip.folder('03_3DModel')
      const spritesFolder = zip.folder('04_Sprites')

      const portraitBase64 = dataUrlToBase64Payload(portraitResult.imageDataUrl)
      if (!portraitBase64) {
        throw new Error('Portrait output is invalid for download.')
      }
      const portraitExtension = getDataUrlFileExtension(portraitResult.imageDataUrl)
      portraitFolder?.file(`portrait.${portraitExtension}`, portraitBase64, { base64: true })
      if (prompt.trim()) {
        portraitFolder?.file('prompt.txt', prompt.trim())
      }

      for (const directionKey of MULTIVIEW_ORDER) {
        const directionDataUrl = String(multiviewResult?.views?.[directionKey]?.imageDataUrl || '').trim()
        const directionBase64 = dataUrlToBase64Payload(directionDataUrl)
        if (!directionBase64) {
          throw new Error(`Multiview output is missing: ${directionKey}.`)
        }
        const directionExtension = getDataUrlFileExtension(directionDataUrl)
        multiviewFolder?.file(`${directionKey}.${directionExtension}`, directionBase64, { base64: true })
      }

      const modelResponse = await fetch(activeDownloadUrl)
      if (!modelResponse.ok) {
        throw new Error('Failed to fetch 3D model output for download.')
      }
      const modelBlob = await modelResponse.blob()
      modelFolder?.file(`${tripoJob.taskId || 'model'}.glb`, modelBlob)

      for (const directionKey of SPRITE_REQUIRED_KEYS) {
        const direction = resolveSpriteDirection(spriteResult?.directions, directionKey)
        const directionBlob = await buildDirectionGifBlob(direction, Number(spriteResult?.spriteSize) || 64)
        spritesFolder?.file(`${directionKey}.gif`, directionBlob)
      }

      const bundleBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      })
      const runSuffix = currentRunId || tripoJob.taskId || Date.now()
      downloadBlob(bundleBlob, `ww-character-${runSuffix}.zip`)
    } catch (requestError) {
      setError(sanitizeProviderNames(requestError?.message || 'Failed to prepare final bundle download.'))
    } finally {
      setIsPreparingDownloadBundle(false)
    }
  }

  const handleAnimateRig = async () => {
    const sourceTaskId = resolvedAnimateRigTaskId

    if (!sourceTaskId) {
      setError('Create a mesh task before starting rigging.')
      return
    }

    setError('')
    setIsCreatingRigTask(true)

    try {
      const result = await createTripoRigTask(sourceTaskId)
      setModelPreviewMode('apose')
      applyTripoTaskStart(result, {
        animationMode: 'static',
        fallbackTaskType: 'animate_rig',
        fallbackSourceTaskId: sourceTaskId,
      })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsCreatingRigTask(false)
    }
  }

  const handlePreRigCheck = async () => {
    const sourceTaskId = resolvedAnimateRigTaskId

    if (!sourceTaskId) {
      setError('Load a source task id before running pre-rig-check.')
      return
    }

    setError('')
    setIsCreatingPreRigCheckTask(true)

    try {
      const result = await createTripoPreRigCheckTask(sourceTaskId)
      applyTripoTaskStart(result, {
        animationMode: 'static',
        fallbackTaskType: 'animate_prerigcheck',
        fallbackSourceTaskId: sourceTaskId,
      })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsCreatingPreRigCheckTask(false)
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
        <header className="status-bar status-progress" aria-label="Pipeline progress">
          <div
            className="status-progress__track"
            ref={statusProgressTrackRef}
            role="progressbar"
            aria-label="Pipeline step progress"
            aria-valuemin={1}
            aria-valuemax={4}
            aria-valuenow={currentStepIndex}
          >
            <div
              className="status-progress__fill"
              style={{ width: progressFillWidth }}
              data-testid="status-progress-fill"
              data-step-index={currentStepIndex}
            />
            <div className="status-progress__content">
              <p className="status-progress__inline status-progress__inline--left">
                <span className="status-progress__label">Status:</span> {currentPipelineState}
              </p>
              <p className="status-progress__inline status-progress__inline--right">
                <span className="status-progress__label">Message:</span> {topBarMessage}
              </p>
            </div>
          </div>
        </header>

        <section className="workspace-grid workspace-grid--screenshot">
          <section
            className="panel-card workspace-slot workspace-slot--portrait workspace-portrait"
            aria-label="Step 01 Portrait Panel"
            ref={step01PanelRef}
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
                isAcceptDisabled={!canApproveStep01}
              />
            </div>
          </section>

          <section className="panel-card workspace-stage" aria-label="Center Stage Panel">
            <section
              className="workspace-stage__multiview"
              aria-label="Step 02 Multiview Panel"
              ref={step02PanelRef}
            >
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
                  disabled={!canRunStep02Generation}
                  onClick={handleGenerateStep02}
                >
                  {turnaroundGenerationMode ? 'Generating 2D...' : 'Generate 2D'}
                </button>
                <button
                  type="button"
                  className="accept-button accept-button--icon-only"
                  disabled={!canApproveStep02}
                  onClick={handleAcceptStep02}
                  aria-label="Accept Multiview"
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

            <section
              className="workspace-stage__model"
              aria-label="Step 03 3D Model Panel"
              ref={step03BoundaryRef}
            >
              <div className="panel-heading-shell">
                <div className="section-heading">
                  <p className="step-label">Step 03</p>
                  <h2>3D Model</h2>
                </div>
                <div className="panel-heading-control">
                  <label className="visually-hidden" htmlFor="step03-animation-select">
                    3D model animation preview
                  </label>
                  <select
                    id="step03-animation-select"
                    className="panel-heading-select"
                    value={modelPreviewMode}
                    onChange={(event) => setModelPreviewMode(event.target.value)}
                    aria-label="3D model animation preview"
                  >
                    <option value="apose">A-pose</option>
                    <option value="animated">Walk</option>
                  </select>
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
                    <p>Model will appear when ready.</p>
                  </div>
                )}
              </div>
              <div className="action-row action-row--compact">
                <button
                  type="button"
                  className="primary-button"
                  disabled={!canRunStep03Generation}
                  onClick={handleGenerateStep03}
                >
                  {isCreatingModel ? 'Generating 3D...' : 'Generate 3D'}
                </button>
                <button
                  type="button"
                  className="accept-button accept-button--icon-only"
                  disabled={!canApproveStep03}
                  onClick={handleAcceptStep03}
                  aria-label="Accept 3D"
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
              <div className="panel-heading-control">
                <label className="visually-hidden" htmlFor="step04-sprite-view-select">
                  Sprite animation preview
                </label>
                <select
                  id="step04-sprite-view-select"
                  className="panel-heading-select"
                  value={resolvedSpritePreviewMode}
                  onChange={(event) => setSpritePreviewMode(event.target.value)}
                  aria-label="Sprite animation preview"
                >
                  <option value="view_360">360</option>
                  <option value="walk_8">8-direction walk</option>
                </select>
              </div>
            </div>
            <div className="workspace-sprite__body">
              <SpriteGrid
                directions={activeSpriteDirections}
                displayMode={resolvedSpritePreviewMode}
                embedded
              />
            </div>
            <div className="action-row action-row--compact">
              <button
                type="button"
                className="primary-button"
                disabled={!canRunStep04Generation}
                onClick={handleGenerateStep04}
              >
                {isGeneratingSprite || isCapturingWalkSprites ? 'Generating 2.5D...' : 'Generate 2.5D'}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={!canDownloadFinalBundle}
                onClick={handleDownloadFinalBundle}
              >
                {isPreparingDownloadBundle ? 'Preparing...' : 'Download'}
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
                {tripoJob.taskType === 'animate_prerigcheck' ? (
                  <>
                    <p>PreRigCheck riggable: {preRigCheckRiggableLabel}</p>
                    <p>PreRigCheck rig type: {preRigCheckResult?.rigType || 'unknown'}</p>
                  </>
                ) : null}
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
              <label className="dev-panel__field">
                <span>Animate Rig Task ID (Optional)</span>
                <input
                  type="text"
                  value={animateRigTaskIdInput}
                  placeholder="Leave empty to use current loaded task id"
                  onChange={(event) => setAnimateRigTaskIdInput(event.target.value)}
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
                  disabled={!resolvedAnimateRigTaskId || isCreatingPreRigCheckTask}
                  onClick={handlePreRigCheck}
                >
                  {isCreatingPreRigCheckTask ? 'Submitting PreRigCheck...' : 'PreRigCheck'}
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

