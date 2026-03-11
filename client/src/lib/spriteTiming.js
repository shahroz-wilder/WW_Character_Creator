export const DEFAULT_ANIMATED_SPRITE_DELAY_MS = 90
export const MIN_ANIMATED_SPRITE_DELAY_MS = 40
export const MAX_ANIMATED_SPRITE_DELAY_MS = 180
const ANIMATED_SPRITE_DELAY_MULTIPLIER_BY_KEY = Object.freeze({
  look_around: 2,
})

const getAnimatedSpriteDelayMultiplier = (animationKey = '') => {
  const normalizedAnimationKey = String(animationKey || '').trim().toLowerCase()
  const multiplier = Number(ANIMATED_SPRITE_DELAY_MULTIPLIER_BY_KEY[normalizedAnimationKey])

  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1
}

const getAnimatedSpriteMaxDelayMs = (animationKey = '') =>
  Math.round(MAX_ANIMATED_SPRITE_DELAY_MS * getAnimatedSpriteDelayMultiplier(animationKey))

export const resolveAnimatedSpriteDelayMs = (
  delayMs,
  fallbackDelayMs = DEFAULT_ANIMATED_SPRITE_DELAY_MS,
  animationKey = '',
) => {
  const normalizedFallbackDelayMs = Number(fallbackDelayMs)
  const safeFallbackDelayMs =
    Number.isFinite(normalizedFallbackDelayMs) && normalizedFallbackDelayMs > 0
      ? normalizedFallbackDelayMs
      : DEFAULT_ANIMATED_SPRITE_DELAY_MS
  const normalizedDelayMs = Number(delayMs)

  if (!Number.isFinite(normalizedDelayMs) || normalizedDelayMs <= 0) {
    return safeFallbackDelayMs
  }

  return Math.round(
    Math.min(
      getAnimatedSpriteMaxDelayMs(animationKey),
      Math.max(MIN_ANIMATED_SPRITE_DELAY_MS, normalizedDelayMs),
    ),
  )
}

export const resolveAnimatedSpriteCaptureDelayMs = (
  clipDurationSeconds,
  frameCount,
  fallbackDelayMs = DEFAULT_ANIMATED_SPRITE_DELAY_MS,
  animationKey = '',
) => {
  const normalizedDurationSeconds = Number(clipDurationSeconds)
  const normalizedFrameCount = Math.max(1, Math.round(Number(frameCount) || 0))
  const delayMultiplier = getAnimatedSpriteDelayMultiplier(animationKey)

  if (!Number.isFinite(normalizedDurationSeconds) || normalizedDurationSeconds <= 0) {
    return resolveAnimatedSpriteDelayMs(undefined, fallbackDelayMs, animationKey)
  }

  return resolveAnimatedSpriteDelayMs(
    ((normalizedDurationSeconds * 1000) / normalizedFrameCount) * delayMultiplier,
    fallbackDelayMs,
    animationKey,
  )
}
