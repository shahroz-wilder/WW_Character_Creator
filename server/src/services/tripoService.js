import { normalizeForTripo } from './imageTransformService.js'
import { parseImageDataUrl } from '../utils/dataUrl.js'
import { AppError } from '../utils/errors.js'

const MODEL_VARIANT_PRIORITY = [
  'animation_model',
  'animated_model',
  'rigged_model',
  'pbr_model',
  'model',
  'base_model',
]
const MULTI_ANIMATION_PRESETS = Object.freeze([
  {
    key: 'idle',
    preset: 'preset:biped:wait',
    aliases: ['preset:idle', 'preset:biped:idle'],
    label: 'Idle',
  },
  { key: 'walk', preset: 'preset:walk', aliases: ['preset:biped:walk'], label: 'Walk' },
  { key: 'run', preset: 'preset:run', aliases: ['preset:biped:run'], label: 'Run' },
  { key: 'slash', preset: 'preset:slash', aliases: ['preset:biped:slash'], label: 'Slash' },
])
const MULTI_ANIMATION_VARIANT_PRIORITY = ['animation_model', 'animated_model']
const MULTI_ANIMATION_DEFINITION_BY_TOKEN = Object.freeze(
  MULTI_ANIMATION_PRESETS.reduce((lookup, definition) => {
    lookup[definition.key] = definition
    lookup[definition.preset.toLowerCase()] = definition
    for (const alias of definition.aliases || []) {
      lookup[alias.toLowerCase()] = definition
    }
    return lookup
  }, {}),
)

const MESH_QUALITY_MIN_MODEL_VERSION = 'v3.0-20250812'

const QUALITY_ALIASES = {
  standard: 'standard',
  ultra: 'detailed',
  detailed: 'detailed',
}

const normalizeAnimationToken = (value) => String(value || '').trim().toLowerCase()

const resolveMultiAnimationDefinition = (...candidates) => {
  for (const candidate of candidates) {
    const definition = MULTI_ANIMATION_DEFINITION_BY_TOKEN[normalizeAnimationToken(candidate)]
    if (definition) {
      return definition
    }
  }

  return null
}

const normalizeAnimationPresetList = (value) => {
  const sourceValues = Array.isArray(value) ? value : value ? [value] : []
  const seenValues = new Set()
  const normalizedValues = []

  for (const entry of sourceValues) {
    const preset = String(entry || '').trim()
    if (!preset) {
      continue
    }

    const dedupeKey = preset.toLowerCase()
    if (seenValues.has(dedupeKey)) {
      continue
    }

    seenValues.add(dedupeKey)
    normalizedValues.push(preset)
  }

  return normalizedValues
}

const getRequestedAnimationPresetsFromTaskPayload = (task) => {
  const arrayCandidates = [
    task?.animations,
    task?.input?.animations,
    task?.params?.animations,
    task?.config?.animations,
    task?.meta?.animations,
    task?.request?.animations,
  ]

  for (const candidate of arrayCandidates) {
    const requestedAnimations = normalizeAnimationPresetList(candidate)
    if (requestedAnimations.length > 0) {
      return requestedAnimations
    }
  }

  const singleCandidates = [
    task?.animation,
    task?.input?.animation,
    task?.params?.animation,
    task?.config?.animation,
    task?.meta?.animation,
    task?.request?.animation,
  ]

  for (const candidate of singleCandidates) {
    const requestedAnimations = normalizeAnimationPresetList(candidate)
    if (requestedAnimations.length > 0) {
      return requestedAnimations
    }
  }

  return []
}

const getExpectedAnimationKeys = (requestedAnimations = []) => {
  const requestedKeys = normalizeAnimationPresetList(requestedAnimations)
    .map((preset) => resolveMultiAnimationDefinition(preset)?.key || '')
    .filter(Boolean)

  if (requestedKeys.length > 0) {
    return Array.from(new Set(requestedKeys))
  }

  return MULTI_ANIMATION_PRESETS.map((definition) => definition.key)
}

const isRemoteAssetUrl = (value) => {
  const normalizedValue = String(value || '').trim()
  return Boolean(normalizedValue) && /^(https?:)?\/\//i.test(normalizedValue)
}

const getTaskOutputPayload = (task) => task?.output || task?.outputs || null

const mergeVariantCatalog = (targetCatalog, sourceCatalog) => {
  for (const variant of MODEL_VARIANT_PRIORITY) {
    if (targetCatalog[variant] || !sourceCatalog?.[variant]) {
      continue
    }

    targetCatalog[variant] = sourceCatalog[variant]
  }
}

const collectModelVariantsFromObject = (value) => {
  const variants = {}

  if (!value || typeof value !== 'object') {
    return variants
  }

  for (const variant of MODEL_VARIANT_PRIORITY) {
    const remoteUrl = value?.[variant]
    if (!isRemoteAssetUrl(remoteUrl)) {
      continue
    }

    variants[variant] = String(remoteUrl).trim()
  }

  return variants
}

const extractSingleAnimationRemoteUrl = (value) => {
  if (isRemoteAssetUrl(value)) {
    return String(value).trim()
  }

  if (!value || typeof value !== 'object') {
    return ''
  }

  const candidateUrls = [
    value?.model_url,
    value?.modelUrl,
    value?.download_url,
    value?.downloadUrl,
    value?.file_url,
    value?.fileUrl,
    value?.glb_url,
    value?.glbUrl,
    value?.url,
  ]

  for (const candidateUrl of candidateUrls) {
    if (isRemoteAssetUrl(candidateUrl)) {
      return String(candidateUrl).trim()
    }
  }

  return ''
}

const parseModelVersion = (value) => {
  const match = String(value || '')
    .trim()
    .match(/^v(\d+)\.(\d+)-(\d{8})$/i)

  if (!match) {
    return null
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    buildDate: Number(match[3]),
  }
}

const isModelVersionAtLeast = (value, minimumValue) => {
  const parsedValue = parseModelVersion(value)
  const parsedMinimum = parseModelVersion(minimumValue)

  if (!parsedValue || !parsedMinimum) {
    return false
  }

  if (parsedValue.major !== parsedMinimum.major) {
    return parsedValue.major > parsedMinimum.major
  }

  if (parsedValue.minor !== parsedMinimum.minor) {
    return parsedValue.minor > parsedMinimum.minor
  }

  return parsedValue.buildDate >= parsedMinimum.buildDate
}

const getModelOutputVariants = (task) => collectModelVariantsFromObject(getTaskOutputPayload(task))

const selectModelVariantFromVariants = (variants) => {
  for (const variant of MODEL_VARIANT_PRIORITY) {
    const remoteUrl = variants?.[variant]
    if (remoteUrl) {
      return { variant, remoteUrl }
    }
  }

  return null
}

export const selectModelVariant = (task) =>
  selectModelVariantFromVariants(getModelOutputVariants(task))

const getSourceTaskIdFromTask = (task) => {
  const candidates = [
    task?.original_model_task_id,
    task?.originalModelTaskId,
    task?.input?.original_model_task_id,
    task?.input?.originalModelTaskId,
    task?.params?.original_model_task_id,
    task?.config?.original_model_task_id,
    task?.meta?.original_model_task_id,
  ]

  const sourceTaskId = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim())
  return sourceTaskId ? sourceTaskId.trim() : ''
}

