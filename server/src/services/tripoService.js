import { normalizeForTripo } from './imageTransformService.js'
import { parseImageDataUrl } from '../utils/dataUrl.js'
import { AppError } from '../utils/errors.js'

export const selectModelVariant = (task) => {
  if (task?.output?.animation_model) {
    return { variant: 'animation_model', remoteUrl: task.output.animation_model }
  }

  if (task?.output?.animated_model) {
    return { variant: 'animated_model', remoteUrl: task.output.animated_model }
  }

  if (task?.output?.rigged_model) {
    return { variant: 'rigged_model', remoteUrl: task.output.rigged_model }
  }

  if (task?.output?.pbr_model) {
    return { variant: 'pbr_model', remoteUrl: task.output.pbr_model }
  }

  if (task?.output?.model) {
    return { variant: 'model', remoteUrl: task.output.model }
  }

  if (task?.output?.base_model) {
    return { variant: 'base_model', remoteUrl: task.output.base_model }
  }

  return null
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

const buildTaskSummary = ({ taskId, task, animationMode }) => {
  const selectedOutput = selectModelVariant(task)
  const modeParam = normalizeAnimationModeParam(animationMode)
  const animationModeSuffix = modeParam ? `&animationMode=${modeParam}` : ''

  return {
    taskId,
    status: task?.status || 'unknown',
    progress: task?.progress ?? 0,
    error: task?.error_msg || null,
    outputs: selectedOutput
      ? {
          modelUrl: `/api/tripo/tasks/${taskId}/model?variant=${selectedOutput.variant}${animationModeSuffix}`,
          downloadUrl: `/api/tripo/tasks/${taskId}/model?variant=${selectedOutput.variant}${animationModeSuffix}`,
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

  const isTripoInvalidParameterError = (error) =>
    /parameter/i.test(String(error?.message || '')) && /invalid/i.test(String(error?.message || ''))

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
      // Use Tripo API semantic order: front, back, left, right.
      const orderedViewNames = ['front', 'back', 'left', 'right']
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
      const generationOptions = buildGenerationOptions()
      let taskId

      try {
        // Preferred flow: submit strictly front+back.
        taskId = await tripoClient.createMultiviewTask({
          files: uploadedFiles,
          options: generationOptions,
        })
      } catch (error) {
        if (!isTripoInvalidParameterError(error)) {
          throw error
        }

        // Compatibility fallback for Tripo variants requiring 4 ordered slots.
        // Keep front/back only and leave left/right empty.
        taskId = await tripoClient.createMultiviewTask({
          files: [uploadedFiles[0], uploadedFiles[1], {}, {}],
          options: generationOptions,
        })
      }

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
      return buildTaskSummary({
        ...resolvedTask,
        animationMode,
      })
    },
    async getModelAsset(taskId, requestedVariant, { animationMode } = {}) {
      const resolvedTask = await resolveTaskForOutput(taskId, { animationMode })
      const selectedOutput = selectModelVariant(resolvedTask.task)

      if (!selectedOutput) {
        throw new AppError('No model file is available for this task yet.', 404)
      }

      const variantToUse =
        requestedVariant && resolvedTask.task?.output?.[requestedVariant]
          ? { variant: requestedVariant, remoteUrl: resolvedTask.task.output[requestedVariant] }
          : selectedOutput

      return {
        ...variantToUse,
        response: await tripoClient.fetchRemoteAsset(variantToUse.remoteUrl),
      }
    },
  }
}
