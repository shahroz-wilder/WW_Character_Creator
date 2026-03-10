import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env')

dotenv.config({
  path: envPath,
  override: true,
  quiet: true,
})

const parseBoolean = (value, fallback) => {
  if (value === undefined) {
    return fallback
  }

  return String(value).toLowerCase() === 'true'
}

const parseList = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

export const loadEnv = (source = process.env) => {
  const env = {
    port: Number(source.PORT || 5000),
    clientOrigin: source.CLIENT_ORIGIN || 'http://localhost:5173',
    geminiApiKey: source.GEMINI_API_KEY,
    geminiImageModel: source.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image-preview',
    geminiImageFallbackModels: parseList(source.GEMINI_IMAGE_FALLBACK_MODELS),
    tripoApiKey: source.TRIPO_API_KEY,
    tripoBaseUrl: source.TRIPO_BASE_URL || 'https://api.tripo3d.ai/v2/openapi',
    pixellabApiKey: source.PIXELLAB_API_KEY,
    pixellabBaseUrl: source.PIXELLAB_BASE_URL || 'https://api.pixellab.ai/v1',
    tripoModelVersion: source.TRIPO_MODEL_VERSION || 'v3.1-20260211',
    tripoTexture: parseBoolean(source.TRIPO_TEXTURE, true),
    tripoPbr: parseBoolean(source.TRIPO_PBR, true),
    tripoMeshQuality: source.TRIPO_MESH_QUALITY || 'standard',
    tripoTextureQuality: source.TRIPO_TEXTURE_QUALITY || 'standard',
    tripoTextureAlignment: source.TRIPO_TEXTURE_ALIGNMENT || 'original_image',
    tripoOrientation: source.TRIPO_ORIENTATION || 'default',
    tripoRigMixamo: parseBoolean(source.TRIPO_RIG_MIXAMO, true),
    tripoRigFormat: source.TRIPO_RIG_FORMAT || 'glb',
    tripoRigType: source.TRIPO_RIG_TYPE || 'biped',
    tripoRigSpec: source.TRIPO_RIG_SPEC || 'tripo',
    tripoRigModelVersion: source.TRIPO_RIG_MODEL_VERSION || 'v1.0-20240301',
    tripoIdleAnimationEnabled: parseBoolean(source.TRIPO_IDLE_ANIMATION_ENABLED, true),
    tripoIdleAnimationTaskType: source.TRIPO_IDLE_ANIMATION_TASK_TYPE || 'animate_model',
    tripoIdleAnimationName: source.TRIPO_IDLE_ANIMATION_NAME || 'preset:biped:wait',
    tripoIdleAnimationInPlace: parseBoolean(source.TRIPO_IDLE_ANIMATION_IN_PLACE, true),
    spritesDir: source.SPRITES_DIR || 'sprites',
    spritesPublicUrl: source.SPRITES_PUBLIC_URL || '',
  }

  const missingKeys = []

  if (!env.geminiApiKey) {
    missingKeys.push('GEMINI_API_KEY')
  }

  if (!env.tripoApiKey) {
    missingKeys.push('TRIPO_API_KEY')
  }

  // PIXELLAB_API_KEY is only needed for the 2D sprite generation pipeline
  // (/api/sprites/run). The 3D Tripo pipeline captures sprites client-side.

  if (missingKeys.length > 0) {
    throw new Error(`Missing required environment variables: ${missingKeys.join(', ')}`)
  }

  return env
}
