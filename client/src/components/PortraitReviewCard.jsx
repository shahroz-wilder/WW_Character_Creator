import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

const PortraitContent = ({ portraitResult, square = false, onExpand }) =>
  portraitResult ? (
    <div className={`portrait-card${square ? ' portrait-card--square' : ''}`}>
      <span className="zoom-badge" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z" stroke="currentColor" strokeWidth="1.7" />
          <path d="m16.25 16.25 3.75 3.75" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </span>
      <img
        src={portraitResult.imageDataUrl}
        alt="Generated character portrait"
        title="Click to expand"
        onClick={() => onExpand?.(portraitResult.imageDataUrl)}
      />
    </div>
  ) : (
    <div className={`portrait-card portrait-card--empty${square ? ' portrait-card--square' : ''}`}>
      <div className="empty-state empty-state--portrait">
        <p>The first generated portrait becomes the identity anchor for the turnaround stage.</p>
      </div>
    </div>
  )

export function PortraitReviewCard({ portraitResult, embedded = false, square = false }) {
  const [expandedImageUrl, setExpandedImageUrl] = useState('')

  useEffect(() => {
    if (!expandedImageUrl) {
      return undefined
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setExpandedImageUrl('')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [expandedImageUrl])

  const renderExpandedPortrait = () => {
    if (!expandedImageUrl) {
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
        aria-label="Portrait image preview"
        onClick={() => setExpandedImageUrl('')}
      >
        <div className="view-lightbox__content" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className="view-lightbox__close"
            onClick={() => setExpandedImageUrl('')}
            aria-label="Close preview"
          >
            Close
          </button>
          <p className="view-lightbox__label">Portrait</p>
          <img src={expandedImageUrl} alt="Generated character portrait enlarged" />
        </div>
      </div>,
      document.body,
    )
  }

  if (embedded) {
    return (
      <>
        <PortraitContent
          portraitResult={portraitResult}
          square={square}
          onExpand={setExpandedImageUrl}
        />
        {renderExpandedPortrait()}
      </>
    )
  }

  return (
    <>
      <section className="panel-card">
        <div className="section-heading">
          <p className="step-label">Portrait</p>
          <h2>Review Identity</h2>
        </div>
        <PortraitContent
          portraitResult={portraitResult}
          square={square}
          onExpand={setExpandedImageUrl}
        />
      </section>
      {renderExpandedPortrait()}
    </>
  )
}
