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

const buildTaskSummary = ({ taskId, task }) => {
  const selectedOutput = selectModelVariant(task)

  return {
    taskId,
    status: task?.status || 'unknown',
    progress: task?.progress ?? 0,
    error: task?.error_msg || null,
    outputs: selectedOutput
      ? {
          modelUrl: `/api/tripo/tasks/${taskId}/model?variant=${selectedOutput.variant}`,
          downloadUrl: `/api/tripo/tasks/${taskId}/model?variant=${selectedOutput.variant}`,
        }
      : null,
  }
}

export const createTripoService = ({ tripoClient, config }) => {
  const rigTaskBySourceTaskId = new Map()
  const sourceTaskByRigTaskId = new Map()
  const rigTaskStartPromises = new Map()
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

  const getAnimationEnabledForTask = (taskId) => {
    if (animationEnabledByTaskId.has(taskId)) {
      return animationEnabledByTaskId.get(taskId)
    }

    return isIdleAnimationEnabled
  }

  const rememberRigTask = (sourceTaskId, rigTaskId) => {
    rigTaskBySourceTaskId.set(sourceTaskId, rigTaskId)
    sourceTaskByRigTaskId.set(rigTaskId, sourceTaskId)
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

  const resolveTaskForOutput = async (taskId) => {
    let resolvedTaskId = taskId
    let task = await tripoClient.getTask(taskId)
    const isRigTask = sourceTaskByRigTaskId.has(taskId) || task?.type === 'animate_rig'
    const isAnimationTask = sourceTaskByAnimationTaskId.has(taskId)

    if (!isAnimationTask && isMixamoRiggingEnabled && !isRigTask && task?.status === 'success') {
      const rigTaskId = await ensureRigTaskForSource(taskId)
      resolvedTaskId = rigTaskId
      task = await tripoClient.getTask(rigTaskId)
    }

    const shouldAnimate = getAnimationEnabledForTask(resolvedTaskId)
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

  return {
    async createTaskFromViews(viewDataUrls, { animationMode } = {}) {
      // Use Tripo API semantic order: front, back, left, right.
      const orderedViewNames = ['front', 'back', 'left', 'right']
      const uploadedFiles = []
      const shouldAnimate = resolveAnimationPreference(animationMode)

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

      const taskId = await tripoClient.createMultiviewTask({
        files: uploadedFiles,
        options: {
          model_version: config.tripoModelVersion,
          texture: config.tripoTexture,
          pbr: config.tripoPbr,
          texture_quality: config.tripoTextureQuality,
          texture_alignment: config.tripoTextureAlignment,
          orientation: config.tripoOrientation,
        },
      })

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
      const { buffer } = parseImageDataUrl(imageDataUrl)
      const normalizedBuffer = await normalizeForTripo(buffer)
      const uploadToken = await tripoClient.uploadImageBuffer(normalizedBuffer, 'image/jpeg')
      const taskId = await tripoClient.createImageTask({
        file: {
          type: 'image',
          file_token: uploadToken.file_token,
        },
        options: {
          model_version: config.tripoModelVersion,
          texture: config.tripoTexture,
          pbr: config.tripoPbr,
          texture_quality: config.tripoTextureQuality,
          texture_alignment: config.tripoTextureAlignment,
          orientation: config.tripoOrientation,
        },
      })

      animationEnabledByTaskId.set(taskId, shouldAnimate)

      return {
        taskId,
        status: 'queued',
      }
    },
    async getTaskSummary(taskId) {
      const resolvedTask = await resolveTaskForOutput(taskId)
      return buildTaskSummary(resolvedTask)
    },
    async getModelAsset(taskId, requestedVariant) {
      const resolvedTask = await resolveTaskForOutput(taskId)
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
