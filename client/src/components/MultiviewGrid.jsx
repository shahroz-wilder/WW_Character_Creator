import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

const VIEW_LABELS = {
  front: 'Front',
  back: 'Back',
  left: 'Left',
  right: 'Right',
}

export function MultiviewGrid({ views, mode = 'full', embedded = false }) {
  const [expandedView, setExpandedView] = useState(null)

  useEffect(() => {
    if (!expandedView) {
      return undefined
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setExpandedView(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [expandedView])

  const handleExpand = (key, label, imageDataUrl) => {
    if (!imageDataUrl) {
      return
    }

    setExpandedView({
      key,
      label,
      imageDataUrl,
    })
  }

  const renderExpandedView = () => {
    if (!expandedView) {
      return null
    }

    if (typeof document === 'undefined' || !document.body) {
      return null
    }

    return createPortal(
      <div
        className="view-lightbox"
        role="dialog"
        aria-modal="true"
        aria-label={`${expandedView.label} multiview image preview`}
        onClick={() => setExpandedView(null)}
      >
        <div className="view-lightbox__content" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className="view-lightbox__close"
            onClick={() => setExpandedView(null)}
            aria-label="Close preview"
          >
            Close
          </button>
          <p className="view-lightbox__label">{expandedView.label}</p>
          <img src={expandedView.imageDataUrl} alt={`${expandedView.label} character view enlarged`} />
        </div>
      </div>,
      document.body,
    )
  }

  if (embedded) {
    return (
      <>
        <div className="multiview-grid">
          {Object.entries(VIEW_LABELS).map(([key, label]) => (
            <article className="view-card" key={key}>
              <span className="view-card__label">{label}</span>
              {views?.[key]?.imageDataUrl ? (
                <>
                  <span className="zoom-badge" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z" stroke="currentColor" strokeWidth="1.7" />
                      <path d="m16.25 16.25 3.75 3.75" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                    </svg>
                  </span>
                  <img
                    src={views[key].imageDataUrl}
                    alt={`${label} character view`}
                    title="Click to expand"
                    onClick={() => handleExpand(key, label, views[key].imageDataUrl)}
                  />
                </>
              ) : (
                <div className="empty-state empty-state--compact">
                  <p>
                    {mode === 'front-only' && key !== 'front'
                      ? `${label} skipped in front test.`
                      : `${label} will appear here.`}
                  </p>
                </div>
              )}
            </article>
          ))}
        </div>
        {renderExpandedView()}
      </>
    )
  }

  return (
    <>
      <section className="panel-card panel-card--wide">
        <div className="section-heading">
          <p className="step-label">Turnaround</p>
          <h2>Orthographic Set</h2>
        </div>
        {mode === 'front-only' ? (
          <p className="visually-hidden">
            Front test generated. Run the full turnaround to create back, left, and mirrored right.
          </p>
        ) : null}
        <div className="multiview-grid">
          {Object.entries(VIEW_LABELS).map(([key, label]) => (
            <article className="view-card" key={key}>
              <header>
                <span>{label}</span>
                <small>{views?.[key]?.source || 'pending'}</small>
              </header>
              {views?.[key]?.imageDataUrl ? (
                <>
                  <span className="zoom-badge" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z" stroke="currentColor" strokeWidth="1.7" />
                      <path d="m16.25 16.25 3.75 3.75" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                    </svg>
                  </span>
                  <img
                    src={views[key].imageDataUrl}
                    alt={`${label} character view`}
                    title="Click to expand"
                    onClick={() => handleExpand(key, label, views[key].imageDataUrl)}
                  />
                </>
              ) : (
                <div className="empty-state empty-state--compact">
                  <p>{mode === 'front-only' && key !== 'front' ? `${label} skipped in front test.` : `${label} will appear here.`}</p>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
      {renderExpandedView()}
    </>
  )
}
