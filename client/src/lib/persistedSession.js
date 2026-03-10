import { DEFAULT_MULTIVIEW_PROMPT } from '../constants/prompts'

const STORAGE_KEY = 'ww-character-session-v1'
const DATABASE_NAME = 'ww-character-session-db'
const DATABASE_VERSION = 1
const STORE_NAME = 'session'
const STORE_KEY = 'current'
const HISTORY_LIMIT = 12
const LEGACY_MULTIVIEW_PROMPTS = new Set([
  `Full length, full body, one character, Side VIEW ONLY, head-to-toe in frame,
orthographic neutral A-pose, white seamless background`,
  `full-length one full body character, Side VIEW ONLY, head-to-toe in frame
orthographic, neutral A-pose, light grey seamless background, sharp focus, No weapon, No cape`,
])
const ANIMATED_TASK_TYPES = new Set(['animate_retarget', 'animate_model'])

const canUseStorage = () => typeof window !== 'undefined' && Boolean(window.localStorage)
const canUseIndexedDb = () => typeof window !== 'undefined' && Boolean(window.indexedDB)

const normalizeRequestedAnimations = (value) => {
  const sourceValues = Array.isArray(value) ? value : value ? [value] : []
  const seenValues = new Set()
  const normalizedValues = []

  for (const entry of sourceValues) {
    const animationPreset = String(entry || '').trim()
    if (!animationPreset) {
      continue
    }

    const dedupeKey = animationPreset.toLowerCase()
    if (seenValues.has(dedupeKey)) {
      continue
    }

    seenValues.add(dedupeKey)
    normalizedValues.push(animationPreset)
  }

  return normalizedValues
}

const LEGACY_ANIMATION_KEY_BY_PRESET = Object.freeze({
  idle: 'idle',
  walk: 'walk',
  run: 'run',
  slash: 'slash',
  'preset:idle': 'idle',
  'preset:biped:wait': 'idle',
  'preset:walk': 'walk',
  'preset:run': 'run',
  'preset:slash': 'slash',
  'preset:biped:idle': 'idle',
  'preset:biped:walk': 'walk',
  'preset:biped:run': 'run',
  'preset:biped:slash': 'slash',
})

const getAnimationKeyFromPreset = (value) =>
  LEGACY_ANIMATION_KEY_BY_PRESET[String(value || '').trim().toLowerCase()] || ''

const resolveLegacyAnimationOutputKey = (requestedAnimations = []) => {
  const requestedAnimationKeys = normalizeRequestedAnimations(requestedAnimations)
    .map((animationPreset) => getAnimationKeyFromPreset(animationPreset))
    .filter(Boolean)

  if (requestedAnimationKeys.includes('idle')) {
    return 'idle'
  }

  return requestedAnimationKeys[0] || 'walk'
}

const normalizeMultiviewPromptValue = (value) => {
  const normalizedValue = String(value || '').trim()
  if (!normalizedValue) {
    return ''
  }

  return LEGACY_MULTIVIEW_PROMPTS.has(normalizedValue)
    ? DEFAULT_MULTIVIEW_PROMPT
    : normalizedValue
}

const normalizeHistoryEntry = (entry) => ({
  id: entry?.id || `recovered-${entry?.tripoTaskId || Date.now()}`,
  createdAt: entry?.createdAt || new Date().toISOString(),
  promptSummary: entry?.promptSummary || 'Recovered run',
  inputMode: entry?.inputMode || 'unknown',
  portraitUrl: entry?.portraitUrl || '',
  multiview: entry?.multiview || null,
  tripoTaskId: entry?.tripoTaskId || '',
  tripoStatus: entry?.tripoStatus || 'idle',
  modelUrl: entry?.modelUrl || '',
})

const normalizeTripoAnimationOutput = (entry, fallbackLabel = '') => {
  if (!entry || typeof entry !== 'object') {
    return null
  }

  const variant =
    String(entry?.variant || '').trim() ||
    (entry?.variants && typeof entry.variants === 'object'
      ? Object.keys(entry.variants).find((key) => Boolean(entry.variants[key])) || ''
      : '')

  if (
    !entry?.modelUrl &&
    !entry?.downloadUrl &&
    (!entry?.variants || typeof entry.variants !== 'object' || Object.keys(entry.variants).length === 0)
  ) {
    return null
  }

  return {
    preset: String(entry?.preset || '').trim(),
    label: String(entry?.label || fallbackLabel).trim(),
    variant,
    modelUrl: entry?.modelUrl || '',
    downloadUrl: entry?.downloadUrl || '',
    variants: entry?.variants && typeof entry.variants === 'object' ? entry.variants : null,
    ...(Number.isInteger(entry?.clipIndex) ? { clipIndex: entry.clipIndex } : {}),
  }
}

