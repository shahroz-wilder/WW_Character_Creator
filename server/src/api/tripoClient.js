import { AppError } from '../utils/errors.js'

const parseJson = async (response) => {
  const text = await response.text()

  try {
    return JSON.parse(text)
  } catch {
    throw new AppError(`Unexpected Tripo response: ${text.slice(0, 200)}`, 502)
  }
}

export const createTripoClient = ({ apiKey, baseUrl, auditLogger = null }) => {
  const request = async (path, options = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(options.headers || {}),
      },
    })

    if (!response.ok) {
      const payload = await parseJson(response).catch(() => null)
      const message =
        payload?.message ||
        payload?.error?.message ||
        `${response.status} ${response.statusText}`
      throw new AppError(`Tripo request failed: ${message}`, 502)
    }

    return parseJson(response)
  }

  const submitTask = async ({
    action,
    requestBody,
    missingTaskIdMessage,
  }) => {
    try {
      const payload = await request('/task', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      const taskId = payload?.data?.task_id
      if (!taskId) {
        throw new AppError(missingTaskIdMessage, 502)
      }

      await auditLogger?.logSubmission({
        action,
        path: '/task',
        baseUrl,
        requestBody,
        responseBody: payload,
        taskId,
      })

      return taskId
    } catch (error) {
      await auditLogger?.logFailure({
        action,
        path: '/task',
        baseUrl,
        requestBody,
        error,
      })
      throw error
    }
  }

  return {
    async uploadImageBuffer(buffer, mimeType = 'image/jpeg') {
      const formData = new FormData()
      const extension = mimeType.includes('png') ? 'png' : 'jpg'
      formData.append('file', new Blob([buffer], { type: mimeType }), `view.${extension}`)

      const payload = await request('/upload', {
        method: 'POST',
        body: formData,
      })

      const fileToken = payload?.data?.image_token || payload?.data?.file_token
      if (!fileToken) {
        throw new AppError('Tripo did not return an upload token.', 502)
      }

      return {
        file_token: fileToken,
        type: extension,
      }
    },
    async createMultiviewTask({ files, options }) {
      return submitTask({
        action: 'multiview_to_model',
        requestBody: {
          type: 'multiview_to_model',
          files,
          ...options,
        },
        missingTaskIdMessage: 'Tripo did not return a task id.',
      })
    },
    async createImageTask({ file, options }) {
      return submitTask({
        action: 'image_to_model',
        requestBody: {
          type: 'image_to_model',
          file,
          ...options,
        },
        missingTaskIdMessage: 'Tripo did not return a task id.',
      })
    },
    async createRigTask({
      originalModelTaskId,
      outFormat = 'glb',
      rigType = 'biped',
      spec = 'tripo',
      modelVersion = 'v1.0-20240301',
    }) {
      return submitTask({
        action: 'animate_rig',
        requestBody: {
          type: 'animate_rig',
          original_model_task_id: originalModelTaskId,
          out_format: outFormat,
          rig_type: rigType,
          spec,
          model_version: modelVersion,
        },
        missingTaskIdMessage: 'Tripo did not return a rig task id.',
      })
    },
    async createPreRigCheckTask({ originalModelTaskId }) {
      return submitTask({
        action: 'animate_prerigcheck',
        requestBody: {
          type: 'animate_prerigcheck',
          original_model_task_id: originalModelTaskId,
        },
        missingTaskIdMessage: 'Tripo did not return a pre-rig-check task id.',
      })
    },
    async createAnimationTask({
      originalModelTaskId,
      animation = 'idle',
      animations = [],
      taskType = 'animate_model',
      animateInPlace = null,
    }) {
      const normalizedAnimations = Array.isArray(animations)
        ? animations
            .map((value) => String(value || '').trim())
            .filter(Boolean)
        : []
      const requestBody = {
        type: taskType,
        original_model_task_id: originalModelTaskId,
      }

      if (normalizedAnimations.length > 0) {
        requestBody.animations = normalizedAnimations
      } else {
        requestBody.animation = animation
      }

      if (taskType === 'animate_retarget' && animateInPlace !== null) {
        requestBody.animate_in_place = Boolean(animateInPlace)
      }

      return submitTask({
        action: taskType,
        requestBody,
        missingTaskIdMessage: 'Tripo did not return an animation task id.',
      })
    },
    async getTask(taskId) {
      const payload = await request(`/task/${taskId}`, { method: 'GET' })
      return payload?.data
    },
    async fetchRemoteAsset(url) {
      const response = await fetch(url)

      if (!response.ok) {
        throw new AppError(`Failed to fetch remote asset: ${response.status} ${response.statusText}`, 502)
      }

      return response
    },
  }
}
