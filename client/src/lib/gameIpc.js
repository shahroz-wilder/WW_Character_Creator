/**
 * Embedded mode utilities for hosting the character creator inside a game
 * client (native webview or iframe).
 *
 * Enable by loading the app with `?embedded=true`. Optionally provide a
 * `callbackUrl` query parameter — when set, the sprite frame data is POSTed
 * to that URL and the response is forwarded to the host via postMessage/IPC.
 * Without a callbackUrl the raw frame data is sent directly.
 */

/** Cached search params — URL does not change during the session. */
const _params = (() => {
  try {
    return new URLSearchParams(window.location.search)
  } catch {
    return new URLSearchParams()
  }
})()

/** True when the app was loaded with `?embedded=true`. */
export const isEmbeddedMode = () => _params.get('embedded') === 'true'

/** Server endpoint that accepts frame data and returns a processed result.
 *  Defaults to same-origin `/api/sprites/create` when in embedded mode. */
export const getCallbackUrl = () =>
  _params.get('callbackUrl') || (isEmbeddedMode() ? '/api/sprites/create' : '')

/** Optional player identity passed by the host. */
export const getPlayerId = () => _params.get('playerId') || ''

/** Optional sprite size override passed by the host (e.g. 128). */
export const getEmbeddedSpriteSize = () => {
  const val = Number(_params.get('spriteSize'))
  return val > 0 ? val : 0
}

// ---------------------------------------------------------------------------
// Low-level transport
// ---------------------------------------------------------------------------

const postToHost = (payload) => {
  // Native wry webview exposes window.ipc
  if (window.ipc?.postMessage) {
    window.ipc.postMessage(JSON.stringify(payload))
    return
  }

  // WASM iframe — post to parent window
  if (window.parent !== window) {
    window.parent.postMessage(payload, '*')
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send the finalized sprite data to the host application.
 *
 * If a `callbackUrl` was provided, the directions are POSTed there first and
 * the server's response is forwarded. Otherwise the raw directions are sent
 * directly so the host can process them.
 *
 * @param {Object} options
 * @param {Object} options.directions  - 8-direction frame data (keys: front, front_right, right, etc.)
 * @param {number} options.spriteSize  - Pixel size of each frame (64 | 84 | 128)
 * @param {string} [options.animation] - Animation name (e.g. 'walk')
 */
export const sendSpriteResult = async ({ directions, idleDirections, spriteSize, animation }) => {
  const callbackUrl = getCallbackUrl()

  if (callbackUrl) {
    try {
      const response = await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: getPlayerId(),
          directions,
          idleDirections,
          spriteSize,
          animation,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        throw new Error(errorText || `Callback responded with ${response.status}`)
      }

      const result = await response.json()

      // Forward the server's response (e.g. { sprite_url, sprite_hash, sprite_data })
      postToHost({ type: 'character-created', ...result })
    } catch (error) {
      // Let the host know something went wrong
      postToHost({ type: 'character-created-error', error: error.message || 'Callback failed' })
      throw error
    }
  } else {
    // No callback — send raw frame data so the host can handle assembly itself
    postToHost({
      type: 'character-created',
      directions,
      spriteSize,
      animation,
    })
  }
}

/** Tell the host the user wants to close without creating a sprite. */
export const sendClose = () => {
  postToHost({ type: 'character-creator-close' })
}
