import { useEffect, useMemo, useState } from 'react'

const DEFAULT_PREVIEW_FRAME_DELAY_MS = 110

const SPRITE_VIEW_SLOTS = [
  { key: 'front', label: 'Front', aliases: ['front'] },
  { key: 'front_right', label: 'FrontRight', aliases: ['front_right', 'frontRight', 'frontright'] },
  { key: 'right', label: 'Right', aliases: ['right'] },
  { key: 'back_right', label: 'BackRight', aliases: ['back_right', 'backRight', 'backright'] },
  { key: 'back', label: 'Back', aliases: ['back'] },
  { key: 'back_left', label: 'BackLeft', aliases: ['back_left', 'backLeft', 'backleft', 'beckleft'] },
  { key: 'left', label: 'Left', aliases: ['left'] },
  { key: 'front_left', label: 'FrontLeft', aliases: ['front_left', 'frontLeft', 'frontleft'] },
]
const SPRITE_360_SLOT = {
  key: 'view_360',
  label: '360',
  aliases: ['view_360', 'view360', '360'],
}

const getFrames = (direction) => {
  if (Array.isArray(direction?.frameDataUrls) && direction.frameDataUrls.length > 0) {
    return direction.frameDataUrls
  }

  if (direction?.previewDataUrl) {
    return [direction.previewDataUrl]
  }

  return []
}

const resolveDirectionByAliases = (directions, aliases = []) => {
  if (!directions || typeof directions !== 'object') {
    return null
  }

  for (const alias of aliases) {
    if (directions?.[alias]) {
      return directions[alias]
    }
  }

  return null
}

const AnimatedSpriteTile = ({ direction, label, emptyCopy }) => {
  const frames = useMemo(() => getFrames(direction), [direction])
  const frameDelayMs = useMemo(() => {
    const normalizedDelayMs = Number(direction?.delayMs)
    return Number.isFinite(normalizedDelayMs) && normalizedDelayMs > 0
      ? normalizedDelayMs
      : DEFAULT_PREVIEW_FRAME_DELAY_MS
  }, [direction?.delayMs])
  const [frameIndex, setFrameIndex] = useState(0)
  const [hasImageError, setHasImageError] = useState(false)

  useEffect(() => {
    setFrameIndex(0)
    setHasImageError(false)
  }, [frames.length, direction?.previewDataUrl, frameDelayMs])

  useEffect(() => {
    if (frames.length <= 1) {
      return undefined
    }

    const intervalId = window.setInterval(() => {
      setFrameIndex((value) => (value + 1) % frames.length)
    }, frameDelayMs)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [frameDelayMs, frames])

  if (frames.length === 0 || hasImageError) {
    return (
      <div className="empty-state empty-state--compact">
        <p>{emptyCopy || `${label} run preview will appear here.`}</p>
      </div>
    )
  }

  return (
    <img
      src={frames[frameIndex]}
      alt={`${label} run sprite preview`}
      onError={() => setHasImageError(true)}
    />
  )
}

export function SpriteGrid({ directions, displayMode = 'view_360', embedded = false }) {
  const renderGrid = () => (
    <div className="sprite-grid">
      {displayMode === 'view_360' ? (
        <article className="view-card" key={SPRITE_360_SLOT.key}>
          <span className="view-card__label">{SPRITE_360_SLOT.label}</span>
          <AnimatedSpriteTile
            direction={resolveDirectionByAliases(directions, SPRITE_360_SLOT.aliases)}
            label={SPRITE_360_SLOT.label}
            emptyCopy="360 preview will appear here."
          />
        </article>
      ) : (
        SPRITE_VIEW_SLOTS.map(({ key, label, aliases }) => (
          <article className="view-card" key={key}>
            <span className="view-card__label">{label}</span>
            <AnimatedSpriteTile
              direction={resolveDirectionByAliases(directions, aliases)}
              label={label}
            />
          </article>
        ))
      )}
    </div>
  )

  if (embedded) {
    return renderGrid()
  }

  return (
    <section className="panel-card panel-card--wide">
      <div className="section-heading">
        <p className="step-label">Step 04</p>
        <h2>Sprite</h2>
      </div>
      {renderGrid()}
    </section>
  )
}
