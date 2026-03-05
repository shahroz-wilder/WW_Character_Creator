const formatStatus = (status) => status.replace(/_/g, ' ')

export function TripoJobPanel({
  job,
  canCreateModel,
  canCreateFrontBackModel,
  canCreateFrontModel,
  isCreatingModel,
  isCreatingFrontBackModel,
  isCreatingFrontModel,
  isRefreshingJob,
  onCreateModel,
  onCreateFrontBackModel,
  onCreateFrontModel,
  onForcePullResult,
  onDownloadModel,
  onResetView,
  hasViewer = false,
  embedded = false,
  showMeta = true,
  showUtilityActions = true,
}) {
  const Wrapper = embedded ? 'div' : 'section'
  const wrapperClassName = embedded ? 'job-panel job-panel--embedded' : 'panel-card job-panel'
  const actionRowClassName = embedded ? 'action-row action-row--compact' : 'action-row'

  return (
    <Wrapper className={wrapperClassName}>
      {showMeta ? (
        <>
          <div className={embedded ? 'job-panel__header' : 'section-heading'}>
            {embedded ? (
              <>
                <div className="section-heading section-heading--compact">
                  <p className="step-label">Tripo</p>
                  <h2>Task Controls</h2>
                </div>
                <div className="job-panel__viewer-meta">
                  <span className="job-panel__viewer-label">
                    {hasViewer ? 'Auto-rotate enabled' : 'Preview unavailable'}
                  </span>
                  <span className={`status-pill status-pill--${job.status}`}>
                    {formatStatus(job.status)}
                  </span>
                </div>
              </>
            ) : (
              <>
                <p className="step-label">Step 03</p>
                <h2>Tripo Task</h2>
              </>
            )}
          </div>
          <div className={embedded ? 'job-panel__meta' : 'meta-stack'}>
            {!embedded ? (
              <span className={`status-pill status-pill--${job.status}`}>{formatStatus(job.status)}</span>
            ) : null}
            <p className="job-panel__summary">
              {job.taskId
                ? `Task ${job.taskId}${job.progress ? ` - ${job.progress}%` : ''}`
                : 'No Tripo job has started yet.'}
            </p>
            {job.error ? <p className="error-copy">{job.error}</p> : null}
          </div>
        </>
      ) : null}
      <div className={actionRowClassName}>
        <button
          type="button"
          className="primary-button"
          disabled={!canCreateModel || isCreatingModel}
          onClick={onCreateModel}
        >
          {isCreatingModel ? 'Submitting 3D Multiview...' : '3D Multiview'}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={!canCreateFrontBackModel || isCreatingFrontBackModel}
          onClick={onCreateFrontBackModel}
        >
          {isCreatingFrontBackModel ? 'Submitting 3D FrontBack...' : '3D FrontBack'}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={!canCreateFrontModel || isCreatingFrontModel}
          onClick={onCreateFrontModel}
        >
          {isCreatingFrontModel ? 'Submitting 3D Front...' : '3D Front'}
        </button>
        {showUtilityActions ? (
          <>
            <button
              type="button"
              className="ghost-button"
              disabled={!job.taskId || isRefreshingJob}
              onClick={onForcePullResult}
            >
              {isRefreshingJob ? 'Pulling Result...' : 'Force Pull Result'}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={!job.outputs?.downloadUrl}
              onClick={onDownloadModel}
            >
              Download GLB
            </button>
            {embedded ? (
              <button
                type="button"
                className="ghost-button"
                disabled={!hasViewer}
                onClick={onResetView}
              >
                Reset View
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </Wrapper>
  )
}
