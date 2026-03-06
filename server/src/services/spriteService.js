import { RUN_ANIMATION_NAME, RUN_SKELETON_TEMPLATE } from '../constants/runSkeletonTemplate.js'
import { imageBufferToDataUrl, parseImageDataUrl } from '../utils/dataUrl.js'
import { AppError } from '../utils/errors.js'
import { normalizeForSprite } from './imageTransformService.js'

const VALID_SPRITE_SIZES = new Set([64, 84, 128])
const REQUIRED_DIRECTIONS = ['front', 'back', 'left', 'right']
const PIXELLAB_DIRECTION_MAP = {
  front: 'south',
  back: 'north',
  left: 'west',
  right: 'east',
}

const KEYPOINT_GROUP_ALIASES = {
  leftArm: ['LEFTSHOULDER', 'LEFTUPPERARM', 'LEFTARM', 'LEFTELBOW', 'LEFTFOREARM', 'LEFTWRIST', 'LEFTHAND'],
  rightArm: ['RIGHTSHOULDER', 'RIGHTUPPERARM', 'RIGHTARM', 'RIGHTELBOW', 'RIGHTFOREARM', 'RIGHTWRIST', 'RIGHTHAND'],
  leftLeg: ['LEFTHIP', 'LEFTUPPERLEG', 'LEFTLEG', 'LEFTKNEE', 'LEFTLOWERLEG', 'LEFTANKLE', 'LEFTFOOT', 'LEFTTOE'],
  rightLeg: ['RIGHTHIP', 'RIGHTUPPERLEG', 'RIGHTLEG', 'RIGHTKNEE', 'RIGHTLOWERLEG', 'RIGHTANKLE', 'RIGHTFOOT', 'RIGHTTOE'],
  torso: ['PELVIS', 'HIP', 'HIPS', 'SPINE', 'CHEST', 'NECK'],
  head: ['HEAD', 'NOSE', 'LEFTEYE', 'RIGHTEYE', 'LEFTEAR', 'RIGHTEAR'],
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const normalizeLabel = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

const collectGroupIndexes = (keypoints) => {
  const normalizedLabels = keypoints.map((point) => normalizeLabel(point?.label))
  const indexGroups = {}

  for (const [groupName, aliases] of Object.entries(KEYPOINT_GROUP_ALIASES)) {
    indexGroups[groupName] = normalizedLabels.reduce((accumulator, normalizedLabel, index) => {
      if (aliases.some((alias) => normalizedLabel.includes(alias))) {
        accumulator.push(index)
      }

      return accumulator
    }, [])
  }

  return indexGroups
}

const detectCoordinateBounds = (points, spriteSize) => {
  const maxCoordinate = points.reduce((maxValue, point) => {
    const currentMax = Math.max(Math.abs(point.x), Math.abs(point.y))
    return Math.max(maxValue, currentMax)
  }, 0)

  const isNormalized = maxCoordinate <= 2

  return {
    max: isNormalized ? 1 : spriteSize - 1,
    unit: isNormalized ? 0.085 : Math.max(1, spriteSize * 0.08),
    torsoUnit: isNormalized ? 0.05 : Math.max(1, spriteSize * 0.045),
  }
}

const applyOffset = (points, indexes, offsetX, offsetY, maxBound) => {
  for (const index of indexes) {
    points[index] = {
      ...points[index],
      x: clamp(points[index].x + offsetX, 0, maxBound),
      y: clamp(points[index].y + offsetY, 0, maxBound),
    }
  }
}

const buildRunKeyframes = (keypoints, spriteSize) => {
  const basePoints = keypoints.map((keypoint) => ({
    x: Number(keypoint.x || 0),
    y: Number(keypoint.y || 0),
    label: String(keypoint.label || ''),
    z_index: Number.isFinite(keypoint.z_index) ? Math.round(Number(keypoint.z_index)) : 0,
  }))

  if (basePoints.length === 0) {
    throw new AppError('PixelLab skeleton estimate returned no keypoints.', 502)
  }

  const groups = collectGroupIndexes(keypoints)
  const { max: coordinateMax, unit, torsoUnit } = detectCoordinateBounds(basePoints, spriteSize)

  return RUN_SKELETON_TEMPLATE.map((frame) => {
    const nextPoints = basePoints.map((point) => ({ ...point }))

    applyOffset(nextPoints, groups.leftArm, frame.leftArmX * unit, frame.leftArmY * unit, coordinateMax)
    applyOffset(nextPoints, groups.rightArm, frame.rightArmX * unit, frame.rightArmY * unit, coordinateMax)
    applyOffset(nextPoints, groups.leftLeg, frame.leftLegX * unit, frame.leftLegY * unit, coordinateMax)
    applyOffset(nextPoints, groups.rightLeg, frame.rightLegX * unit, frame.rightLegY * unit, coordinateMax)
    applyOffset(nextPoints, groups.torso, 0, frame.torsoY * torsoUnit, coordinateMax)
    applyOffset(nextPoints, groups.head, 0, frame.torsoY * torsoUnit * 0.45, coordinateMax)

    return nextPoints.map((point) => ({
      x: Number(point.x.toFixed(4)),
      y: Number(point.y.toFixed(4)),
      label: point.label,
      z_index: point.z_index,
    }))
  })
}

const detectMimeTypeFromBase64 = (base64Value) => {
  const buffer = Buffer.from(base64Value, 'base64')

  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png'
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }

  if (buffer.length >= 6 && buffer.slice(0, 3).toString('ascii') === 'GIF') {
    return 'image/gif'
  }

  if (
    buffer.length >= 12 &&
    buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
    buffer.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }

  return 'image/png'
}

