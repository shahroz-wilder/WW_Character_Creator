import { ReferenceUpload } from './ReferenceUpload'

export function CharacterPromptForm({
  prompt,
  onPromptChange,
  referenceImage,
  onReferenceImageChange,
  onGeneratePortrait,
  isGeneratingPortrait,
  embedded = false,
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

      <div className="action-row action-row--portrait">
        <button
          type="button"
          className="primary-button"
          onClick={onGeneratePortrait}
          disabled={isGeneratingPortrait}
          aria-label="Generate 2D"
        >
          {isGeneratingPortrait ? 'Generating 2D...' : 'Generate 2D'}
        </button>
      </div>
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
