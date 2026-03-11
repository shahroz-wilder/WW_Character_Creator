export const DEFAULT_COMBINED_ANIMATION_GIF_DELAY_MS = 110
export const DEFAULT_COMBINED_ANIMATION_GIF_MAX_FRAMES = 96

export const getCombinedSpriteDirectionFrames = (direction) => {
  const frameDataUrls = Array.isArray(direction?.frameDataUrls)
    ? direction.frameDataUrls.filter((frameDataUrl) => Boolean(frameDataUrl))
    : []

  if (frameDataUrls.length > 0) {
    return frameDataUrls
  }

  const previewDataUrl = String(direction?.previewDataUrl || '').trim()
  return previewDataUrl ? [previewDataUrl] : []
}

export const buildCombinedAnimationRowsPlan = (
  animationEntries,
  {
    directionKeys = [],
    defaultDelayMs = DEFAULT_COMBINED_ANIMATION_GIF_DELAY_MS,
    maxFrames = DEFAULT_COMBINED_ANIMATION_GIF_MAX_FRAMES,
  } = {},
) => {
  const normalizedDirectionKeys = Array.from(
    new Set(
      (Array.isArray(directionKeys) ? directionKeys : [])
        .map((directionKey) => String(directionKey || '').trim())
        .filter(Boolean),
    ),
  )

  if (normalizedDirectionKeys.length === 0) {
    throw new Error('Direction keys are required to build a combined animation GIF.')
  }

  const rows = []

  for (const entry of Array.isArray(animationEntries) ? animationEntries : []) {
    if (!entry || typeof entry !== 'object') {
      continue
    }

    const animationKey = String(entry.animation || entry.key || '').trim() || 'animation'
    const directions = entry?.directions && typeof entry.directions === 'object' ? entry.directions : null

    if (!directions) {
      continue
    }

    const directionFrames = {}
    let rowFrameCount = 0
    let rowDelayMs = null

    for (const directionKey of normalizedDirectionKeys) {
      const direction = directions?.[directionKey]
      const frames = getCombinedSpriteDirectionFrames(direction)

      if (frames.length === 0) {
        throw new Error(`Missing sprite output for ${animationKey}:${directionKey}.`)
      }

      directionFrames[directionKey] = frames
      rowFrameCount = Math.max(rowFrameCount, frames.length)

      const directionDelayMs = Number(direction?.delayMs)
      if (Number.isFinite(directionDelayMs) && directionDelayMs > 0) {
        rowDelayMs =
          rowDelayMs === null ? directionDelayMs : Math.min(rowDelayMs, directionDelayMs)
      }
    }

    if (rowFrameCount > 0) {
      rows.push({
        animationKey,
        directionFrames,
        frameCount: rowFrameCount,
        frameDelayMs: rowDelayMs || defaultDelayMs,
      })
    }
  }

  if (rows.length === 0) {
    throw new Error('No animation rows are available for the combined GIF.')
  }

  const outputDelayMs = rows.reduce(
    (minimum, row) => Math.min(minimum, row.frameDelayMs),
    Number.POSITIVE_INFINITY,
  )
  const safeOutputDelayMs =
    Number.isFinite(outputDelayMs) && outputDelayMs > 0 ? outputDelayMs : defaultDelayMs
  const safeMaxFrames = Math.max(
    1,
    Math.round(Number(maxFrames) || DEFAULT_COMBINED_ANIMATION_GIF_MAX_FRAMES),
  )
  const outputFrameCount = Math.min(
    safeMaxFrames,
    rows.reduce(
      (maximum, row) =>
        Math.max(maximum, Math.max(1, Math.ceil((row.frameCount * row.frameDelayMs) / safeOutputDelayMs))),
      1,
    ),
  )

  return {
    directionKeys: normalizedDirectionKeys,
    rows,
    outputDelayMs: safeOutputDelayMs,
    outputFrameCount,
  }
}

export const resolveCombinedAnimationRowFrameIndex = ({
  outputFrameIndex,
  outputDelayMs,
  rowFrameDelayMs,
  rowFrameCount,
}) => {
  const safeFrameCount = Math.max(1, Math.round(Number(rowFrameCount) || 0))
  const safeOutputFrameIndex = Math.max(0, Math.floor(Number(outputFrameIndex) || 0))
  const safeOutputDelayMs =
    Number.isFinite(Number(outputDelayMs)) && Number(outputDelayMs) > 0
      ? Number(outputDelayMs)
      : DEFAULT_COMBINED_ANIMATION_GIF_DELAY_MS
  const safeRowFrameDelayMs =
    Number.isFinite(Number(rowFrameDelayMs)) && Number(rowFrameDelayMs) > 0
      ? Number(rowFrameDelayMs)
      : safeOutputDelayMs

  return Math.floor((safeOutputFrameIndex * safeOutputDelayMs) / safeRowFrameDelayMs) % safeFrameCount
}
