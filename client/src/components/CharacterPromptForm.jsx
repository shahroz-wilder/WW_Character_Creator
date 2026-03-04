import { ReferenceUpload } from './ReferenceUpload'

export function CharacterPromptForm({
  prompt,
  onPromptChange,
  referenceImage,
  onReferenceImageChange,
  onGeneratePortrait,
  onReset,
  isGeneratingPortrait,
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
      <textarea
        id="character-prompt"
        className="prompt-textarea"
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        placeholder="Stylized sci-fi ranger with ceramic shoulder plates, bright copper trims, soft freckles, calm expression..."
        rows={7}
        disabled={isGeneratingPortrait}
      />

      <div className="action-row action-row--portrait">
        <ReferenceUpload
          compact
          value={referenceImage}
          disabled={isGeneratingPortrait}
          onChange={onReferenceImageChange}
        />
        <button
          type="button"
          className="primary-button"
          onClick={onGeneratePortrait}
          disabled={isGeneratingPortrait}
          aria-label="Generate Portrait"
        >
          {isGeneratingPortrait ? 'Generating...' : 'Generate'}
        </button>
        <button
          type="button"
          className="icon-button icon-button--reset"
          onClick={onReset}
          disabled={isGeneratingPortrait}
          aria-label="Reset Session"
          title="Reset Session"
        >
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path
              d="M7 7.5V4.5m0 0H4m3 0l-2 2"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M7.5 6.5a8 8 0 1 1-1.6 9.1"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="visually-hidden">Reset Session</span>
        </button>
      </div>
    </section>
  )
}
