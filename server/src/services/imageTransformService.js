import sharp from 'sharp'

export const normalizeForGemini = async (buffer) =>
  sharp(buffer)
    .rotate()
    .png()
    .toBuffer()

const parseAspectRatio = (value) => {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/)

  if (!match) {
    return { width: 1, height: 1 }
  }

  const width = Number(match[1])
  const height = Number(match[2])

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 1, height: 1 }
  }

  return { width, height }
}

export const normalizePortraitToAspectRatio = async (buffer, aspectRatio = '1:1') => {
  const image = sharp(buffer).rotate()
  const metadata = await image.metadata()
  const sourceWidth = metadata.width || 0
  const sourceHeight = metadata.height || 0
  const { width: ratioWidth, height: ratioHeight } = parseAspectRatio(aspectRatio)

  if (!sourceWidth || !sourceHeight) {
    return image.png().toBuffer()
  }

  const targetRatio = ratioWidth / ratioHeight
  const sourceRatio = sourceWidth / sourceHeight

  const targetWidth =
    sourceRatio > targetRatio ? sourceWidth : Math.round(sourceHeight * targetRatio)
  const targetHeight =
    sourceRatio > targetRatio ? Math.round(sourceWidth / targetRatio) : sourceHeight

  return image
    .resize(targetWidth, targetHeight, {
      fit: 'contain',
      background: {
        r: 242,
        g: 242,
        b: 242,
        alpha: 1,
      },
    })
    .png()
    .toBuffer()
}

export const normalizeForTripo = async (buffer) =>
  sharp(buffer)
    .rotate()
    .jpeg({ quality: 92 })
    .toBuffer()

export const mirrorHorizontally = async (buffer) =>
  sharp(buffer)
    .flop()
    .png()
    .toBuffer()
