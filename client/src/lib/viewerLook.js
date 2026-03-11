export const VIEWER_TONE_MAPPING_LABELS = Object.freeze({
  none: 'None',
  aces: 'ACES',
  reinhard: 'Reinhard',
})

export const DEFAULT_VIEWER_LOOK_SETTINGS = Object.freeze({
  environmentIntensity: 0.54,
  keyLightIntensity: 0.84,
  fillLightIntensity: 1.22,
  rimLightIntensity: 0.96,
  ambientLightIntensity: 0.82,
  roughnessMultiplier: 0.48,
  toneMapping: 'none',
  exposure: 0.68,
  contrast: 1.07,
  vibrance: 0,
  sharpen: 0.2,
})

const clampNumber = (value, minimum, maximum, fallback) => {
  const normalizedValue = Number(value)
  if (!Number.isFinite(normalizedValue)) {
    return fallback
  }

  return Math.min(maximum, Math.max(minimum, normalizedValue))
}

export const normalizeViewerLookSettings = (
  value,
  fallback = DEFAULT_VIEWER_LOOK_SETTINGS,
) => {
  const sourceValue = value && typeof value === 'object' ? value : {}
  const safeFallback = fallback && typeof fallback === 'object'
    ? { ...DEFAULT_VIEWER_LOOK_SETTINGS, ...fallback }
    : DEFAULT_VIEWER_LOOK_SETTINGS

  const toneMapping = String(sourceValue?.toneMapping || safeFallback.toneMapping || 'none')
    .trim()
    .toLowerCase()

  return {
    environmentIntensity: clampNumber(
      sourceValue?.environmentIntensity,
      0,
      3,
      safeFallback.environmentIntensity,
    ),
    keyLightIntensity: clampNumber(
      sourceValue?.keyLightIntensity,
      0,
      4,
      safeFallback.keyLightIntensity,
    ),
    fillLightIntensity: clampNumber(
      sourceValue?.fillLightIntensity,
      0,
      4,
      safeFallback.fillLightIntensity,
    ),
    rimLightIntensity: clampNumber(
      sourceValue?.rimLightIntensity,
      0,
      4,
      safeFallback.rimLightIntensity,
    ),
    ambientLightIntensity: clampNumber(
      sourceValue?.ambientLightIntensity,
      0,
      4,
      safeFallback.ambientLightIntensity,
    ),
    roughnessMultiplier: clampNumber(
      sourceValue?.roughnessMultiplier,
      0,
      5,
      safeFallback.roughnessMultiplier,
    ),
    toneMapping:
      Object.prototype.hasOwnProperty.call(VIEWER_TONE_MAPPING_LABELS, toneMapping)
        ? toneMapping
        : safeFallback.toneMapping,
    exposure: clampNumber(sourceValue?.exposure, 0, 3, safeFallback.exposure),
    contrast: clampNumber(sourceValue?.contrast, 0.5, 2, safeFallback.contrast),
    vibrance: clampNumber(sourceValue?.vibrance, -1, 1, safeFallback.vibrance),
    sharpen: clampNumber(sourceValue?.sharpen, 0, 2, safeFallback.sharpen),
  }
}
