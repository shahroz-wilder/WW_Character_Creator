const readErrorMessage = async (response) => {
  const jsonResponse = response.clone()
  const textResponse = response.clone()
  const fallback =
    response.status >= 500
      ? `Server error (${response.status}). Check server logs and try again.`
      : `Request failed with status ${response.status}.`

  try {
    const payload = await jsonResponse.json()
    if (payload?.error) {
      return payload.error
    }
  } catch {
    try {
      const text = await textResponse.text()
      if (text.trim()) {
        return text.trim()
      }
    } catch {
      return fallback
    }
  }

  return fallback
}

// Read auth token from URL query params (passed by the game client).
const getAuthToken = () => {
  try {
    const params = new URLSearchParams(window.location.search)
    return params.get('token') || ''
  } catch {
    return ''
  }
}

const requestJson = async (url, options = {}) => {
  const token = getAuthToken()
  if (token) {
    options.headers = { ...options.headers, Authorization: `Bearer ${token}` }
  }

  let response

  try {
    response = await fetch(url, options)
  } catch (error) {
    throw new Error(error?.message || 'Network request failed.')
  }

  if (response.status === 402) {
    const body = await response.json().catch(() => ({}))
    const err = new Error(
      body.message || 'Insufficient credits to use the character creator.',
    )
    err.code = 'INSUFFICIENT_CREDITS'
    err.totalCredits = body.totalCredits ?? 0
    err.requiredCredits = body.requiredCredits ?? 0
    throw err
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  return response.json()
}

export const generatePortrait = async ({
  prompt,
  referenceImage,
  portraitAspectRatio,
  portraitPromptPreset,
}) => {
  const formData = new FormData()
  formData.append('prompt', prompt)
  formData.append('portraitAspectRatio', portraitAspectRatio || '')
  formData.append('portraitPromptPreset', portraitPromptPreset || '')

  if (referenceImage) {
    formData.append('referenceImage', referenceImage, referenceImage.name)
  }

  return requestJson('/api/character/portrait', {
    method: 'POST',
    body: formData,
  })
}

export const generateMultiview = async (payload) =>
  requestJson('/api/character/multiview', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

export const createTripoTask = async (payload) =>
  requestJson('/api/tripo/tasks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

export const createTripoFrontTask = async (payload) =>
  requestJson('/api/tripo/tasks/front', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

export const createTripoFrontBackTask = async (payload) =>
  requestJson('/api/tripo/tasks/front-back', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

export const createTripoRigTask = async (taskId) =>
  requestJson(`/api/tripo/tasks/${encodeURIComponent(taskId)}/rig`, {
    method: 'POST',
  })

export const createTripoPreRigCheckTask = async (taskId) =>
  requestJson(`/api/tripo/tasks/${encodeURIComponent(taskId)}/prerigcheck`, {
    method: 'POST',
  })

export const createTripoRetargetTask = async (taskId, payload = {}) =>
  requestJson(`/api/tripo/tasks/${encodeURIComponent(taskId)}/retarget`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

export const getTripoTask = async (taskId, animationMode = '') => {
  const normalizedAnimationMode = String(animationMode || '').trim().toLowerCase()
  const query =
    normalizedAnimationMode === 'animated' || normalizedAnimationMode === 'static'
      ? `?animationMode=${encodeURIComponent(normalizedAnimationMode)}`
      : ''

  return requestJson(`/api/tripo/tasks/${taskId}${query}`, {
    method: 'GET',
  })
}

export const restartDevServer = async () =>
  requestJson('/api/dev/restart-server', {
    method: 'POST',
  })

export const generateSpriteRun = async (payload) =>
  requestJson('/api/sprites/run', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

export const getHealth = async () =>
  requestJson('/api/health', {
    method: 'GET',
  })

export const checkCredits = async () => {
  const token = getAuthToken()
  if (!token) return { hasCredits: true }

  try {
    const response = await fetch('/api/credits/balance', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) return { hasCredits: true }
    const data = await response.json()
    return {
      hasCredits: data.totalCredits >= 5000,
      totalCredits: data.totalCredits,
    }
  } catch {
    return { hasCredits: true }
  }
}