const toDataUrlFromPixelLabImage = (image) => {
  if (!image?.base64) {
    throw new AppError('PixelLab animation returned an invalid frame payload.', 502)
  }

  const mimeType = detectMimeTypeFromBase64(image.base64)
  return `data:${mimeType};base64,${image.base64}`
}

const assertValidSpriteSize = (spriteSize) => {
  const normalizedSize = Number(spriteSize)

  if (!VALID_SPRITE_SIZES.has(normalizedSize)) {
    throw new AppError('Sprite size must be one of: 64, 84, 128.', 400)
  }

  return normalizedSize
}

const assertRequiredDirections = (views) => {
  const missingDirections = REQUIRED_DIRECTIONS.filter((direction) => !views?.[direction])

  if (missingDirections.length > 0) {
    throw new AppError(
      `Missing required multiview directions for sprite generation: ${missingDirections.join(', ')}.`,
      400,
    )
  }
}

export const createSpriteService = ({ pixellabClient }) => ({
  async generateRunSprites({ views, spriteSize }) {
    assertRequiredDirections(views)
    const normalizedSpriteSize = assertValidSpriteSize(spriteSize)
    const directions = {}

    for (const direction of REQUIRED_DIRECTIONS) {
      const parsed = parseImageDataUrl(views[direction])
      const normalizedBuffer = await normalizeForSprite(parsed.buffer, normalizedSpriteSize)
      const normalizedDataUrl = imageBufferToDataUrl(normalizedBuffer, 'image/png')

      const skeletonEstimate = await pixellabClient.estimateSkeleton(normalizedDataUrl)
      const runKeyframes = buildRunKeyframes(skeletonEstimate.keypoints, normalizedSpriteSize)
      const animationResponse = await pixellabClient.animateWithSkeleton(
        normalizedDataUrl,
        runKeyframes,
        {
          width: normalizedSpriteSize,
          height: normalizedSpriteSize,
          direction: PIXELLAB_DIRECTION_MAP[direction],
          view: 'low top-down',
        },
      )

      const frameDataUrls = animationResponse.images.map(toDataUrlFromPixelLabImage)
      const firstFrame = frameDataUrls[0] || normalizedDataUrl

      directions[direction] = {
        previewDataUrl: firstFrame,
        frameDataUrls,
        source: 'pixellab',
        frames: {
          count: frameDataUrls.length,
          format: 'base64-frame-sequence',
        },
      }
    }

    return {
      animation: RUN_ANIMATION_NAME,
      spriteSize: normalizedSpriteSize,
      directions,
    }
  },
})
