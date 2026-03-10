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

/**
 * Assemble individual animation frames into a single sprite sheet PNG.
 *
 * @param {Object} directions - 8-direction frame data { front: { frameDataUrls: [...] }, ... }
 * @param {number} spriteSize - Source frame pixel size (64 | 84 | 128)
 * @returns {{ buffer: Buffer, hash: string }}
 */
export async function assembleSheet(directions, spriteSize = 128) {
  if (!directions || typeof directions !== 'object') {
    throw new AppError('Missing directions for sheet assembly', 400)
  }

  const composites = []

  for (const [direction, row] of Object.entries(DIRECTION_ROW_MAP)) {
    // Use the direction's frames, or fall back to nearest cardinal for diagonals
    let dirData = directions[direction]
    if (!dirData?.frameDataUrls?.length && DIAGONAL_FALLBACK[direction]) {
      dirData = directions[DIAGONAL_FALLBACK[direction]]
    }
    if (!dirData?.frameDataUrls?.length) continue

    const frames = dirData.frameDataUrls

    // Column 0: idle frame (first animation frame)
    const idleBuffer = await resizeFrame(frames[0], spriteSize)
    composites.push({
      input: idleBuffer,
      top: row * FRAME_SIZE,
      left: 0,
    })

    // Columns 1-4: walk/run frames (take up to 4, wrap if fewer)
    const walkFrames = frames.slice(0, 4)
    for (let col = 0; col < 4; col++) {
      const frameUrl = walkFrames[col % walkFrames.length]
      const frameBuffer = await resizeFrame(frameUrl, spriteSize)
      composites.push({
        input: frameBuffer,
        top: row * FRAME_SIZE,
        left: (col + 1) * FRAME_SIZE,
      })
    }
  }

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

  return sharp(buffer)
    .resize(FRAME_SIZE, FRAME_SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sourceSize <= 64 ? sharp.kernel.nearest : sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer()
}
