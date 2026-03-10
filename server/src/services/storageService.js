import fs from 'node:fs/promises'
import path from 'node:path'

export const createStorageService = ({ config }) => {
  const spritesDir = path.resolve(config.spritesDir || 'sprites')
  const publicUrl = config.spritesPublicUrl || `http://localhost:${config.port}/sprites`

  return {
    spritesDir,

    async uploadSpriteSheet(playerId, buffer, hash) {
      // Sanitize playerId to prevent path traversal
      const safeId = path.basename(playerId)
      if (!safeId || safeId === '.' || safeId === '..') {
        throw new Error('Invalid playerId')
      }
      const dir = path.join(spritesDir, safeId)
      await fs.mkdir(dir, { recursive: true })

      const filename = `${hash}.png`
      await fs.writeFile(path.join(dir, filename), buffer)

      return `${publicUrl}/${safeId}/${filename}`
    },
  }
}