const parseAnimationModeOverride = (animationMode) => {
  const normalizedValue = String(animationMode || '').trim().toLowerCase()

  if (normalizedValue === 'animated') {
    return true
  }

  if (normalizedValue === 'static') {
    return false
  }

  return null
}

const normalizeAnimationModeParam = (animationMode) => {
  const normalizedValue = String(animationMode || '').trim().toLowerCase()

  if (normalizedValue === 'animated' || normalizedValue === 'static') {
    return normalizedValue
  }

  return ''
}

const buildModelProxyUrl = ({ taskId, variant, animationMode, animationKey = '' }) => {
  const params = [`variant=${encodeURIComponent(variant)}`]
  const normalizedAnimationMode = normalizeAnimationModeParam(animationMode)

  if (normalizedAnimationMode) {
    params.push(`animationMode=${encodeURIComponent(normalizedAnimationMode)}`)
  }

  if (animationKey) {
    params.push(`animationKey=${encodeURIComponent(animationKey)}`)
  }

  return `/api/tripo/tasks/${taskId}/model?${params.join('&')}`
}

const buildVariantProxyCatalog = ({ taskId, variantCatalog, animationMode, animationKey = '' }) => {
  const variantUrls = {}

  for (const variant of MODEL_VARIANT_PRIORITY) {
    if (!variantCatalog?.[variant]) {
      continue
    }

    variantUrls[variant] = buildModelProxyUrl({
      taskId,
      variant,
      animationMode,
      animationKey,
    })
  }

  return variantUrls
}

const extractAnimationVariantCatalogFromValue = (value, forcedVariant = '') => {
  const variantCatalog = {}

  if (forcedVariant && isRemoteAssetUrl(value)) {
    variantCatalog[forcedVariant] = String(value).trim()
    return variantCatalog
  }

  mergeVariantCatalog(variantCatalog, collectModelVariantsFromObject(value))
  mergeVariantCatalog(variantCatalog, collectModelVariantsFromObject(value?.output))
  mergeVariantCatalog(variantCatalog, collectModelVariantsFromObject(value?.outputs))
  mergeVariantCatalog(variantCatalog, collectModelVariantsFromObject(value?.variants))
  mergeVariantCatalog(variantCatalog, collectModelVariantsFromObject(value?.result))

  const explicitVariant = String(value?.variant || value?.model_variant || '').trim()
  const explicitUrl = extractSingleAnimationRemoteUrl(value)
  if (MODEL_VARIANT_PRIORITY.includes(explicitVariant) && explicitUrl && !variantCatalog[explicitVariant]) {
    variantCatalog[explicitVariant] = explicitUrl
  }

  if (forcedVariant && !variantCatalog[forcedVariant]) {
    const forcedUrl = extractSingleAnimationRemoteUrl(value)
    if (forcedUrl) {
      variantCatalog[forcedVariant] = forcedUrl
    }
  }

  if (!variantCatalog.animation_model && !variantCatalog.animated_model) {
    const fallbackUrl = extractSingleAnimationRemoteUrl(value)
    if (fallbackUrl) {
      variantCatalog.animation_model = fallbackUrl
    }
  }

  return variantCatalog
}

const recordAnimationVariantCatalog = (catalogByKey, definition, variantCatalog) => {
  if (!definition || !variantCatalog || Object.keys(variantCatalog).length === 0) {
    return
  }

  const currentCatalog = catalogByKey[definition.key] || {}
  mergeVariantCatalog(currentCatalog, variantCatalog)
  catalogByKey[definition.key] = currentCatalog
}

const buildBundledAnimationCatalog = ({
  taskId,
  requestedAnimations = [],
  animationMode,
  sharedVariantCatalog,
}) => {
  const normalizedRequestedAnimations = normalizeAnimationPresetList(requestedAnimations)
  if (normalizedRequestedAnimations.length <= 1) {
    return null
  }

  const expectedAnimationKeys = getExpectedAnimationKeys(normalizedRequestedAnimations)
  const selectedOutput = selectModelVariantFromVariants(sharedVariantCatalog)
  if (!selectedOutput) {
    return null
  }

  const bundledAnimationCatalog = {}

  expectedAnimationKeys.forEach((animationKey, clipIndex) => {
    const definition = resolveMultiAnimationDefinition(animationKey)
    if (!definition) {
      return
    }

    const variantUrls = buildVariantProxyCatalog({
      taskId,
      variantCatalog: sharedVariantCatalog,
      animationMode,
      animationKey: definition.key,
    })
    const selectedVariantUrl =
      variantUrls[selectedOutput.variant] ||
      buildModelProxyUrl({
        taskId,
        variant: selectedOutput.variant,
        animationMode,
        animationKey: definition.key,
      })

    bundledAnimationCatalog[definition.key] = {
      key: definition.key,
      preset: definition.preset,
      label: definition.label,
      variant: selectedOutput.variant,
      modelUrl: selectedVariantUrl,
      downloadUrl: selectedVariantUrl,
      variants: variantUrls,
      remoteVariants: sharedVariantCatalog,
      clipIndex,
    }
  })

  return Object.keys(bundledAnimationCatalog).length > 0 ? bundledAnimationCatalog : null
}

