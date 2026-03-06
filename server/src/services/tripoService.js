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

const buildTaskSummary = ({ taskId, task, animationMode, variantCatalog }) => {
  const selectedOutput = selectModelVariant(task) || selectModelVariantFromVariants(variantCatalog)
  const modeParam = normalizeAnimationModeParam(animationMode)
  const animationModeSuffix = modeParam ? `&animationMode=${modeParam}` : ''
  const variantUrls = {}

  for (const variant of MODEL_VARIANT_PRIORITY) {
    if (!variantCatalog?.[variant]) {
      continue
    }

    variantUrls[variant] = `/api/tripo/tasks/${taskId}/model?variant=${variant}${animationModeSuffix}`
  }

  const selectedVariantUrl = selectedOutput ? variantUrls[selectedOutput.variant] || null : null

  return {
    taskId,
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
        }
      : null,
  }
}

export const createTripoService = ({ tripoClient, config }) => {
  const rigTaskBySourceTaskId = new Map()
  const sourceTaskByRigTaskId = new Map()
  const rigTaskStartPromises = new Map()
  const rigEnabledByTaskId = new Map()
  const animationTaskBySourceTaskId = new Map()
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
    animationTaskBySourceTaskId.set(sourceTaskId, animationTaskId)
    sourceTaskByAnimationTaskId.set(animationTaskId, sourceTaskId)
  }

  const ensureAnimationTaskForSource = async (sourceTaskId) => {
    const existingAnimationTaskId = animationTaskBySourceTaskId.get(sourceTaskId)
    if (existingAnimationTaskId) {
      return existingAnimationTaskId
    }

    const inFlightPromise = animationTaskStartPromises.get(sourceTaskId)
    if (inFlightPromise) {
      return inFlightPromise
    }

    const startPromise = tripoClient
      .createAnimationTask({
        originalModelTaskId: sourceTaskId,
        animation: config.tripoIdleAnimationName,
        taskType: config.tripoIdleAnimationTaskType,
        animateInPlace: config.tripoIdleAnimationInPlace,
      })
      .then((animationTaskId) => {
        rememberAnimationTask(sourceTaskId, animationTaskId)
        animationTaskStartPromises.delete(sourceTaskId)
        return animationTaskId
      })
      .catch((error) => {
        animationTaskStartPromises.delete(sourceTaskId)
        throw error
      })

    animationTaskStartPromises.set(sourceTaskId, startPromise)
    return startPromise
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

  const buildGenerationOptions = () => ({
    model_version: config.tripoModelVersion,
    texture: config.tripoTexture,
    pbr: config.tripoPbr,
    texture_quality: config.tripoTextureQuality,
    texture_alignment: config.tripoTextureAlignment,
    orientation: config.tripoOrientation,
  })

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
    async createTaskFromViews(viewDataUrls, { animationMode } = {}) {
      // Tripo multiview slot order is Front, Left, Back, Right.
      const orderedViewNames = ['front', 'left', 'back', 'right']
      const shouldAnimate = resolveAnimationPreference(animationMode)
      const shouldRig = resolveRigPreference(animationMode, shouldAnimate)

      const uploadedFiles = await uploadOrderedViews(viewDataUrls, orderedViewNames)

      const taskId = await tripoClient.createMultiviewTask({
        files: uploadedFiles,
        options: buildGenerationOptions(),
      })

      rigEnabledByTaskId.set(taskId, shouldRig)
      animationEnabledByTaskId.set(taskId, shouldAnimate)

      return {
        taskId,
        status: 'queued',
      }
    },
    async createTaskFromFrontBackViews(viewDataUrls, { animationMode } = {}) {
      const orderedViewNames = ['front', 'back']
      const shouldAnimate = resolveAnimationPreference(animationMode)
      const shouldRig = resolveRigPreference(animationMode, shouldAnimate)
      const uploadedFiles = await uploadOrderedViews(viewDataUrls, orderedViewNames)
      const taskId = await tripoClient.createMultiviewTask({
        // Place images into explicit Front, Left, Back, Right slots.
        files: [uploadedFiles[0], {}, uploadedFiles[1], {}],
        options: buildGenerationOptions(),
      })

      rigEnabledByTaskId.set(taskId, shouldRig)
      animationEnabledByTaskId.set(taskId, shouldAnimate)

      return {
        taskId,
        status: 'queued',
      }
    },
    async createTaskFromFrontView(imageDataUrl, { animationMode } = {}) {
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
        options: buildGenerationOptions(),
      })

      rigEnabledByTaskId.set(taskId, shouldRig)
      animationEnabledByTaskId.set(taskId, shouldAnimate)

      return {
        taskId,
        status: 'queued',
      }
    },
    async getTaskSummary(taskId, { animationMode } = {}) {
      const resolvedTask = await resolveTaskForOutput(taskId, { animationMode })
      const variantCatalog = await collectVariantCatalog(resolvedTask.taskId, resolvedTask.task)
      return buildTaskSummary({
        ...resolvedTask,
        animationMode,
        variantCatalog,
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
