const readErrorMessage = async (response) => {
  const jsonResponse = response.clone()
  const textResponse = response.clone()

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
      return `Request failed with status ${response.status}.`
    }
  }

  return `Request failed with status ${response.status}.`
}

const requestJson = async (url, options) => {
  let response

  try {
    response = await fetch(url, options)
  } catch (error) {
    throw new Error(error?.message || 'Network request failed.')
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

export const getTripoTask = async (taskId) =>
  requestJson(`/api/tripo/tasks/${taskId}`, {
    method: 'GET',
  })