const normalizeTripoOutputs = (outputs, taskType = '', requestedAnimations = []) => {
  if (!outputs) {
    return null
  }

  const normalizedOutputs = {
    ...outputs,
    modelUrl: outputs?.modelUrl || '',
    downloadUrl: outputs?.downloadUrl || '',
    variant: outputs?.variant || '',
    variants: outputs?.variants && typeof outputs.variants === 'object' ? outputs.variants : null,
  }
  const normalizedAnimations = {}

  if (outputs?.animations && typeof outputs.animations === 'object') {
    for (const [animationKey, entry] of Object.entries(outputs.animations)) {
      const normalizedEntry = normalizeTripoAnimationOutput(entry)
      if (normalizedEntry) {
        normalizedAnimations[animationKey] = normalizedEntry
      }
    }
  }

  if (
    Object.keys(normalizedAnimations).length === 0 &&
    ANIMATED_TASK_TYPES.has(String(taskType || '').trim().toLowerCase())
  ) {
    const legacyAnimationEntry = normalizeTripoAnimationOutput(outputs, 'Walk')
    if (legacyAnimationEntry) {
      normalizedAnimations[resolveLegacyAnimationOutputKey(requestedAnimations)] = legacyAnimationEntry
    }
  }

  if (Object.keys(normalizedAnimations).length > 0) {
    normalizedOutputs.animations = normalizedAnimations
  }

  return normalizedOutputs
}

const normalizeTripoJob = (job) => ({
  requestedAnimations: normalizeRequestedAnimations(job?.requestedAnimations),
  taskId: job?.taskId || '',
  taskType: job?.taskType || '',
  sourceTaskId: job?.sourceTaskId || '',
  status: job?.status || 'idle',
  progress: Number.isFinite(job?.progress) ? job.progress : 0,
  error: job?.error || '',
  outputs: normalizeTripoOutputs(job?.outputs, job?.taskType, job?.requestedAnimations),
  animationMode: job?.animationMode === 'static' ? 'static' : job?.animationMode === 'animated' ? 'animated' : '',
})

const normalizePortraitResult = (portraitResult) =>
  portraitResult
    ? {
        imageDataUrl: portraitResult.imageDataUrl || '',
        modelUsed: portraitResult.modelUsed || '',
        promptUsed: portraitResult.promptUsed || '',
        inputMode: portraitResult.inputMode || 'unknown',
        originalReferenceImageDataUrl: portraitResult.originalReferenceImageDataUrl || '',
      }
    : null

const normalizeMultiviewResult = (multiviewResult) => {
  if (!multiviewResult) {
    return null
  }

  return {
    mode: multiviewResult.mode || 'full',
    modelUsage: multiviewResult.modelUsage || null,
    views: multiviewResult.views || null,
    promptMetadata: multiviewResult.promptMetadata || null,
  }
}

const normalizeSpriteResult = (spriteResult) => {
  if (!spriteResult) {
    return null
  }

  const normalizedAnimations = {}

  if (spriteResult?.animations && typeof spriteResult.animations === 'object') {
    for (const [animationKey, entry] of Object.entries(spriteResult.animations)) {
      const directions = entry?.directions || null
      if (!directions || typeof directions !== 'object') {
        continue
      }

      normalizedAnimations[animationKey] = {
        animation: String(entry?.animation || animationKey).trim() || animationKey,
        label: String(entry?.label || '').trim(),
        preset: String(entry?.preset || '').trim(),
      directions,
      }
    }
  }

  const resolveSharedDirections = () => {
    if (spriteResult?.sharedDirections && typeof spriteResult.sharedDirections === 'object') {
      const shared360 =
        spriteResult.sharedDirections.view_360 ||
        spriteResult.sharedDirections.view360 ||
        spriteResult.sharedDirections['360']

      return shared360
        ? {
            view_360: shared360,
          }
        : null
    }

    const idleDirections = normalizedAnimations?.idle?.directions || null
    const legacyDirections =
      spriteResult?.directions && typeof spriteResult.directions === 'object'
        ? spriteResult.directions
        : null
    const shared360 =
      idleDirections?.view_360 ||
      idleDirections?.view360 ||
      idleDirections?.['360'] ||
      legacyDirections?.view_360 ||
      legacyDirections?.view360 ||
      legacyDirections?.['360']

    return shared360
      ? {
          view_360: shared360,
        }
      : null
  }

  if (
    Object.keys(normalizedAnimations).length === 0 &&
    spriteResult?.directions &&
    typeof spriteResult.directions === 'object'
  ) {
    const legacyAnimationKey = String(spriteResult.animation || 'walk').trim() || 'walk'
    normalizedAnimations[legacyAnimationKey] = {
      animation: legacyAnimationKey,
      label: legacyAnimationKey,
      preset: '',
      directions: spriteResult.directions,
    }
  }

  const firstAnimationKey = Object.keys(normalizedAnimations)[0] || 'walk'
  const sharedDirections = resolveSharedDirections()

  return {
    animation: firstAnimationKey,
    spriteSize: Number(spriteResult.spriteSize) || 64,
    directions: normalizedAnimations[firstAnimationKey]?.directions || null,
    animations: Object.keys(normalizedAnimations).length > 0 ? normalizedAnimations : null,
    sharedDirections,
  }
}

