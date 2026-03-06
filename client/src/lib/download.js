export const downloadFromUrl = async (url, filename) => {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error('Failed to download the model.')
  }

  const blob = await response.blob()
  downloadBlob(blob, filename)
}

export const downloadDataUrl = (dataUrl, filename) => {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export const downloadBlob = (blob, filename) => {
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(objectUrl)
}