const buildAnimationCatalogFromTask = ({ taskId, task, animationMode, requestedAnimations = [] }) => {
  const payload = getTaskOutputPayload(task)
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const animationCatalogByKey = {}
  const taskOutputVariants = getModelOutputVariants(task)

  const processAnimationVariantMap = (value, forcedVariant = '') => {
    if (!value || typeof value !== 'object') {
      return
    }

    for (const [entryKey, entryValue] of Object.entries(value)) {
      const definition = resolveMultiAnimationDefinition(
        entryKey,
        entryValue?.preset,
        entryValue?.animation,
        entryValue?.animation_name,
        entryValue?.animationName,
        entryValue?.name,
        entryValue?.key,
        entryValue?.id,
        entryValue?.label,
      )
      if (!definition) {
        continue
      }

      recordAnimationVariantCatalog(
        animationCatalogByKey,
        definition,
        extractAnimationVariantCatalogFromValue(entryValue, forcedVariant),
      )
    }
  }

  const processAnimationContainer = (value, forcedVariant = '', depth = 0) => {
    if (!value || depth > 2) {
      return
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        const definition = resolveMultiAnimationDefinition(
          entry?.preset,
          entry?.animation,
          entry?.animation_name,
          entry?.animationName,
          entry?.name,
          entry?.key,
          entry?.id,
          entry?.label,
        )
        if (!definition) {
          continue
        }

        recordAnimationVariantCatalog(
          animationCatalogByKey,
          definition,
          extractAnimationVariantCatalogFromValue(entry, forcedVariant),
        )
      }
      return
    }

    if (typeof value !== 'object') {
      return
    }

    for (const [entryKey, entryValue] of Object.entries(value)) {
      if (MODEL_VARIANT_PRIORITY.includes(entryKey) && entryValue && typeof entryValue === 'object') {
        processAnimationVariantMap(entryValue, entryKey)
        continue
      }

      const definition = resolveMultiAnimationDefinition(
        entryKey,
        entryValue?.preset,
        entryValue?.animation,
        entryValue?.animation_name,
        entryValue?.animationName,
        entryValue?.name,
        entryValue?.key,
        entryValue?.id,
        entryValue?.label,
      )

      if (definition) {
        recordAnimationVariantCatalog(
          animationCatalogByKey,
          definition,
          extractAnimationVariantCatalogFromValue(entryValue, forcedVariant),
        )
        continue
      }

      if (entryValue && typeof entryValue === 'object') {
        processAnimationContainer(entryValue, forcedVariant, depth + 1)
      }
    }
  }

  processAnimationContainer(payload?.animations)
  processAnimationContainer(payload?.results)
  processAnimationContainer(payload?.items)
  processAnimationContainer(payload?.animation_models, 'animation_model')
  processAnimationContainer(payload?.animated_models, 'animated_model')

  for (const variant of MULTI_ANIMATION_VARIANT_PRIORITY) {
    if (payload?.[variant] && typeof payload[variant] === 'object') {
      processAnimationVariantMap(payload[variant], variant)
    }
  }

  for (const [entryKey, entryValue] of Object.entries(payload)) {
    const definition = resolveMultiAnimationDefinition(
      entryKey,
      entryValue?.preset,
      entryValue?.animation,
      entryValue?.animation_name,
      entryValue?.animationName,
      entryValue?.name,
      entryValue?.key,
      entryValue?.id,
      entryValue?.label,
    )
    if (!definition) {
      continue
    }

    const forcedVariant =
      MODEL_VARIANT_PRIORITY.find((variant) =>
        entryKey.toLowerCase().includes(variant.toLowerCase()),
      ) || ''

    recordAnimationVariantCatalog(
      animationCatalogByKey,
      definition,
      extractAnimationVariantCatalogFromValue(entryValue, forcedVariant),
    )
  }

  const normalizedAnimationCatalog = {}

  for (const definition of MULTI_ANIMATION_PRESETS) {
    const remoteVariants = animationCatalogByKey[definition.key]
    const selectedOutput = selectModelVariantFromVariants(remoteVariants)
    if (!selectedOutput) {
      continue
    }

    const variantUrls = buildVariantProxyCatalog({
      taskId,
      variantCatalog: remoteVariants,
      animationMode,
      animationKey: definition.key,
    })
    const selectedVariantUrl =
      variantUrls[selectedOutput.variant] ||
      buildModelProxyUrl({
        taskId,
        variant: selectedOutput.variant,
        animationMode,
        animationKey: definition.key,
      })

    normalizedAnimationCatalog[definition.key] = {
      key: definition.key,
      preset: definition.preset,
      label: definition.label,
      variant: selectedOutput.variant,
      modelUrl: selectedVariantUrl,
      downloadUrl: selectedVariantUrl,
      variants: variantUrls,
      remoteVariants,
    }
  }

  if (Object.keys(normalizedAnimationCatalog).length > 0) {
    return normalizedAnimationCatalog
  }

  return buildBundledAnimationCatalog({
    taskId,
    requestedAnimations,
    animationMode,
    sharedVariantCatalog: taskOutputVariants,
  })
}

const selectDefaultAnimationEntryFromCatalog = (animationCatalog, requestedAnimations = []) => {
  if (!animationCatalog || typeof animationCatalog !== 'object') {
    return null
  }

  const requestedKeys = getExpectedAnimationKeys(requestedAnimations)
  const preferredKeys = ['idle', ...requestedKeys.filter((key) => key !== 'idle')]
  for (const key of preferredKeys) {
    if (animationCatalog[key]) {
      return animationCatalog[key]
    }
  }

  return Object.values(animationCatalog)[0] || null
}

const toPublicAnimationCatalog = (animationCatalog) => {
  if (!animationCatalog || typeof animationCatalog !== 'object') {
    return null
  }

  return Object.fromEntries(
    Object.entries(animationCatalog).map(([animationKey, entry]) => [
      animationKey,
      {
        preset: entry.preset,
        label: entry.label,
        variant: entry.variant,
        modelUrl: entry.modelUrl,
        downloadUrl: entry.downloadUrl,
        variants: entry.variants,
        ...(Number.isInteger(entry.clipIndex) ? { clipIndex: entry.clipIndex } : {}),
      },
    ]),
  )
}

const isRequestedMultiAnimationCatalogIncomplete = (requestedAnimations = [], animationCatalog) => {
  const normalizedRequestedAnimations = normalizeAnimationPresetList(requestedAnimations)
  if (normalizedRequestedAnimations.length <= 1) {
    return false
  }

  return !getExpectedAnimationKeys(normalizedRequestedAnimations).every((animationKey) =>
    Boolean(animationCatalog?.[animationKey]?.remoteVariants),
  )
}

const buildUnsupportedMultiAnimationError = (requestedAnimations = []) => {
  const expectedLabels = getExpectedAnimationKeys(requestedAnimations)
    .map((animationKey) => resolveMultiAnimationDefinition(animationKey)?.label || animationKey)
    .filter(Boolean)

  return new AppError(
    `Multi-animation retarget finished but did not return distinct assets for ${expectedLabels.join(', ')}.`,
    502,
  )
}

const ANIMATION_TASK_GROUP_ID_PREFIX = 'animate-group_'

const encodeAnimationTaskGroupId = ({
  taskType = 'animate_retarget',
  sourceTaskId = '',
  animationTaskIdsByKey = {},
}) => {
  const normalizedAnimationTaskIdsByKey = Object.fromEntries(
    MULTI_ANIMATION_PRESETS.map((definition) => [
      definition.key,
      typeof animationTaskIdsByKey?.[definition.key] === 'string'
        ? animationTaskIdsByKey[definition.key].trim()
        : '',
    ]).filter(([, taskId]) => Boolean(taskId)),
  )

  if (Object.keys(normalizedAnimationTaskIdsByKey).length === 0) {
    return ''
  }

  const payload = {
    version: 1,
    taskType: String(taskType || 'animate_retarget')
      .trim()
      .toLowerCase(),
    sourceTaskId: String(sourceTaskId || '').trim(),
    animationTaskIdsByKey: normalizedAnimationTaskIdsByKey,
  }

  return `${ANIMATION_TASK_GROUP_ID_PREFIX}${Buffer.from(
    JSON.stringify(payload),
    'utf8',
  ).toString('base64url')}`
}

const decodeAnimationTaskGroupId = (taskId) => {
  const normalizedTaskId = String(taskId || '').trim()
  if (!normalizedTaskId.startsWith(ANIMATION_TASK_GROUP_ID_PREFIX)) {
    return null
  }

  try {
    const payload = JSON.parse(
      Buffer.from(
        normalizedTaskId.slice(ANIMATION_TASK_GROUP_ID_PREFIX.length),
        'base64url',
      ).toString('utf8'),
    )
    const normalizedAnimationTaskIdsByKey = Object.fromEntries(
      MULTI_ANIMATION_PRESETS.map((definition) => [
        definition.key,
        typeof payload?.animationTaskIdsByKey?.[definition.key] === 'string'
          ? payload.animationTaskIdsByKey[definition.key].trim()
          : '',
      ]).filter(([, animationTaskId]) => Boolean(animationTaskId)),
    )

    if (Object.keys(normalizedAnimationTaskIdsByKey).length === 0) {
      return null
    }

    return {
      taskType: String(payload?.taskType || 'animate_retarget')
        .trim()
        .toLowerCase(),
      sourceTaskId: String(payload?.sourceTaskId || '').trim(),
      animationTaskIdsByKey: normalizedAnimationTaskIdsByKey,
    }
  } catch {
    return null
  }
}

