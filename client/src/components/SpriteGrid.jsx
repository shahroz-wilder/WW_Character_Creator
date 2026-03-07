import { useEffect, useMemo, useState } from 'react'

const SPRITE_VIEW_SLOTS = [
  { key: 'view_360', label: '360', aliases: ['view_360', '360', 'turn360', 'orbit'] },
  { key: 'front', label: 'Front', aliases: ['front'] },
  { key: 'front_right', label: 'FrontRight', aliases: ['front_right', 'frontRight', 'frontright'] },
  { key: 'right', label: 'Right', aliases: ['right'] },
  { key: 'back_right', label: 'BackRight', aliases: ['back_right', 'backRight', 'backright'] },
  { key: 'back', label: 'Back', aliases: ['back'] },
  { key: 'back_left', label: 'BackLeft', aliases: ['back_left', 'backLeft', 'backleft', 'beckleft'] },
  { key: 'left', label: 'Left', aliases: ['left'] },
  { key: 'front_left', label: 'FrontLeft', aliases: ['front_left', 'frontLeft', 'frontleft'] },
]

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

  const keys = Array.isArray(aliases) ? aliases : []
  for (const alias of keys) {
    if (directions?.[alias]) {
      return directions[alias]
    }
  }

  return null
}

const AnimatedSpriteTile = ({ direction, label }) => {
  const frames = useMemo(() => getFrames(direction), [direction])
  const [frameIndex, setFrameIndex] = useState(0)
  const [hasImageError, setHasImageError] = useState(false)

  useEffect(() => {
    setFrameIndex(0)
    setHasImageError(false)
  }, [frames.length, direction?.previewDataUrl])

  useEffect(() => {
    if (frames.length <= 1) {
      return undefined
    }

    const intervalId = window.setInterval(() => {
      setFrameIndex((value) => (value + 1) % frames.length)
    }, 110)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [frames])

  if (frames.length === 0 || hasImageError) {
    return (
      <div className="empty-state empty-state--compact">
        <p>{label} run preview will appear here.</p>
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

export function SpriteGrid({ directions, embedded = false }) {
  const renderGrid = () => (
    <div className="sprite-grid">
      {SPRITE_VIEW_SLOTS.map(({ key, label, aliases }) => (
        <article className="view-card" key={key}>
          <span className="view-card__label">{label}</span>
          <AnimatedSpriteTile direction={resolveDirectionByAliases(directions, aliases)} label={label} />
        </article>
      ))}
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