const normalizePipelineState = (pipelineState) => ({
  unlocked: {
    step1:
      typeof pipelineState?.unlocked?.step1 === 'boolean' ? pipelineState.unlocked.step1 : true,
    step2:
      typeof pipelineState?.unlocked?.step2 === 'boolean' ? pipelineState.unlocked.step2 : false,
    step3:
      typeof pipelineState?.unlocked?.step3 === 'boolean' ? pipelineState.unlocked.step3 : false,
    step4:
      typeof pipelineState?.unlocked?.step4 === 'boolean' ? pipelineState.unlocked.step4 : false,
  },
  approved: {
    step1:
      typeof pipelineState?.approved?.step1 === 'boolean' ? pipelineState.approved.step1 : false,
    step2:
      typeof pipelineState?.approved?.step2 === 'boolean' ? pipelineState.approved.step2 : false,
    step3:
      typeof pipelineState?.approved?.step3 === 'boolean' ? pipelineState.approved.step3 : false,
    step4:
      typeof pipelineState?.approved?.step4 === 'boolean' ? pipelineState.approved.step4 : false,
  },
})

const normalizeStep03TaskState = (step03TaskState) => ({
  modelTaskId: String(step03TaskState?.modelTaskId || '').trim(),
  rigTaskId: String(step03TaskState?.rigTaskId || '').trim(),
  animateTaskId: String(step03TaskState?.animateTaskId || '').trim(),
})

const normalizeDevSettings = (devSettings) => ({
  portraitAspectRatio: devSettings?.portraitAspectRatio || '1:1',
  portraitPromptPreset: devSettings?.portraitPromptPreset || '',
  autoMultiviewAfterPortrait:
    typeof devSettings?.autoMultiviewAfterPortrait === 'boolean'
      ? devSettings.autoMultiviewAfterPortrait
      : true,
  spriteSize: Number(devSettings?.spriteSize) || 64,
  tripoAnimationMode: devSettings?.tripoAnimationMode === 'static' ? 'static' : 'animated',
  tripoRetargetAnimationName: String(devSettings?.tripoRetargetAnimationName || ''),
  tripoMeshQuality: devSettings?.tripoMeshQuality === 'detailed' ? 'detailed' : 'standard',
  tripoTextureQuality: devSettings?.tripoTextureQuality === 'detailed' ? 'detailed' : 'standard',
  tripoFaceLimit: String(devSettings?.tripoFaceLimit ?? '').trim(),
  defaultSpritesEnabled: Boolean(devSettings?.defaultSpritesEnabled),
})

const openDatabase = () => {
  if (!canUseIndexedDb()) {
    return Promise.resolve(null)
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const database = request.result

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME)
      }
    }
  })
}

const runTransaction = async (mode, executor) => {
  const database = await openDatabase()
  if (!database) {
    return null
  }

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode)
    const store = transaction.objectStore(STORE_NAME)

    transaction.onerror = () => reject(transaction.error)
    transaction.oncomplete = () => {
      database.close()
    }

    executor(store, resolve, reject)
  })
}