const getRequestedAnimationPresetsFromAnimationTaskMap = (animationTaskIdsByKey = {}) =>
  MULTI_ANIMATION_PRESETS.map((definition) =>
    animationTaskIdsByKey?.[definition.key] ? definition.preset : '',
  ).filter(Boolean)

const buildAnimationCatalogFromTaskSummaries = (animationTaskSummaries = []) => {
  const animationCatalog = {}

  for (const [animationKey, taskSummary] of animationTaskSummaries) {
    const definition = resolveMultiAnimationDefinition(animationKey)
    if (!definition || !taskSummary?.outputs || typeof taskSummary.outputs !== 'object') {
      continue
    }

    const variant =
      String(taskSummary.outputs.variant || '').trim() ||
      Object.keys(taskSummary.outputs.variants || {}).find((key) => Boolean(taskSummary.outputs.variants?.[key])) ||
      ''
    const variants =
      taskSummary.outputs.variants && typeof taskSummary.outputs.variants === 'object'
        ? taskSummary.outputs.variants
        : null
    const modelUrl =
      String(taskSummary.outputs.modelUrl || '').trim() ||
      String(taskSummary.outputs.downloadUrl || '').trim() ||
      (variant && variants?.[variant] ? variants[variant] : '')
    const downloadUrl =
      String(taskSummary.outputs.downloadUrl || '').trim() || modelUrl

    if (!modelUrl && !downloadUrl && (!variants || Object.keys(variants).length === 0)) {
      continue
    }

    animationCatalog[definition.key] = {
      key: definition.key,
      preset: definition.preset,
      label: definition.label,
      variant,
      modelUrl,
      downloadUrl,
      variants,
    }
  }

  return Object.keys(animationCatalog).length > 0 ? animationCatalog : null
}

const getAnimationTaskSummaryStatus = (taskSummary) =>
  String(taskSummary?.status || 'unknown')
    .trim()
    .toLowerCase()

const summarizeAnimationTaskGroupStatus = (animationTaskSummaries = []) => {
  const statuses = animationTaskSummaries.map(([, taskSummary]) => getAnimationTaskSummaryStatus(taskSummary))
  if (statuses.length === 0) {
    return 'unknown'
  }

  if (statuses.every((status) => status === 'success')) {
    return 'success'
  }

  if (statuses.some((status) => status === 'failed')) {
    return 'failed'
  }

  if (statuses.every((status) => status === 'queued')) {
    return 'queued'
  }

  if (statuses.some((status) => status === 'queued' || status === 'running' || status === 'success')) {
    return 'running'
  }

  return statuses[0] || 'unknown'
}

const summarizeAnimationTaskGroupProgress = (animationTaskSummaries = []) => {
  if (animationTaskSummaries.length === 0) {
    return 0
  }

  const progressTotal = animationTaskSummaries.reduce(
    (total, [, taskSummary]) => total + (Number(taskSummary?.progress) || 0),
    0,
  )

  return Math.round(progressTotal / animationTaskSummaries.length)
}

const buildAnimationTaskGroupError = (animationTaskSummaries = []) =>
  animationTaskSummaries
    .filter(([, taskSummary]) => getAnimationTaskSummaryStatus(taskSummary) === 'failed')
    .map(([animationKey, taskSummary]) => {
      const label = resolveMultiAnimationDefinition(animationKey)?.label || animationKey
      return `${label}: ${String(taskSummary?.error || 'Task failed.').trim()}`
    })
    .filter(Boolean)
    .join(' ')

const buildTaskSummary = ({
  taskId,
  task,
  animationMode,
  variantCatalog,
  animationCatalog = null,
  requestedAnimations = [],
  sourceTaskId = '',
}) => {
  const selectedModelOutput = selectModelVariant(task) || selectModelVariantFromVariants(variantCatalog)
  const selectedAnimationEntry = selectDefaultAnimationEntryFromCatalog(
    animationCatalog,
    requestedAnimations,
  )
  const variantUrls = buildVariantProxyCatalog({
    taskId,
    variantCatalog,
    animationMode,
  })
  const rawPreRigOutput = task?.output || task?.outputs || null
  const preRigCheckOutput =
    task?.type === 'animate_prerigcheck' && rawPreRigOutput
      ? {
          riggable:
            typeof rawPreRigOutput.riggable === 'boolean'
              ? rawPreRigOutput.riggable
              : rawPreRigOutput.riggable === 1
                ? true
                : rawPreRigOutput.riggable === 0
                  ? false
                  : null,
          rigType: rawPreRigOutput.rig_type || rawPreRigOutput.rigType || '',
        }
      : null
  const publicAnimationCatalog = toPublicAnimationCatalog(animationCatalog)
  const outputVariants = selectedAnimationEntry
    ? {
        ...variantUrls,
        ...(selectedAnimationEntry.variants || {}),
      }
    : variantUrls
  const selectedVariant = selectedAnimationEntry?.variant || selectedModelOutput?.variant || ''
  const selectedVariantUrl = selectedAnimationEntry
    ? selectedAnimationEntry.modelUrl
    : selectedVariant
      ? variantUrls[selectedVariant] ||
        buildModelProxyUrl({
          taskId,
          variant: selectedVariant,
          animationMode,
        })
      : null

  return {
    taskId,
    taskType: task?.type || '',
    sourceTaskId: sourceTaskId || getSourceTaskIdFromTask(task),
    status: task?.status || 'unknown',
    progress: task?.progress ?? 0,
    error: task?.error_msg || null,
    requestedAnimations: normalizeAnimationPresetList(requestedAnimations),
    outputs: selectedVariant
      ? {
          modelUrl: selectedVariantUrl,
          downloadUrl: selectedAnimationEntry?.downloadUrl || selectedVariantUrl,
          variant: selectedVariant,
          variants: outputVariants,
          ...(publicAnimationCatalog ? { animations: publicAnimationCatalog } : {}),
          ...(preRigCheckOutput ? { preRigCheck: preRigCheckOutput } : {}),
        }
      : preRigCheckOutput
        ? {
            preRigCheck: preRigCheckOutput,
          }
        : null,
  }
}

