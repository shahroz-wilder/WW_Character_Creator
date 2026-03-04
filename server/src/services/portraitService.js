import { buildPortraitPrompt } from './promptBuilder.js'
import { imageBufferToDataUrl } from '../utils/dataUrl.js'
import { normalizeForGemini, normalizePortraitToAspectRatio } from './imageTransformService.js'

const imagePart = (buffer, mimeType = 'image/png') => ({
  inlineData: {
    mimeType,
    data: buffer.toString('base64'),
  },
})

export const createPortraitService = ({ geminiClient, geminiModel }) => ({
  async generatePortrait({
    prompt,
    referenceImageBuffer,
    portraitPromptPreset,
    portraitAspectRatio,
  }) {
    const normalizedReference = referenceImageBuffer
      ? await normalizeForGemini(referenceImageBuffer)
      : null
    const promptUsed = buildPortraitPrompt({
      prompt,
      hasReferenceImage: Boolean(referenceImageBuffer),
      portraitPromptPreset,
      portraitAspectRatio,
    })
    const parts = [{ text: promptUsed }]

    if (normalizedReference) {
      parts.push(imagePart(normalizedReference))
    }

    const generated = await geminiClient.generateImageFromParts({
      parts,
      model: geminiModel,
    })

    const normalizedPortraitBuffer = await normalizePortraitToAspectRatio(
      generated.buffer,
      portraitAspectRatio || '1:1',
    )

    return {
      imageBuffer: normalizedPortraitBuffer,
      imageDataUrl: imageBufferToDataUrl(normalizedPortraitBuffer, 'image/png'),
      promptUsed,
      inputMode:
        prompt?.trim() && referenceImageBuffer
          ? 'prompt+image'
          : prompt?.trim()
            ? 'prompt'
            : 'image',
      normalizedReferenceImageDataUrl: normalizedReference
        ? imageBufferToDataUrl(normalizedReference, 'image/png')
        : null,
    }
  },
})
