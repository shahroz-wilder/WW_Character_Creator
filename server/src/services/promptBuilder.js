export const DEFAULT_MULTIVIEW_PROMPT = `full-length one full body character, Side VIEW ONLY, head-to-toe in frame
orthographic, neutral A-pose, light grey seamless background, sharp focus, No weapon, No cape`

const PORTRAIT_FALLBACK =
  'Create a stylized game-character portrait preserving the identity, costume, colors, and overall design of this reference.'

const PORTRAIT_PREFIX =
  'Create a stylized game-character identity portrait with torso and head in frame, square 1:1 composition, centered framing, clean studio background, sharp focus, and strong costume readability.'

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

  if (trimmedPrompt && hasReferenceImage) {
    return `${basePrompt} Use this direction: ${trimmedPrompt}`
  }

  if (trimmedPrompt) {
    return `${basePrompt} ${trimmedPrompt}`
  }

  if (hasReferenceImage) {
    return `${basePrompt} ${PORTRAIT_FALLBACK}`
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
    view === 'front' ? 'FRONT VIEW ONLY' : view === 'back' ? 'BACK VIEW ONLY' : 'Side VIEW ONLY'
  const viewSpecificPrompt = basePrompt.replace(
    /FRONT VIEW ONLY|BACK VIEW ONLY|Side VIEW ONLY/gi,
    specificViewLabel,
  )

  return viewSpecificPrompt.trim()
}
