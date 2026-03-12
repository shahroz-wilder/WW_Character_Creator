import fs from 'node:fs/promises'
import path from 'node:path'

export const createStorageService = ({ config }) => {
  const spritesDir = path.resolve(config.spritesDir || 'sprites')
  const publicUrl = config.spritesPublicUrl || `http://localhost:${config.port}/sprites`

  return {
    spritesDir,

    async uploadPlayerAsset(playerId, filename, buffer) {
      const safeId = path.basename(playerId)
      if (!safeId || safeId === '.' || safeId === '..') {
        throw new Error('Invalid playerId')
      }
      const safeFilename = path.basename(filename)
      const dir = path.join(spritesDir, safeId)
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(path.join(dir, safeFilename), buffer)
      return `${publicUrl}/${safeId}/${safeFilename}`
    },

    async uploadSpriteSheet(playerId, buffer, hash) {
      // Sanitize playerId to prevent path traversal
      const safeId = path.basename(playerId)
      if (!safeId || safeId === '.' || safeId === '..') {
        throw new Error('Invalid playerId')
      }
      if (!/^[a-f0-9]+$/.test(hash)) {
        throw new Error('Invalid hash')
      }
      const dir = path.join(spritesDir, safeId)
      await fs.mkdir(dir, { recursive: true })

      const filename = `${hash}.png`
      await fs.writeFile(path.join(dir, filename), buffer)

      return `${publicUrl}/${safeId}/${filename}`
    },
  }
}
