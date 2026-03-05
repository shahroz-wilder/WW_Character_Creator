import { buildViewPrompt, normalizeMultiviewPrompt } from './promptBuilder.js'
import { imageBufferToDataUrl } from '../utils/dataUrl.js'
import {
  normalizeForGemini,
  normalizeGeminiOutputSquare,
  mirrorHorizontally,
} from './imageTransformService.js'

const imagePart = (buffer) => ({
  inlineData: {
    mimeType: 'image/png',
    data: buffer.toString('base64'),
  },
})

export const createMultiviewService = ({
  geminiClient,
  geminiModel,
  geminiFallbackModels = [],
}) => ({
  async generateMultiview({
    portraitBuffer,
    characterPrompt,
    multiviewPrompt,
    mode = 'full',
  }) {
    const normalizedPortrait = await normalizeForGemini(portraitBuffer)
    const multiviewPromptBase = normalizeMultiviewPrompt(multiviewPrompt)

    const generateView = async (view) => {
      const parts = [
        { text: buildViewPrompt({ view, characterPrompt, multiviewPrompt: multiviewPromptBase }) },
        imagePart(normalizedPortrait),
      ]

      return geminiClient.generateImageFromParts({
        parts,
        model: geminiModel,
        fallbackModels: geminiFallbackModels,
      })
    }

    const front = await generateView('front')
    const normalizedFrontBuffer = await normalizeGeminiOutputSquare(front.buffer)

    if (mode === 'front-only') {
      return {
        mode,
        modelUsage: {
          front: front.modelUsed || '',
          back: '',
          left: '',
          right: '',
        },
        views: {
          front: {
            imageBuffer: normalizedFrontBuffer,
            imageDataUrl: imageBufferToDataUrl(normalizedFrontBuffer, 'image/png'),
            source: 'gemini',
          },
          back: {
            imageBuffer: null,
            imageDataUrl: '',
            source: 'front-test',
          },
          left: {
            imageBuffer: null,
            imageDataUrl: '',
            source: 'front-test',
          },
          right: {
            imageBuffer: null,
            imageDataUrl: '',
            source: 'front-test',
          },
        },
        promptMetadata: {
          frontPrompt: buildViewPrompt({ view: 'front', characterPrompt, multiviewPrompt: multiviewPromptBase }),
          backPrompt: buildViewPrompt({ view: 'back', characterPrompt, multiviewPrompt: multiviewPromptBase }),
          leftPrompt: buildViewPrompt({ view: 'left', characterPrompt, multiviewPrompt: multiviewPromptBase }),
          rightPrompt: buildViewPrompt({ view: 'right', characterPrompt, multiviewPrompt: multiviewPromptBase }),
          multiviewPromptBase,
        },
      }
    }

    const back = await generateView('back')
    const left = await generateView('left')
    const normalizedBackBuffer = await normalizeGeminiOutputSquare(back.buffer)
    const normalizedLeftBuffer = await normalizeGeminiOutputSquare(left.buffer)
    const rightBuffer = await mirrorHorizontally(normalizedLeftBuffer)

    return {
      mode,
      modelUsage: {
        front: front.modelUsed || '',
        back: back.modelUsed || '',
        left: left.modelUsed || '',
        right: left.modelUsed ? `${left.modelUsed} (mirrored-left)` : '',
      },
      views: {
        front: {
          imageBuffer: normalizedFrontBuffer,
          imageDataUrl: imageBufferToDataUrl(normalizedFrontBuffer, 'image/png'),
          source: 'gemini',
        },
        back: {
          imageBuffer: normalizedBackBuffer,
          imageDataUrl: imageBufferToDataUrl(normalizedBackBuffer, 'image/png'),
          source: 'gemini',
        },
        left: {
          imageBuffer: normalizedLeftBuffer,
          imageDataUrl: imageBufferToDataUrl(normalizedLeftBuffer, 'image/png'),
          source: 'gemini',
        },
        right: {
          imageBuffer: rightBuffer,
          imageDataUrl: imageBufferToDataUrl(rightBuffer, 'image/png'),
          source: 'mirrored-left',
        },
      },
      promptMetadata: {
        frontPrompt: buildViewPrompt({ view: 'front', characterPrompt, multiviewPrompt: multiviewPromptBase }),
        backPrompt: buildViewPrompt({ view: 'back', characterPrompt, multiviewPrompt: multiviewPromptBase }),
        leftPrompt: buildViewPrompt({ view: 'left', characterPrompt, multiviewPrompt: multiviewPromptBase }),
        rightPrompt: buildViewPrompt({ view: 'right', characterPrompt, multiviewPrompt: multiviewPromptBase }),
        multiviewPromptBase,
      },
    }
  },
})
