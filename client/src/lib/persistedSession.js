const STORAGE_KEY = 'ww-character-session-v1'
const DATABASE_NAME = 'ww-character-session-db'
const DATABASE_VERSION = 1
const STORE_NAME = 'session'
const STORE_KEY = 'current'
const HISTORY_LIMIT = 12

const canUseStorage = () => typeof window !== 'undefined' && Boolean(window.localStorage)
const canUseIndexedDb = () => typeof window !== 'undefined' && Boolean(window.indexedDB)

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

const normalizeTripoJob = (job) => ({
  taskId: job?.taskId || '',
  taskType: job?.taskType || '',
  sourceTaskId: job?.sourceTaskId || '',
  status: job?.status || 'idle',
  progress: Number.isFinite(job?.progress) ? job.progress : 0,
  error: job?.error || '',
  outputs: job?.outputs || null,
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

  return {
    animation: spriteResult.animation || 'run',
    spriteSize: Number(spriteResult.spriteSize) || 64,
    directions: spriteResult.directions || null,
  }
}

const normalizeDevSettings = (devSettings) => ({
  portraitAspectRatio: devSettings?.portraitAspectRatio || '1:1',
  portraitPromptPreset: devSettings?.portraitPromptPreset || '',
  spriteSize: Number(devSettings?.spriteSize) || 64,
  tripoAnimationMode: devSettings?.tripoAnimationMode === 'static' ? 'static' : 'animated',
  tripoRetargetAnimationName: String(devSettings?.tripoRetargetAnimationName || ''),
  tripoMeshQuality: devSettings?.tripoMeshQuality === 'detailed' ? 'detailed' : 'standard',
  tripoTextureQuality: devSettings?.tripoTextureQuality === 'detailed' ? 'detailed' : 'standard',
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
      multiviewPrompt: parsed?.multiviewPrompt || '',
      devSettings: normalizeDevSettings(parsed?.devSettings),
      portraitResult: normalizePortraitResult(parsed?.portraitResult),
      multiviewResult: normalizeMultiviewResult(parsed?.multiviewResult),
      spriteResult: normalizeSpriteResult(parsed?.spriteResult),
      currentRunId: parsed?.currentRunId || '',
      history: Array.isArray(parsed?.history)
        ? parsed.history.map(normalizeHistoryEntry)
        : [],
      tripoJob: normalizeTripoJob(parsed?.tripoJob),
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
      multiviewPrompt: payload.multiviewPrompt || '',
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
