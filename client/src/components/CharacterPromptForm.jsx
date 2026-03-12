import { ReferenceUpload } from './ReferenceUpload'

export function CharacterPromptForm({
  prompt,
  onPromptChange,
  referenceImage,
  onReferenceImageChange,
  onGeneratePortrait,
  isGeneratingPortrait,
  embedded = false,
  hideGenerateButton = false,
  title = 'Identity Portrait',
  stepLabel = 'Step 01',
}) {
  const formBody = (
    <>
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

      {!hideGenerateButton && (
        <div className="action-row action-row--portrait">
          <button
            type="button"
            className="primary-button"
            onClick={onGeneratePortrait}
            disabled={isGeneratingPortrait}
            aria-label="Generate Portrait"
          >
            {isGeneratingPortrait ? 'Generating...' : 'Generate Portrait'}
          </button>
        </div>
      )}
    </>
  )

  if (embedded) {
    return <div className="character-prompt character-prompt--embedded">{formBody}</div>
  }

  return (
    <section className="panel-card">
      <div className="panel-heading-shell">
        <div className="section-heading">
          <p className="step-label">{stepLabel}</p>
          <h2>{title}</h2>
        </div>
      </div>
      {formBody}
    </section>
  )
}
