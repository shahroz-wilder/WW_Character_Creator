import { AppError } from '../utils/errors.js'

const parseJson = async (response) => {
  const text = await response.text()

  try {
    return JSON.parse(text)
  } catch {
    throw new AppError(`Unexpected Tripo response: ${text.slice(0, 200)}`, 502)
  }
}

export const createTripoClient = ({ apiKey, baseUrl }) => {
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
      const payload = await request('/task', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'multiview_to_model',
          files,
          ...options,
        }),
      })

      const taskId = payload?.data?.task_id
      if (!taskId) {
        throw new AppError('Tripo did not return a task id.', 502)
      }

      return taskId
    },
    async createImageTask({ file, options }) {
      const payload = await request('/task', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'image_to_model',
          file,
          ...options,
        }),
      })

      const taskId = payload?.data?.task_id
      if (!taskId) {
        throw new AppError('Tripo did not return a task id.', 502)
      }

      return taskId
    },
    async createRigTask({
      originalModelTaskId,
      outFormat = 'glb',
      rigType = 'biped',
      spec = 'tripo',
      modelVersion = 'v1.0-20240301',
    }) {
      const payload = await request('/task', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'animate_rig',
          original_model_task_id: originalModelTaskId,
          out_format: outFormat,
          rig_type: rigType,
          spec,
          model_version: modelVersion,
        }),
      })

      const taskId = payload?.data?.task_id
      if (!taskId) {
        throw new AppError('Tripo did not return a rig task id.', 502)
      }

      return taskId
    },
    async createAnimationTask({
      originalModelTaskId,
      animation = 'idle',
      taskType = 'animate_model',
      animateInPlace = null,
    }) {
      const requestBody = {
        type: taskType,
        original_model_task_id: originalModelTaskId,
        animation,
      }

      if (taskType === 'animate_retarget' && animateInPlace !== null) {
        requestBody.animate_in_place = Boolean(animateInPlace)
      }

      const payload = await request('/task', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      const taskId = payload?.data?.task_id
      if (!taskId) {
        throw new AppError('Tripo did not return an animation task id.', 502)
      }

      return taskId
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