export const loadPersistedSession = () => {
  if (!canUseStorage()) {
    return null
  }

  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY)
    if (!rawValue) {
      return null
    }

    const parsed = JSON.parse(rawValue)
    return {
      prompt: parsed?.prompt || '',
      multiviewPrompt: normalizeMultiviewPromptValue(parsed?.multiviewPrompt),
      devSettings: normalizeDevSettings(parsed?.devSettings),
      portraitResult: normalizePortraitResult(parsed?.portraitResult),
      multiviewResult: normalizeMultiviewResult(parsed?.multiviewResult),
      spriteResult: normalizeSpriteResult(parsed?.spriteResult),
      currentRunId: parsed?.currentRunId || '',
      history: Array.isArray(parsed?.history)
        ? parsed.history.map(normalizeHistoryEntry)
        : [],
      tripoJob: normalizeTripoJob(parsed?.tripoJob),
      pipelineState: normalizePipelineState(parsed?.pipelineState),
      step03TaskState: normalizeStep03TaskState(parsed?.step03TaskState),
    }
  } catch {
    return null
  }
}

export const loadPersistedRichSession = async () => {
  try {
    const payload = await runTransaction('readonly', (store, resolve, reject) => {
      const request = store.get(STORE_KEY)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result || null)
    })

    if (!payload) {
      return null
    }

    return {
      prompt: payload.prompt || '',
      multiviewPrompt: normalizeMultiviewPromptValue(payload.multiviewPrompt),
      devSettings: normalizeDevSettings(payload.devSettings),
      portraitResult: normalizePortraitResult(payload.portraitResult),
      multiviewResult: normalizeMultiviewResult(payload.multiviewResult),
      spriteResult: normalizeSpriteResult(payload.spriteResult),
      currentRunId: payload.currentRunId || '',
      history: Array.isArray(payload.history)
        ? payload.history.map((entry) => ({
            ...normalizeHistoryEntry(entry),
            portraitUrl: entry?.portraitUrl || '',
            multiview: entry?.multiview || null,
          }))
        : [],
      tripoJob: normalizeTripoJob(payload.tripoJob),
      pipelineState: normalizePipelineState(payload.pipelineState),
      step03TaskState: normalizeStep03TaskState(payload.step03TaskState),
    }
  } catch {
    return null
  }
}

export const savePersistedSession = ({
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
  step03TaskState,
}) => {
  if (!canUseStorage()) {
    return Promise.resolve()
  }

  const richHistory = Array.isArray(history) ? history.slice(0, HISTORY_LIMIT) : []
  const sanitizedHistory = Array.isArray(history)
    ? history.slice(0, HISTORY_LIMIT).map((entry) => ({
        id: entry.id,
        createdAt: entry.createdAt,
        promptSummary: entry.promptSummary,
        inputMode: entry.inputMode,
        tripoTaskId: entry.tripoTaskId,
        tripoStatus: entry.tripoStatus,
        modelUrl: entry.modelUrl,
      }))
    : []

  const minimalPayload = {
    currentRunId: currentRunId || '',
    history: sanitizedHistory,
    tripoJob: normalizeTripoJob(tripoJob),
    pipelineState: normalizePipelineState(pipelineState),
    step03TaskState: normalizeStep03TaskState(step03TaskState),
  }

  const richPayload = {
    prompt: prompt || '',
    multiviewPrompt: multiviewPrompt || '',
    devSettings: normalizeDevSettings(devSettings),
    portraitResult: normalizePortraitResult(portraitResult),
    multiviewResult: normalizeMultiviewResult(multiviewResult),
    spriteResult: normalizeSpriteResult(spriteResult),
    currentRunId: currentRunId || '',
    history: richHistory,
    tripoJob: normalizeTripoJob(tripoJob),
    pipelineState: normalizePipelineState(pipelineState),
    step03TaskState: normalizeStep03TaskState(step03TaskState),
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(richPayload))
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(minimalPayload))
  }

  return runTransaction('readwrite', (store, resolve, reject) => {
    const request = store.put(
      {
        prompt: prompt || '',
        multiviewPrompt: multiviewPrompt || '',
        devSettings: normalizeDevSettings(devSettings),
        portraitResult: normalizePortraitResult(portraitResult),
        multiviewResult: normalizeMultiviewResult(multiviewResult),
        spriteResult: normalizeSpriteResult(spriteResult),
        currentRunId: currentRunId || '',
        history: Array.isArray(history) ? history.slice(0, HISTORY_LIMIT) : [],
        tripoJob: normalizeTripoJob(tripoJob),
        pipelineState: normalizePipelineState(pipelineState),
        step03TaskState: normalizeStep03TaskState(step03TaskState),
      },
      STORE_KEY,
    )

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  }).catch(() => {})
}

export const clearPersistedSession = () => {
  if (!canUseStorage()) {
    return Promise.resolve()
  }

  window.localStorage.removeItem(STORAGE_KEY)

  return runTransaction('readwrite', (store, resolve, reject) => {
    const request = store.delete(STORE_KEY)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  }).catch(() => {})
}
