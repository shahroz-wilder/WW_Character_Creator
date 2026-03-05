export const DEFAULT_MULTIVIEW_PROMPT = `full-length one full body character, Side VIEW ONLY, head-to-toe in frame
orthographic, neutral A-pose, light grey seamless background, sharp focus, No weapon, No cape`

const PORTRAIT_FALLBACK =
  'Create a stylized game-character portrait preserving the identity, costume, colors, and overall design of this reference.'

const PORTRAIT_PREFIX =
  'Create a stylized game-character identity portrait with torso and head in frame, square 1:1 composition, centered framing, clean studio background, sharp focus, and strong costume readability.'

const PORTRAIT_REFERENCE_PREFIX =
  'Use the provided reference image as the primary identity and style anchor. Keep the same character identity, costume, colors, and art style. Create a torso-and-head portrait with clean studio background and sharp focus.'

const REFERENCE_DIRECTION_MAX_CHARS = 320

const truncateReferenceDirection = (value) => {
  const trimmed = value?.trim() || ''
  if (!trimmed) {
    return ''
  }

  if (trimmed.length <= REFERENCE_DIRECTION_MAX_CHARS) {
    return trimmed
  }

  return `${trimmed.slice(0, REFERENCE_DIRECTION_MAX_CHARS)}...`
}

export const buildPortraitPrompt = ({
  prompt,
  hasReferenceImage,
  portraitPromptPreset,
  portraitAspectRatio,
}) => {
  const trimmedPrompt = prompt?.trim()
  const normalizedAspectRatio = portraitAspectRatio?.trim() || '1:1'
  const preset = portraitPromptPreset?.trim() || PORTRAIT_PREFIX
  const basePrompt = `${preset} Output aspect ratio: ${normalizedAspectRatio}.`
  const referenceBasePrompt = `${preset} ${PORTRAIT_REFERENCE_PREFIX} Output aspect ratio: ${normalizedAspectRatio}.`

  if (trimmedPrompt && hasReferenceImage) {
    const shortenedDirection = truncateReferenceDirection(trimmedPrompt)
    return `${referenceBasePrompt} Apply this direction while preserving identity: ${shortenedDirection}`
  }

  if (trimmedPrompt) {
    return `${basePrompt} ${trimmedPrompt}`
  }

  if (hasReferenceImage) {
    return `${referenceBasePrompt} ${PORTRAIT_FALLBACK}`
  }

  return `${basePrompt} Design a distinctive stylized character portrait.`
}

export const normalizeMultiviewPrompt = (prompt) => {
  const trimmedPrompt = prompt?.trim()
  return trimmedPrompt || DEFAULT_MULTIVIEW_PROMPT
}

export const buildViewPrompt = ({ view, characterPrompt, multiviewPrompt }) => {
  const basePrompt = normalizeMultiviewPrompt(multiviewPrompt)
  const specificViewLabel =
    view === 'front'
      ? 'FRONT VIEW ONLY'
      : view === 'back'
        ? 'BACK VIEW ONLY'
        : view === 'left'
          ? 'LEFT VIEW ONLY'
          : view === 'right'
            ? 'RIGHT VIEW ONLY'
            : 'Side VIEW ONLY'
  const viewSpecificPrompt = basePrompt.replace(
    /FRONT VIEW ONLY|BACK VIEW ONLY|LEFT VIEW ONLY|RIGHT VIEW ONLY|Side VIEW ONLY/gi,
    specificViewLabel,
  )

  return viewSpecificPrompt.trim()
}
