const formatStatus = (status) => status.replace(/_/g, ' ')

export function TripoJobPanel({
  job,
  canCreateModel,
  canCreateFrontModel,
  isCreatingModel,
  isCreatingFrontModel,
  isRefreshingJob,
  onCreateModel,
  onCreateFrontModel,
  onForcePullResult,
  onDownloadModel,
  embedded = false,
}) {
  const Wrapper = embedded ? 'div' : 'section'
  const wrapperClassName = embedded ? 'job-panel job-panel--embedded' : 'panel-card job-panel'

  return (
    <Wrapper className={wrapperClassName}>
      <div className="section-heading">
        <p className="step-label">Step 03</p>
        <h2>Tripo Task</h2>
      </div>
      <div className="meta-stack">
        <span className={`status-pill status-pill--${job.status}`}>{formatStatus(job.status)}</span>
        <p>
          {job.taskId
            ? `Task ${job.taskId}${job.progress ? ` - ${job.progress}%` : ''}`
            : 'No Tripo job has started yet.'}
        </p>
        {job.error ? <p className="error-copy">{job.error}</p> : null}
      </div>
      <div className="action-row">
        <button
          type="button"
          className="primary-button"
          disabled={!canCreateModel || isCreatingModel}
          onClick={onCreateModel}
        >
          {isCreatingModel ? 'Submitting to Tripo...' : 'Create 3D Model'}
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={!canCreateFrontModel || isCreatingFrontModel}
          onClick={onCreateFrontModel}
        >
          {isCreatingFrontModel ? 'Submitting Front View...' : 'Create 3D From Front View'}
        </button>
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
      </div>
    </Wrapper>
  )
}
