const PortraitContent = ({ portraitResult, square = false }) =>
  portraitResult ? (
    <div className={`portrait-card${square ? ' portrait-card--square' : ''}`}>
      <img src={portraitResult.imageDataUrl} alt="Generated character portrait" />
    </div>
  ) : (
    <div className={`portrait-card portrait-card--empty${square ? ' portrait-card--square' : ''}`}>
      <div className="empty-state empty-state--portrait">
        <p>The first generated portrait becomes the identity anchor for the turnaround stage.</p>
      </div>
    </div>
  )

export function PortraitReviewCard({ portraitResult, embedded = false, square = false }) {
  if (embedded) {
    return <PortraitContent portraitResult={portraitResult} square={square} />
  }

  return (
    <section className="panel-card">
      <div className="section-heading">
        <p className="step-label">Portrait</p>
        <h2>Review Identity</h2>
      </div>
      <PortraitContent portraitResult={portraitResult} square={square} />
    </section>
  )
}