export const createTripoService = ({ tripoClient, config, taskAuditLogger = null }) => {
  const rigTaskBySourceTaskId = new Map()
  const sourceTaskByRigTaskId = new Map()
  const rigTaskStartPromises = new Map()
  const rigEnabledByTaskId = new Map()
  const animationTaskByRequestKey = new Map()
  const sourceTaskByAnimationTaskId = new Map()
  const requestedAnimationsByAnimationTaskId = new Map()
  const animationTaskStartPromises = new Map()
  const animationEnabledByTaskId = new Map()

  const isMixamoRiggingEnabled = Boolean(config.tripoRigMixamo)
  const isIdleAnimationEnabled = Boolean(config.tripoIdleAnimationEnabled)

  const getLinkedSourceTaskId = (taskId, task) => {
    if (sourceTaskByAnimationTaskId.has(taskId)) {
      return sourceTaskByAnimationTaskId.get(taskId)
    }

    if (sourceTaskByRigTaskId.has(taskId)) {
      return sourceTaskByRigTaskId.get(taskId)
    }

    return getSourceTaskIdFromTask(task)
  }

  const resolveSourceTaskId = async (taskId, task) => {
    const linkedSourceTaskId = getLinkedSourceTaskId(taskId, task)
    if (linkedSourceTaskId) {
      return linkedSourceTaskId
    }

    if (typeof taskAuditLogger?.findSubmissionByTaskId !== 'function') {
      return ''
    }

    try {
      const submissionEntry = await taskAuditLogger.findSubmissionByTaskId(taskId)
      const auditSourceTaskId = String(submissionEntry?.requestBody?.original_model_task_id || '').trim()
      if (auditSourceTaskId) {
        sourceTaskByAnimationTaskId.set(taskId, auditSourceTaskId)
        return auditSourceTaskId
      }
    } catch {
      return ''
    }

    return ''
  }

  const resolveRequestedAnimationPresets = async (taskId, task) => {
    if (requestedAnimationsByAnimationTaskId.has(taskId)) {
      return requestedAnimationsByAnimationTaskId.get(taskId)
    }

    const taskRequestedAnimations = getRequestedAnimationPresetsFromTaskPayload(task)
    if (taskRequestedAnimations.length > 0) {
      requestedAnimationsByAnimationTaskId.set(taskId, taskRequestedAnimations)
      return taskRequestedAnimations
    }

    if (typeof taskAuditLogger?.findSubmissionByTaskId !== 'function') {
      return []
    }

    try {
      const submissionEntry = await taskAuditLogger.findSubmissionByTaskId(taskId)
      const requestedAnimations =
        getRequestedAnimationPresetsFromTaskPayload(submissionEntry?.requestBody) ||
        normalizeAnimationPresetList(submissionEntry?.requestBody?.animation)

      if (requestedAnimations.length > 0) {
        requestedAnimationsByAnimationTaskId.set(taskId, requestedAnimations)
        return requestedAnimations
      }
    } catch {
      return []
    }

    return []
  }

  const collectVariantCatalog = async (taskId, task) => {
    const variantCatalog = {}
    const visitedTaskIds = new Set()
    const queue = [{ taskId, task }]

    while (queue.length > 0 && visitedTaskIds.size < 4) {
      const current = queue.shift()
      if (!current?.taskId || !current?.task || visitedTaskIds.has(current.taskId)) {
        continue
      }

      visitedTaskIds.add(current.taskId)
      mergeVariantCatalog(variantCatalog, getModelOutputVariants(current.task))

      const sourceTaskId = getLinkedSourceTaskId(current.taskId, current.task)
      if (!sourceTaskId || visitedTaskIds.has(sourceTaskId)) {
        continue
      }

      try {
        const sourceTask = await tripoClient.getTask(sourceTaskId)
        if (sourceTask) {
          queue.push({ taskId: sourceTaskId, task: sourceTask })
        }
      } catch {
        // Best effort lookup: keep available variants from already resolved tasks.
      }
    }

    return variantCatalog
  }

  const resolveAnimationPreference = (animationMode) => {
    const override = parseAnimationModeOverride(animationMode)
    return override === null ? isIdleAnimationEnabled : override
  }

  const resolveRigPreference = (animationMode, shouldAnimate) => {
    const override = parseAnimationModeOverride(animationMode)

    if (override !== null) {
      return override
    }

    if (shouldAnimate) {
      return true
    }

    return isMixamoRiggingEnabled
  }

  const getRigEnabledForTask = (taskId, animationMode) => {
    const override = parseAnimationModeOverride(animationMode)
    if (override !== null) {
      return override
    }

    if (rigEnabledByTaskId.has(taskId)) {
      return rigEnabledByTaskId.get(taskId)
    }

    return isMixamoRiggingEnabled
  }

  const getAnimationEnabledForTask = (taskId, animationMode) => {
    const override = parseAnimationModeOverride(animationMode)
    if (override !== null) {
      return override
    }

    if (animationEnabledByTaskId.has(taskId)) {
      return animationEnabledByTaskId.get(taskId)
    }

    return isIdleAnimationEnabled
  }

  const rememberRigTask = (sourceTaskId, rigTaskId) => {
    rigTaskBySourceTaskId.set(sourceTaskId, rigTaskId)
    sourceTaskByRigTaskId.set(rigTaskId, sourceTaskId)
    rigEnabledByTaskId.set(rigTaskId, true)
    animationEnabledByTaskId.set(rigTaskId, getAnimationEnabledForTask(sourceTaskId))
  }

  const ensureRigTaskForSource = async (sourceTaskId) => {
    const existingRigTaskId = rigTaskBySourceTaskId.get(sourceTaskId)
    if (existingRigTaskId) {
      return existingRigTaskId
    }

    const inFlightPromise = rigTaskStartPromises.get(sourceTaskId)
    if (inFlightPromise) {
      return inFlightPromise
    }

    const startPromise = tripoClient
      .createRigTask({
        originalModelTaskId: sourceTaskId,
        outFormat: config.tripoRigFormat,
        rigType: config.tripoRigType,
        spec: config.tripoRigSpec,
        modelVersion: config.tripoRigModelVersion,
      })
      .then((rigTaskId) => {
        rememberRigTask(sourceTaskId, rigTaskId)
        rigTaskStartPromises.delete(sourceTaskId)
        return rigTaskId
      })
      .catch((error) => {
        rigTaskStartPromises.delete(sourceTaskId)
        throw error
      })

    rigTaskStartPromises.set(sourceTaskId, startPromise)
    return startPromise
  }

  const rememberAnimationTask = (sourceTaskId, animationTaskId, requestedAnimations = []) => {
    sourceTaskByAnimationTaskId.set(animationTaskId, sourceTaskId)
    requestedAnimationsByAnimationTaskId.set(
      animationTaskId,
      normalizeAnimationPresetList(requestedAnimations),
    )
    animationEnabledByTaskId.set(animationTaskId, true)
  }

  const resolveAnimationTaskOptions = (overrides = {}) => {
    const taskType = String(overrides.taskType || config.tripoIdleAnimationTaskType || 'animate_model')
      .trim()
      .toLowerCase()
    const animations = normalizeAnimationPresetList(overrides.animations)
    const animation =
      animations.length === 0
        ? String(overrides.animation || '').trim() || config.tripoIdleAnimationName
        : ''
    const animateInPlace =
      taskType === 'animate_retarget'
        ? typeof overrides.animateInPlace === 'boolean'
          ? overrides.animateInPlace
          : config.tripoIdleAnimationInPlace
        : null

    return {
      taskType: taskType || 'animate_model',
      animation,
      animations,
      animateInPlace,
    }
  }

  const buildAnimationTaskRequestKey = (sourceTaskId, animationTaskOptions) =>
    JSON.stringify([
      sourceTaskId,
      animationTaskOptions.taskType,
      animationTaskOptions.animations.length > 0
        ? animationTaskOptions.animations
        : animationTaskOptions.animation,
      animationTaskOptions.animateInPlace,
    ])

  const ensureAnimationTaskForSource = async (sourceTaskId, overrides = {}) => {
    const animationTaskOptions = resolveAnimationTaskOptions(overrides)
    const requestKey = buildAnimationTaskRequestKey(sourceTaskId, animationTaskOptions)
    const existingAnimationTaskId = animationTaskByRequestKey.get(requestKey)
    if (existingAnimationTaskId) {
      return existingAnimationTaskId
    }

    const inFlightPromise = animationTaskStartPromises.get(requestKey)
    if (inFlightPromise) {
      return inFlightPromise
    }

    const startPromise = tripoClient
      .createAnimationTask({
        originalModelTaskId: sourceTaskId,
        animation: animationTaskOptions.animation,
        ...(animationTaskOptions.animations.length > 0
          ? { animations: animationTaskOptions.animations }
          : {}),
        taskType: animationTaskOptions.taskType,
        animateInPlace: animationTaskOptions.animateInPlace,
      })
      .then((animationTaskId) => {
        animationTaskByRequestKey.set(requestKey, animationTaskId)
        rememberAnimationTask(
          sourceTaskId,
          animationTaskId,
          animationTaskOptions.animations.length > 0
            ? animationTaskOptions.animations
            : animationTaskOptions.animation,
        )
        animationTaskStartPromises.delete(requestKey)
        return animationTaskId
      })
      .catch((error) => {
        animationTaskStartPromises.delete(requestKey)
        throw error
      })

    animationTaskStartPromises.set(requestKey, startPromise)
    return startPromise
  }

  const loadTaskOrThrow = async (taskId) => {
    const task = await tripoClient.getTask(taskId)

    if (!task) {
      throw new AppError('Tripo task could not be found.', 404)
    }

    return task
  }

  const summarizeTaskStart = async (taskId, sourceTaskId = '') => {
    let task = null

    try {
      task = await tripoClient.getTask(taskId)
    } catch {
      // Best effort: new tasks may not be readable immediately.
    }

    return {
      taskId,
      taskType: task?.type || '',
      sourceTaskId: sourceTaskId || getSourceTaskIdFromTask(task),
      status: task?.status || 'queued',
      progress: task?.progress ?? 0,
      error: task?.error_msg || '',
    }
  }

  const resolveTaskForOutput = async (taskId, { animationMode } = {}) => {
    let resolvedTaskId = taskId
    let task = await tripoClient.getTask(taskId)
    const normalizedTaskType = String(task?.type || '')
      .trim()
      .toLowerCase()
    const isRigTask = sourceTaskByRigTaskId.has(taskId) || normalizedTaskType === 'animate_rig'
    const isAnimationTask =
      sourceTaskByAnimationTaskId.has(taskId) ||
      normalizedTaskType === 'animate_retarget' ||
      normalizedTaskType === 'animate_model'

    const shouldRig = getRigEnabledForTask(taskId, animationMode)
    if (!isAnimationTask && shouldRig && !isRigTask && task?.status === 'success') {
      const rigTaskId = await ensureRigTaskForSource(taskId)
      resolvedTaskId = rigTaskId
      task = await tripoClient.getTask(rigTaskId)
    }

    const shouldAnimate = getAnimationEnabledForTask(resolvedTaskId, animationMode)
    if (isAnimationTask || !shouldAnimate || task?.status !== 'success') {
      return { taskId: resolvedTaskId, task }
    }

    try {
      const animationTaskId = await ensureAnimationTaskForSource(resolvedTaskId)
      const animationTask = await tripoClient.getTask(animationTaskId)
      return { taskId: animationTaskId, task: animationTask }
    } catch {
      // Keep rig/base task output when animation task cannot be created.
      return { taskId: resolvedTaskId, task }
    }
  }

  const getTaskSummaryInternal = async (taskId, { animationMode } = {}) => {
    const resolvedTask = await resolveTaskForOutput(taskId, { animationMode })
    const variantCatalog = await collectVariantCatalog(resolvedTask.taskId, resolvedTask.task)
    const sourceTaskId = await resolveSourceTaskId(resolvedTask.taskId, resolvedTask.task)
    const requestedAnimations = await resolveRequestedAnimationPresets(
      resolvedTask.taskId,
      resolvedTask.task,
    )
    const animationCatalog = buildAnimationCatalogFromTask({
      taskId: resolvedTask.taskId,
      task: resolvedTask.task,
      animationMode,
      requestedAnimations,
    })

    if (
      resolvedTask.task?.status === 'success' &&
      isRequestedMultiAnimationCatalogIncomplete(requestedAnimations, animationCatalog)
    ) {
      throw buildUnsupportedMultiAnimationError(requestedAnimations)
    }

    return buildTaskSummary({
      ...resolvedTask,
      animationMode,
      variantCatalog,
      animationCatalog,
      requestedAnimations,
      sourceTaskId,
    })
  }

  const getAnimationTaskGroupSummary = async (groupTaskId, groupTaskMeta, { animationMode } = {}) => {
    const orderedAnimationTaskEntries = MULTI_ANIMATION_PRESETS.map((definition) => [
      definition.key,
      groupTaskMeta.animationTaskIdsByKey?.[definition.key] || '',
    ]).filter(([, animationTaskId]) => Boolean(animationTaskId))

    const animationTaskSummaries = await Promise.all(
      orderedAnimationTaskEntries.map(async ([animationKey, animationTaskId]) => [
        animationKey,
        await getTaskSummaryInternal(animationTaskId, { animationMode }),
      ]),
    )

    const requestedAnimations = getRequestedAnimationPresetsFromAnimationTaskMap(
      groupTaskMeta.animationTaskIdsByKey,
    )
    const animationCatalog = buildAnimationCatalogFromTaskSummaries(animationTaskSummaries)
    const groupStatus = summarizeAnimationTaskGroupStatus(animationTaskSummaries)
    const groupProgress = summarizeAnimationTaskGroupProgress(animationTaskSummaries)
    const groupError = buildAnimationTaskGroupError(animationTaskSummaries)
    const fallbackSourceTaskId =
      groupTaskMeta.sourceTaskId ||
      animationTaskSummaries.find(([, taskSummary]) => Boolean(taskSummary?.sourceTaskId))?.[1]
        ?.sourceTaskId ||
      ''

    return buildTaskSummary({
      taskId: groupTaskId,
      task: {
        type: groupTaskMeta.taskType || 'animate_retarget',
        status: groupStatus,
        progress: groupProgress,
        error_msg: groupError || null,
      },
      animationMode,
      variantCatalog: {},
      animationCatalog,
      requestedAnimations,
      sourceTaskId: fallbackSourceTaskId,
    })
  }

  const getModelAssetInternal = async (taskId, requestedVariant, { animationMode, animationKey } = {}) => {
    const resolvedTask = await resolveTaskForOutput(taskId, { animationMode })
    const variantCatalog = await collectVariantCatalog(resolvedTask.taskId, resolvedTask.task)
    const requestedAnimations = await resolveRequestedAnimationPresets(
      resolvedTask.taskId,
      resolvedTask.task,
    )
    const animationCatalog = buildAnimationCatalogFromTask({
      taskId: resolvedTask.taskId,
      task: resolvedTask.task,
      animationMode,
      requestedAnimations,
    })

    if (
      resolvedTask.task?.status === 'success' &&
      isRequestedMultiAnimationCatalogIncomplete(requestedAnimations, animationCatalog)
    ) {
      throw buildUnsupportedMultiAnimationError(requestedAnimations)
    }

    const normalizedAnimationKey = resolveMultiAnimationDefinition(animationKey)?.key || ''
    let variantToUse = null

    if (normalizedAnimationKey) {
      const animationEntry = animationCatalog?.[normalizedAnimationKey]
      if (!animationEntry) {
        throw new AppError(
          `${resolveMultiAnimationDefinition(normalizedAnimationKey)?.label || normalizedAnimationKey} animation model is unavailable for this task.`,
          404,
        )
      }

      const selectedAnimationOutput = selectModelVariantFromVariants(animationEntry.remoteVariants)
      variantToUse =
        requestedVariant && animationEntry.remoteVariants?.[requestedVariant]
          ? {
              variant: requestedVariant,
              remoteUrl: animationEntry.remoteVariants[requestedVariant],
            }
          : selectedAnimationOutput
    } else {
      const defaultAnimationEntry = selectDefaultAnimationEntryFromCatalog(
        animationCatalog,
        requestedAnimations,
      )
      if (
        defaultAnimationEntry &&
        (!requestedVariant || defaultAnimationEntry.remoteVariants?.[requestedVariant])
      ) {
        const selectedAnimationOutput = selectModelVariantFromVariants(defaultAnimationEntry.remoteVariants)
        variantToUse =
          requestedVariant && defaultAnimationEntry.remoteVariants?.[requestedVariant]
            ? {
                variant: requestedVariant,
                remoteUrl: defaultAnimationEntry.remoteVariants[requestedVariant],
              }
            : selectedAnimationOutput
      }
    }

    if (!variantToUse) {
      const selectedOutput =
        selectModelVariant(resolvedTask.task) || selectModelVariantFromVariants(variantCatalog)

      if (!selectedOutput) {
        throw new AppError('No model file is available for this task yet.', 404)
      }

      variantToUse =
        requestedVariant && variantCatalog[requestedVariant]
          ? { variant: requestedVariant, remoteUrl: variantCatalog[requestedVariant] }
          : selectedOutput
    }

    if (!variantToUse) {
      throw new AppError('No model file is available for this task yet.', 404)
    }

    return {
      ...variantToUse,
      response: await tripoClient.fetchRemoteAsset(variantToUse.remoteUrl),
    }
  }

const normalizeQuality = (value, fallback = 'standard') => {
  const normalizedValue = String(value || '')
    .trim()
    .toLowerCase()
  return QUALITY_ALIASES[normalizedValue] || QUALITY_ALIASES[fallback] || 'standard'
}

  const normalizeFaceLimit = (value) => {
    if (value === null || value === undefined || value === '') {
      return null
    }

    const parsedValue = Number(value)
    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
      return null
    }

    return Math.floor(parsedValue)
  }

  const buildGenerationOptions = ({ meshQuality, textureQuality, faceLimit } = {}) => {
    const options = {
      model_version: config.tripoModelVersion,
      texture: config.tripoTexture,
      pbr: config.tripoPbr,
      texture_quality: normalizeQuality(textureQuality, config.tripoTextureQuality || 'standard'),
      texture_alignment: config.tripoTextureAlignment,
      orientation: config.tripoOrientation,
    }

    if (isModelVersionAtLeast(config.tripoModelVersion, MESH_QUALITY_MIN_MODEL_VERSION)) {
      options.geometry_quality = normalizeQuality(meshQuality, config.tripoMeshQuality || 'standard')
    }

    const normalizedFaceLimit = normalizeFaceLimit(faceLimit)
    if (normalizedFaceLimit !== null) {
      options.face_limit = normalizedFaceLimit
    }

    return options
  }

  const uploadOrderedViews = async (viewDataUrls, orderedViewNames) => {
    const uploadedFiles = []

    for (const viewName of orderedViewNames) {
      const imageDataUrl = viewDataUrls?.[viewName]
      if (!imageDataUrl) {
        throw new AppError(`Missing ${viewName} image for Tripo generation.`, 400)
      }

      const { buffer } = parseImageDataUrl(imageDataUrl)
      const normalizedBuffer = await normalizeForTripo(buffer)
      const uploadToken = await tripoClient.uploadImageBuffer(normalizedBuffer, 'image/jpeg')
      uploadedFiles.push(uploadToken)
    }

    return uploadedFiles
  }

  return {
    async createTaskFromViews(
      viewDataUrls,
      { animationMode, meshQuality, textureQuality, faceLimit } = {},
    ) {
      // Tripo multiview slot order is Front, Left, Back, Right.
      const orderedViewNames = ['front', 'left', 'back', 'right']
      const shouldAnimate = resolveAnimationPreference(animationMode)
      const shouldRig = resolveRigPreference(animationMode, shouldAnimate)

      const uploadedFiles = await uploadOrderedViews(viewDataUrls, orderedViewNames)

      const taskId = await tripoClient.createMultiviewTask({
        files: uploadedFiles,
        options: buildGenerationOptions({ meshQuality, textureQuality, faceLimit }),
      })

      rigEnabledByTaskId.set(taskId, shouldRig)
      animationEnabledByTaskId.set(taskId, shouldAnimate)

      return {
        taskId,
        taskType: 'multiview_to_model',
        sourceTaskId: '',
        status: 'queued',
        progress: 0,
        error: '',
      }
    },
    async createTaskFromFrontBackViews(
      viewDataUrls,
      { animationMode, meshQuality, textureQuality, faceLimit } = {},
    ) {
      const orderedViewNames = ['front', 'back']
      const shouldAnimate = resolveAnimationPreference(animationMode)
      const shouldRig = resolveRigPreference(animationMode, shouldAnimate)
      const uploadedFiles = await uploadOrderedViews(viewDataUrls, orderedViewNames)
      const taskId = await tripoClient.createMultiviewTask({
        // Place images into explicit Front, Left, Back, Right slots.
        files: [uploadedFiles[0], {}, uploadedFiles[1], {}],
        options: buildGenerationOptions({ meshQuality, textureQuality, faceLimit }),
      })

      rigEnabledByTaskId.set(taskId, shouldRig)
      animationEnabledByTaskId.set(taskId, shouldAnimate)

      return {
        taskId,
        taskType: 'multiview_to_model',
        sourceTaskId: '',
        status: 'queued',
        progress: 0,
        error: '',
      }
    },
    async createTaskFromFrontView(
      imageDataUrl,
      { animationMode, meshQuality, textureQuality, faceLimit } = {},
    ) {
      if (!imageDataUrl) {
        throw new AppError('Missing front image for Tripo generation.', 400)
      }

      const shouldAnimate = resolveAnimationPreference(animationMode)
      const shouldRig = resolveRigPreference(animationMode, shouldAnimate)
      const { buffer } = parseImageDataUrl(imageDataUrl)
      const normalizedBuffer = await normalizeForTripo(buffer)
      const uploadToken = await tripoClient.uploadImageBuffer(normalizedBuffer, 'image/jpeg')
      const taskId = await tripoClient.createImageTask({
        file: {
          type: 'image',
          file_token: uploadToken.file_token,
        },
        options: buildGenerationOptions({ meshQuality, textureQuality, faceLimit }),
      })

      rigEnabledByTaskId.set(taskId, shouldRig)
      animationEnabledByTaskId.set(taskId, shouldAnimate)

      return {
        taskId,
        taskType: 'image_to_model',
        sourceTaskId: '',
        status: 'queued',
        progress: 0,
        error: '',
      }
    },
    async createRigTask(taskId) {
      if (!taskId) {
        throw new AppError('Provide a Tripo mesh task before rigging.', 400)
      }

      const task = await loadTaskOrThrow(taskId)
      const taskType = String(task?.type || '').trim()

      if (taskType === 'animate_rig') {
        return summarizeTaskStart(taskId, getSourceTaskIdFromTask(task))
      }

      if (taskType === 'animate_retarget') {
        throw new AppError('The current task is already an animation task. Rig from the mesh task instead.', 400)
      }

      if (!['multiview_to_model', 'image_to_model'].includes(taskType)) {
        throw new AppError('Only completed Tripo mesh tasks can be rigged.', 400)
      }

      if (task.status !== 'success') {
        throw new AppError('Wait for the mesh task to finish successfully before rigging.', 400)
      }

      const rigTaskId = await ensureRigTaskForSource(taskId)
      return summarizeTaskStart(rigTaskId, taskId)
    },
    async createPreRigCheckTask(taskId) {
      if (!taskId) {
        throw new AppError('Provide a Tripo mesh task before pre-rig-check.', 400)
      }

      const task = await loadTaskOrThrow(taskId)
      const taskType = String(task?.type || '').trim()

      if (taskType === 'animate_prerigcheck') {
        return summarizeTaskStart(taskId, getSourceTaskIdFromTask(task))
      }

      if (taskType === 'animate_retarget' || taskType === 'animate_model') {
        throw new AppError('Pre-rig-check requires a mesh task. Use the original mesh task id.', 400)
      }

      let sourceTaskId = taskId

      if (taskType === 'animate_rig') {
        sourceTaskId = getSourceTaskIdFromTask(task)
        if (!sourceTaskId) {
          throw new AppError('The current rig task is missing its source mesh task id.', 400)
        }
      } else if (!['multiview_to_model', 'image_to_model'].includes(taskType)) {
        throw new AppError('Only Tripo mesh tasks support pre-rig-check.', 400)
      }

      if (taskType !== 'animate_rig' && task.status !== 'success') {
        throw new AppError('Wait for the mesh task to finish successfully before pre-rig-check.', 400)
      }

      const preRigTaskId = await tripoClient.createPreRigCheckTask({
        originalModelTaskId: sourceTaskId,
      })
      return summarizeTaskStart(preRigTaskId, sourceTaskId)
    },
    async createRetargetTask(taskId, { animationName, animations } = {}) {
      if (!taskId) {
        throw new AppError('Provide a Tripo rig task before retargeting.', 400)
      }

      const task = await loadTaskOrThrow(taskId)
      const taskType = String(task?.type || '').trim()

      let rigTaskId = ''
      let rigTask = task

      if (taskType === 'animate_rig') {
        rigTaskId = taskId
      } else if (taskType === 'animate_retarget' || taskType === 'animate_model') {
        rigTaskId = await resolveSourceTaskId(taskId, task)

        if (!rigTaskId) {
          throw new AppError('The current animation task is missing its source rig task id.', 400)
        }

        rigTask = await loadTaskOrThrow(rigTaskId)
      } else if (['multiview_to_model', 'image_to_model'].includes(taskType)) {
        rigTaskId = rigTaskBySourceTaskId.get(taskId) || ''

        if (!rigTaskId) {
          throw new AppError('Create a rig task first, then run retarget.', 400)
        }

        rigTask = await loadTaskOrThrow(rigTaskId)
      } else {
        throw new AppError('Retarget requires a rigged Tripo task.', 400)
      }

      if (rigTask.status !== 'success') {
        throw new AppError('Wait for the rig task to finish successfully before retargeting.', 400)
      }

      const normalizedRequestedAnimations = normalizeAnimationPresetList(animations)
      const groupedAnimationDefinitions = normalizedRequestedAnimations
        .map((animationPreset) => resolveMultiAnimationDefinition(animationPreset))
        .filter(Boolean)

      if (
        normalizedRequestedAnimations.length > 1 &&
        groupedAnimationDefinitions.length === normalizedRequestedAnimations.length
      ) {
        const animationTaskIdsByKey = {}

        for (const definition of groupedAnimationDefinitions) {
          animationTaskIdsByKey[definition.key] = await ensureAnimationTaskForSource(rigTaskId, {
            taskType: 'animate_retarget',
            animation: definition.preset,
          })
        }

        const groupedTaskId = encodeAnimationTaskGroupId({
          taskType: 'animate_retarget',
          sourceTaskId: rigTaskId,
          animationTaskIdsByKey,
        })

        return {
          taskId: groupedTaskId,
          taskType: 'animate_retarget',
          sourceTaskId: rigTaskId,
          status: 'queued',
          progress: 0,
          error: '',
          requestedAnimations: getRequestedAnimationPresetsFromAnimationTaskMap(animationTaskIdsByKey),
        }
      }

      const animationTaskId = await ensureAnimationTaskForSource(rigTaskId, {
        taskType: 'animate_retarget',
        animation: animationName,
        animations,
      })
      const taskStartSummary = await summarizeTaskStart(animationTaskId, rigTaskId)
      return {
        ...taskStartSummary,
        requestedAnimations: normalizeAnimationPresetList(
          normalizedRequestedAnimations.length > 0 ? normalizedRequestedAnimations : animationName,
        ),
      }
    },
    async getTaskSummary(taskId, { animationMode } = {}) {
      const animationTaskGroupMeta = decodeAnimationTaskGroupId(taskId)
      if (animationTaskGroupMeta) {
        return getAnimationTaskGroupSummary(taskId, animationTaskGroupMeta, { animationMode })
      }

      return getTaskSummaryInternal(taskId, { animationMode })
    },
    async getModelAsset(taskId, requestedVariant, { animationMode, animationKey } = {}) {
      const animationTaskGroupMeta = decodeAnimationTaskGroupId(taskId)
      if (animationTaskGroupMeta) {
        const normalizedAnimationKey = resolveMultiAnimationDefinition(animationKey)?.key || ''
        const selectedAnimationTaskId =
          (normalizedAnimationKey && animationTaskGroupMeta.animationTaskIdsByKey?.[normalizedAnimationKey]) ||
          animationTaskGroupMeta.animationTaskIdsByKey?.idle ||
          Object.values(animationTaskGroupMeta.animationTaskIdsByKey)[0] ||
          ''

        if (!selectedAnimationTaskId) {
          throw new AppError('No model file is available for this grouped animation task yet.', 404)
        }

        return getModelAssetInternal(selectedAnimationTaskId, requestedVariant, {
          animationMode,
        })
      }

      return getModelAssetInternal(taskId, requestedVariant, { animationMode, animationKey })
    },
  }
}
