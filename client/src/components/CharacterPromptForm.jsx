import { ReferenceUpload } from './ReferenceUpload'

export function CharacterPromptForm({
  prompt,
  onPromptChange,
  referenceImage,
  onReferenceImageChange,
  onGeneratePortrait,
  onAccept,
  isGeneratingPortrait,
  isAcceptDisabled = false,
  title = 'Identity Portrait',
  stepLabel = 'Step 01',
}) {
  return (
    <section className="panel-card">
      <div className="panel-heading-shell">
        <div className="section-heading">
          <p className="step-label">{stepLabel}</p>
          <h2>{title}</h2>
        </div>
      </div>
      <label className="visually-hidden" htmlFor="character-prompt">
        Character prompt
      </label>
      <div className="prompt-textarea-shell">
        <textarea
          id="character-prompt"
          className="prompt-textarea"
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder="Stylized sci-fi ranger with ceramic shoulder plates, bright copper trims, soft freckles, calm expression..."
          rows={7}
          disabled={isGeneratingPortrait}
        />
        <ReferenceUpload
          compact
          value={referenceImage}
          disabled={isGeneratingPortrait}
          onChange={onReferenceImageChange}
        />
      </div>

      <div className="action-row action-row--portrait">
        <button
          type="button"
          className="primary-button"
          onClick={onGeneratePortrait}
          disabled={isGeneratingPortrait}
          aria-label="Generate PFP"
        >
          {isGeneratingPortrait ? 'Generating PFP...' : 'Generate PFP'}
        </button>
        <button
          type="button"
          className="accept-button accept-button--icon-only"
          onClick={onAccept}
          disabled={isGeneratingPortrait || isAcceptDisabled}
          aria-label="Accept Portrait"
        >
          <span className="accept-button__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M6.5 12.5 10.5 16.5 18 8.8"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </button>
      </div>
    </section>
  )
}
