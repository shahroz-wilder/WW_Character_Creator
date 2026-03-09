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

const MESH_QUALITY_MIN_MODEL_VERSION = 'v3.0-20250812'

const QUALITY_ALIASES = {
  standard: 'standard',
  ultra: 'detailed',
  detailed: 'detailed',
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

const getModelOutputVariants = (task) => {
  const variants = {}

  for (const variant of MODEL_VARIANT_PRIORITY) {
    const remoteUrl = task?.output?.[variant]
    if (!remoteUrl) {
      continue
    }

    variants[variant] = remoteUrl
  }

  return variants
}

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

const buildTaskSummary = ({ taskId, task, animationMode, variantCatalog, sourceTaskId = '' }) => {
  const selectedOutput = selectModelVariant(task) || selectModelVariantFromVariants(variantCatalog)
  const modeParam = normalizeAnimationModeParam(animationMode)
  const animationModeSuffix = modeParam ? `&animationMode=${modeParam}` : ''
  const variantUrls = {}
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

  for (const variant of MODEL_VARIANT_PRIORITY) {
    if (!variantCatalog?.[variant]) {
      continue
    }

    variantUrls[variant] = `/api/tripo/tasks/${taskId}/model?variant=${variant}${animationModeSuffix}`
  }

  const selectedVariantUrl = selectedOutput ? variantUrls[selectedOutput.variant] || null : null

  return {
    taskId,
    taskType: task?.type || '',
    sourceTaskId: sourceTaskId || getSourceTaskIdFromTask(task),
    status: task?.status || 'unknown',
    progress: task?.progress ?? 0,
    error: task?.error_msg || null,
    outputs: selectedOutput
      ? {
          modelUrl:
            selectedVariantUrl ||
            `/api/tripo/tasks/${taskId}/model?variant=${selectedOutput.variant}${animationModeSuffix}`,
          downloadUrl:
            selectedVariantUrl ||
            `/api/tripo/tasks/${taskId}/model?variant=${selectedOutput.variant}${animationModeSuffix}`,
          variant: selectedOutput.variant,
          variants: variantUrls,
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
  const animationTaskStartPromises = new Map()
  const animationEnabledByTaskId = new Map()

  const isMixamoRiggingEnabled = Boolean(config.tripoRigMixamo)
  const isIdleAnimationEnabled = Boolean(config.tripoIdleAnimationEnabled)

  const mergeVariantCatalog = (targetCatalog, sourceCatalog) => {
    for (const variant of MODEL_VARIANT_PRIORITY) {
      if (targetCatalog[variant] || !sourceCatalog?.[variant]) {
        continue
      }

      targetCatalog[variant] = sourceCatalog[variant]
    }
  }

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

  const rememberAnimationTask = (sourceTaskId, animationTaskId) => {
    sourceTaskByAnimationTaskId.set(animationTaskId, sourceTaskId)
  }

  const resolveAnimationTaskOptions = (overrides = {}) => {
    const taskType = String(overrides.taskType || config.tripoIdleAnimationTaskType || 'animate_model')
      .trim()
      .toLowerCase()
    const animation = String(overrides.animation || '').trim() || config.tripoIdleAnimationName
    const animateInPlace =
      taskType === 'animate_retarget'
        ? typeof overrides.animateInPlace === 'boolean'
          ? overrides.animateInPlace
          : config.tripoIdleAnimationInPlace
        : null

    return {
      taskType: taskType || 'animate_model',
      animation,
      animateInPlace,
    }
  }

  const buildAnimationTaskRequestKey = (sourceTaskId, animationTaskOptions) =>
    JSON.stringify([
      sourceTaskId,
      animationTaskOptions.taskType,
      animationTaskOptions.animation,
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
        taskType: animationTaskOptions.taskType,
        animateInPlace: animationTaskOptions.animateInPlace,
      })
      .then((animationTaskId) => {
        animationTaskByRequestKey.set(requestKey, animationTaskId)
        rememberAnimationTask(sourceTaskId, animationTaskId)
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
    const isRigTask = sourceTaskByRigTaskId.has(taskId) || task?.type === 'animate_rig'
    const isAnimationTask = sourceTaskByAnimationTaskId.has(taskId)

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

  const normalizeQuality = (value, fallback = 'standard') => {
    const normalizedValue = String(value || '')
      .trim()
      .toLowerCase()
    return QUALITY_ALIASES[normalizedValue] || QUALITY_ALIASES[fallback] || 'standard'
  }

  const buildGenerationOptions = ({ meshQuality, textureQuality } = {}) => {
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
    async createTaskFromViews(viewDataUrls, { animationMode, meshQuality, textureQuality } = {}) {
      // Tripo multiview slot order is Front, Left, Back, Right.
      const orderedViewNames = ['front', 'left', 'back', 'right']
      const shouldAnimate = resolveAnimationPreference(animationMode)
      const shouldRig = resolveRigPreference(animationMode, shouldAnimate)

      const uploadedFiles = await uploadOrderedViews(viewDataUrls, orderedViewNames)

      const taskId = await tripoClient.createMultiviewTask({
        files: uploadedFiles,
        options: buildGenerationOptions({ meshQuality, textureQuality }),
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
      { animationMode, meshQuality, textureQuality } = {},
    ) {
      const orderedViewNames = ['front', 'back']
      const shouldAnimate = resolveAnimationPreference(animationMode)
      const shouldRig = resolveRigPreference(animationMode, shouldAnimate)
      const uploadedFiles = await uploadOrderedViews(viewDataUrls, orderedViewNames)
      const taskId = await tripoClient.createMultiviewTask({
        // Place images into explicit Front, Left, Back, Right slots.
        files: [uploadedFiles[0], {}, uploadedFiles[1], {}],
        options: buildGenerationOptions({ meshQuality, textureQuality }),
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
    async createTaskFromFrontView(imageDataUrl, { animationMode, meshQuality, textureQuality } = {}) {
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
        options: buildGenerationOptions({ meshQuality, textureQuality }),
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
    async createRetargetTask(taskId, { animationName } = {}) {
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

      const animationTaskId = await ensureAnimationTaskForSource(rigTaskId, {
        taskType: 'animate_retarget',
        animation: animationName,
      })
      return summarizeTaskStart(animationTaskId, rigTaskId)
    },
    async getTaskSummary(taskId, { animationMode } = {}) {
      const resolvedTask = await resolveTaskForOutput(taskId, { animationMode })
      const variantCatalog = await collectVariantCatalog(resolvedTask.taskId, resolvedTask.task)
      const sourceTaskId = await resolveSourceTaskId(resolvedTask.taskId, resolvedTask.task)
      return buildTaskSummary({
        ...resolvedTask,
        animationMode,
        variantCatalog,
        sourceTaskId,
      })
    },
    async getModelAsset(taskId, requestedVariant, { animationMode } = {}) {
      const resolvedTask = await resolveTaskForOutput(taskId, { animationMode })
      const variantCatalog = await collectVariantCatalog(resolvedTask.taskId, resolvedTask.task)
      const selectedOutput =
        selectModelVariant(resolvedTask.task) || selectModelVariantFromVariants(variantCatalog)

      if (!selectedOutput) {
        throw new AppError('No model file is available for this task yet.', 404)
      }

      const variantToUse =
        requestedVariant && variantCatalog[requestedVariant]
          ? { variant: requestedVariant, remoteUrl: variantCatalog[requestedVariant] }
          : selectedOutput

      return {
        ...variantToUse,
        response: await tripoClient.fetchRemoteAsset(variantToUse.remoteUrl),
      }
    },
  }
}
