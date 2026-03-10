import sharp from 'sharp'
import crypto from 'node:crypto'
import { parseImageDataUrl } from '../utils/dataUrl.js'
import { AppError } from '../utils/errors.js'

/**
 * Sprite sheet layout (matches Shanty Town CharacterAtlas):
 * - Frame size: 128x128 pixels
 * - 5 columns: 1 idle + 4 walk frames
 * - 8 rows: S, SW, W, NW, N, NE, E, SE
 * - Total: 640x1024 pixels
 *
 * Directions map to rows:
 *   front       → row 0 (S)
 *   front_right  → row 7 (SE)
 *   right       → row 6 (E)
 *   back_right   → row 5 (NE)
 *   back        → row 4 (N)
 *   back_left    → row 3 (NW)
 *   left        → row 2 (W)
 *   front_left   → row 1 (SW)
 */

const FRAME_SIZE = 128
const COLS = 5
const ROWS = 8
const SHEET_WIDTH = FRAME_SIZE * COLS
const SHEET_HEIGHT = FRAME_SIZE * ROWS

const DIRECTION_ROW_MAP = {
  front: 0,
  front_left: 1,
  left: 2,
  back_left: 3,
  back: 4,
  back_right: 5,
  right: 6,
  front_right: 7,
}

// Fallback: if a diagonal direction is missing, use nearest cardinal
const DIAGONAL_FALLBACK = {
  front_left: 'front',
  back_left: 'back',
  back_right: 'back',
  front_right: 'front',
}

/** Resolve a direction's data, falling back to nearest cardinal for diagonals. */
const resolveDirection = (dirs, direction) => {
  const data = dirs?.[direction]
  if (data?.frameDataUrls?.length) return data
  return DIAGONAL_FALLBACK[direction] ? dirs?.[DIAGONAL_FALLBACK[direction]] ?? null : null
}

/**
 * Assemble individual animation frames into a single sprite sheet PNG.
 *
 * @param {Object} options
 * @param {Object} options.directions   - 8-direction walk frame data { front: { frameDataUrls }, ... }
 * @param {Object} [options.idleDirections] - Optional 8-direction idle frame data
 * @param {number} [options.spriteSize] - Source frame pixel size (64 | 84 | 128)
 * @returns {{ buffer: Buffer, hash: string }}
 */
export async function assembleSheet({ directions, idleDirections = null, spriteSize = 128 }) {
  if (!directions || typeof directions !== 'object') {
    throw new AppError('Missing directions for sheet assembly', 400)
  }

  const resizeTasks = []

  for (const [direction, row] of Object.entries(DIRECTION_ROW_MAP)) {
    const dirData = resolveDirection(directions, direction)
    if (!dirData?.frameDataUrls?.length) continue

    const frames = dirData.frameDataUrls

    // Column 0: idle frame — use dedicated idle animation if available, otherwise first walk frame
    const idleDirData = resolveDirection(idleDirections, direction)
    const idleFrameUrl = idleDirData?.frameDataUrls?.[0] || frames[0]
    resizeTasks.push({ dataUrl: idleFrameUrl, spriteSize, top: row * FRAME_SIZE, left: 0 })

    // Columns 1-4: walk/run frames (take up to 4, wrap if fewer)
    const walkFrames = frames.slice(0, 4)
    for (let col = 0; col < 4; col++) {
      const frameUrl = walkFrames[col % walkFrames.length]
      resizeTasks.push({ dataUrl: frameUrl, spriteSize, top: row * FRAME_SIZE, left: (col + 1) * FRAME_SIZE })
    }
  }

  const resizedBuffers = await Promise.all(resizeTasks.map((t) => resizeFrame(t.dataUrl, t.spriteSize)))
  const composites = resizeTasks.map((t, i) => ({ input: resizedBuffers[i], top: t.top, left: t.left }))

  if (composites.length === 0) {
    throw new AppError('No valid frame data found in any direction', 400)
  }

  const sheet = await sharp({
    create: {
      width: SHEET_WIDTH,
      height: SHEET_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer()

  const hash = crypto.createHash('sha256').update(sheet).digest('hex').slice(0, 16)

  return { buffer: sheet, hash }
}

async function resizeFrame(dataUrl, sourceSize) {
  const { buffer } = parseImageDataUrl(dataUrl)

  if (sourceSize === FRAME_SIZE) {
    return sharp(buffer).png().toBuffer()
  }

  return sharp(buffer)
    .resize(FRAME_SIZE, FRAME_SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sourceSize <= 64 ? sharp.kernel.nearest : sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer()
}
