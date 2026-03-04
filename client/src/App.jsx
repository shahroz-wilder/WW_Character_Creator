import { lazy, Suspense, useEffect, useState } from 'react'
import {
  createTripoFrontTask,
  createTripoTask,
  generateMultiview,
  generatePortrait,
  getTripoTask,
} from './api/characterApi'
import { DEFAULT_MULTIVIEW_PROMPT } from './constants/prompts'
import { CharacterPromptForm } from './components/CharacterPromptForm'
import { HistoryPanel } from './components/HistoryPanel'
import { MultiviewGrid } from './components/MultiviewGrid'
import { MultiviewPromptEditor } from './components/MultiviewPromptEditor'
import { PortraitReviewCard } from './components/PortraitReviewCard'
import { TripoJobPanel } from './components/TripoJobPanel'
import { downloadFromUrl } from './lib/download'
import { createHistoryEntry, createRunId, updateHistoryEntry } from './lib/historyStore'
import {
  clearPersistedSession,
  loadPersistedSession,
  loadPersistedRichSession,
  savePersistedSession,
} from './lib/persistedSession'

const EMPTY_JOB = {
  taskId: '',
  status: 'idle',
  progress: 0,
  error: '',
  outputs: null,
}

const hasCompleteTurnaround = (views) =>
  Boolean(
    views?.front?.imageDataUrl &&
      views?.back?.imageDataUrl &&
      views?.left?.imageDataUrl &&
      views?.right?.imageDataUrl,
  )

const ModelViewer = lazy(() =>
  import('./components/ModelViewer').then((module) => ({ default: module.ModelViewer })),
)

function App() {
  const [initialSession] = useState(() => loadPersistedSession())
  const [prompt, setPrompt] = useState('')
  const [referenceImage, setReferenceImage] = useState(null)
  const [portraitResult, setPortraitResult] = useState(null)
  const [multiviewPrompt, setMultiviewPrompt] = useState(DEFAULT_MULTIVIEW_PROMPT)
  const [multiviewResult, setMultiviewResult] = useState(null)
  const [tripoJob, setTripoJob] = useState(() => initialSession?.tripoJob || EMPTY_JOB)
  const [history, setHistory] = useState(() => initialSession?.history || [])
  const [currentRunId, setCurrentRunId] = useState(() => initialSession?.currentRunId || '')
  const [error, setError] = useState('')
  const [isGeneratingPortrait, setIsGeneratingPortrait] = useState(false)
  const [turnaroundGenerationMode, setTurnaroundGenerationMode] = useState('')
  const [isCreatingModel, setIsCreatingModel] = useState(false)
  const [isCreatingFrontModel, setIsCreatingFrontModel] = useState(false)
  const [isRefreshingTripoJob, setIsRefreshingTripoJob] = useState(false)
  const [hasHydratedPersistedSession, setHasHydratedPersistedSession] = useState(false)

  const currentPipelineState = error
    ? 'Attention needed'
    : isGeneratingPortrait
      ? 'Generating portrait'
      : turnaroundGenerationMode === 'front-only'
        ? 'Generating front view'
        : turnaroundGenerationMode === 'full'
          ? 'Generating turnaround'
          : isCreatingModel
            ? 'Submitting multiview model'
            : isCreatingFrontModel
              ? 'Submitting front-view model'
              : isRefreshingTripoJob
                ? 'Refreshing Tripo result'
                : tripoJob.status === 'success'
                  ? '3D model ready'
                  : tripoJob.status === 'running'
                    ? 'Tripo is building the model'
                    : tripoJob.status === 'queued'
                      ? 'Tripo task queued'
                      : portraitResult?.imageDataUrl
                        ? 'Portrait ready for next step'
                        : 'Ready for a new character'

  const pipelineSummary = tripoJob.taskId
    ? `${tripoJob.status.toUpperCase()}${tripoJob.progress ? ` ${tripoJob.progress}%` : ''}`
    : portraitResult?.imageDataUrl
      ? 'PORTRAIT READY'
      : 'IDLE'

  useEffect(() => {
    document.title = 'WW Character Creator'
  }, [])

  useEffect(() => {
    let isCancelled = false

    loadPersistedRichSession()
      .then((session) => {
        if (!session || isCancelled) {
          return
        }

        setPrompt(session.prompt || '')
        setMultiviewPrompt(session.multiviewPrompt || DEFAULT_MULTIVIEW_PROMPT)
        setPortraitResult(session.portraitResult || null)
        setMultiviewResult(session.multiviewResult || null)
        setCurrentRunId(session.currentRunId || '')
        setHistory(session.history || [])
        setTripoJob(session.tripoJob || EMPTY_JOB)
      })
      .finally(() => {
        if (!isCancelled) {
          setHasHydratedPersistedSession(true)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [])

  useEffect(() => {
    if (!hasHydratedPersistedSession) {
      return
    }

    savePersistedSession({
      prompt,
      multiviewPrompt,
      portraitResult,
      multiviewResult,
      currentRunId,
      history,
      tripoJob,
    })
  }, [
    currentRunId,
    hasHydratedPersistedSession,
    history,
    multiviewPrompt,
    multiviewResult,
    portraitResult,
    prompt,
    tripoJob,
  ])

  const applyTripoJobUpdate = (nextJob, runId = currentRunId) => {
    setTripoJob((currentJob) => ({ ...currentJob, ...nextJob }))
    if (runId) {
      setHistory((currentHistory) =>
        updateHistoryEntry(currentHistory, runId, {
          tripoTaskId: nextJob.taskId,
          tripoStatus: nextJob.status,
          modelUrl: nextJob.outputs?.modelUrl || '',
        }),
      )
    }
  }

  const refreshTripoJob = async (taskId) => {
    const nextJob = await getTripoTask(taskId)

    return nextJob
  }

  useEffect(() => {
    if (!tripoJob.taskId || !['queued', 'running'].includes(tripoJob.status)) {
      return undefined
    }

    let isCancelled = false
    let isPolling = false

    const poll = async () => {
      if (isPolling || isCancelled) {
        return
      }

      isPolling = true

      try {
        const nextJob = await refreshTripoJob(tripoJob.taskId)
        if (isCancelled) {
          return
        }

        applyTripoJobUpdate(nextJob, currentRunId)
      } catch (pollError) {
        if (!isCancelled) {
          setTripoJob((currentJob) => ({
            ...currentJob,
            status: 'failed',
            error: pollError.message,
          }))
        }
      } finally {
        isPolling = false
      }
    }

    const intervalId = window.setInterval(poll, 3000)

    return () => {
      isCancelled = true
      window.clearInterval(intervalId)
    }
  }, [currentRunId, tripoJob.taskId, tripoJob.status])

  const handleGeneratePortrait = async () => {
    if (!prompt.trim() && !referenceImage?.file) {
      setError('Add a prompt, a reference image, or both before generating a portrait.')
      return
    }

    setError('')
    setIsGeneratingPortrait(true)
    setMultiviewResult(null)
    setTripoJob(EMPTY_JOB)

    try {
      const result = await generatePortrait({
        prompt,
        referenceImage: referenceImage?.file || null,
      })
      const runId = createRunId()
      const nextPortrait = {
        imageDataUrl: result.imageDataUrl,
        promptUsed: result.promptUsed,
        inputMode: result.inputMode,
        originalReferenceImageDataUrl:
          result.normalizedReferenceImageDataUrl || referenceImage?.previewUrl || '',
      }

      setPortraitResult(nextPortrait)
      setCurrentRunId(runId)
      setHistory((currentHistory) => [
        createHistoryEntry({
          id: runId,
          prompt,
          inputMode: result.inputMode,
          portraitUrl: result.imageDataUrl,
        }),
        ...currentHistory,
      ])
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsGeneratingPortrait(false)
    }
  }

  const handleGenerateTurnaround = async (mode = 'full') => {
    if (!portraitResult?.imageDataUrl) {
      setError('Generate a portrait first to establish the character identity.')
      return
    }

    setError('')
    setTurnaroundGenerationMode(mode)
    setTripoJob(EMPTY_JOB)

    try {
      const result = await generateMultiview({
        portraitImageDataUrl: portraitResult.imageDataUrl,
        originalReferenceImageDataUrl: portraitResult.originalReferenceImageDataUrl || null,
        characterPrompt: prompt,
        multiviewPrompt,
        mode,
      })

      setMultiviewResult(result)
      if (currentRunId) {
        setHistory((currentHistory) =>
          updateHistoryEntry(currentHistory, currentRunId, {
            multiview: result.views,
          }),
        )
      }
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setTurnaroundGenerationMode('')
    }
  }

  const handleCreateModel = async () => {
    if (!multiviewResult?.views) {
      setError('Generate the turnaround views before creating the 3D model.')
      return
    }

    setError('')
    setIsCreatingModel(true)

    try {
      const result = await createTripoTask({
        views: {
          front: multiviewResult.views.front.imageDataUrl,
          back: multiviewResult.views.back.imageDataUrl,
          left: multiviewResult.views.left.imageDataUrl,
          right: multiviewResult.views.right.imageDataUrl,
        },
      })

      setTripoJob({
        taskId: result.taskId,
        status: result.status,
        progress: 0,
        error: '',
        outputs: null,
      })

      if (currentRunId) {
        setHistory((currentHistory) =>
          updateHistoryEntry(currentHistory, currentRunId, {
            tripoTaskId: result.taskId,
            tripoStatus: result.status,
          }),
        )
      }
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsCreatingModel(false)
    }
  }

  const handleCreateFrontModel = async () => {
    const frontImageDataUrl = multiviewResult?.views?.front?.imageDataUrl

    if (!frontImageDataUrl) {
      setError('Generate a front view before creating a 3D model from it.')
      return
    }

    setError('')
    setIsCreatingFrontModel(true)

    try {
      const result = await createTripoFrontTask({
        imageDataUrl: frontImageDataUrl,
      })

      setTripoJob({
        taskId: result.taskId,
        status: result.status,
        progress: 0,
        error: '',
        outputs: null,
      })

      if (currentRunId) {
        setHistory((currentHistory) =>
          updateHistoryEntry(currentHistory, currentRunId, {
            tripoTaskId: result.taskId,
            tripoStatus: result.status,
          }),
        )
      }
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsCreatingFrontModel(false)
    }
  }

  const handleReset = () => {
    setPrompt('')
    setReferenceImage(null)
    setPortraitResult(null)
    setMultiviewPrompt(DEFAULT_MULTIVIEW_PROMPT)
    setMultiviewResult(null)
    setTripoJob(EMPTY_JOB)
    setCurrentRunId('')
    setError('')
    setTurnaroundGenerationMode('')
    clearPersistedSession()
  }

  const handleDownloadModel = async () => {
    if (!tripoJob.outputs?.downloadUrl) {
      return
    }

    await downloadFromUrl(tripoJob.outputs.downloadUrl, `${tripoJob.taskId || 'ww-character'}.glb`)
  }

  const handleForcePullResult = async () => {
    if (!tripoJob.taskId) {
      return
    }

    setError('')
    setIsRefreshingTripoJob(true)

    try {
      const nextJob = await refreshTripoJob(tripoJob.taskId)
      applyTripoJobUpdate(nextJob)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsRefreshingTripoJob(false)
    }
  }

  return (
    <div className="page-shell">
      <div className="page-backdrop" aria-hidden="true" />
      <main className="workspace-shell">
        <header className="status-bar">
          <div className="status-bar__account">
            <span className="status-dot" aria-hidden="true" />
            <div>
              <p className="eyebrow">Session</p>
              <strong>Local workspace</strong>
            </div>
          </div>
          <div className="status-bar__message">
            <p className="eyebrow">Status</p>
            <p>{currentPipelineState}</p>
          </div>
          <div className="status-bar__metric">
            <p className="eyebrow">Pipeline</p>
            <strong>{pipelineSummary}</strong>
          </div>
        </header>

        {error ? (
          <section className="error-banner" role="alert">
            <p>{error}</p>
          </section>
        ) : null}

        <section className="workspace-grid">
          <div className="workspace-slot workspace-slot--prompt">
            <CharacterPromptForm
              prompt={prompt}
              onPromptChange={setPrompt}
              referenceImage={referenceImage}
              onReferenceImageChange={setReferenceImage}
              onGeneratePortrait={handleGeneratePortrait}
              onReset={handleReset}
              isGeneratingPortrait={isGeneratingPortrait}
            />
          </div>

          <div className="workspace-slot workspace-slot--portrait">
            <PortraitReviewCard portraitResult={portraitResult} />
          </div>

          <section className="workspace-viewer">
            <div className="workspace-viewer__heading">
              <div className="section-heading">
                <p className="step-label">Step 03</p>
                <h2>3D View</h2>
              </div>
              <p className="workspace-viewer__caption">
                Tripo task controls, live task state, and the GLB preview live together here.
              </p>
            </div>

            <TripoJobPanel
              embedded
              job={tripoJob}
              canCreateModel={hasCompleteTurnaround(multiviewResult?.views)}
              canCreateFrontModel={Boolean(multiviewResult?.views?.front?.imageDataUrl)}
              isCreatingModel={isCreatingModel}
              isCreatingFrontModel={isCreatingFrontModel}
              isRefreshingJob={isRefreshingTripoJob}
              onCreateModel={handleCreateModel}
              onCreateFrontModel={handleCreateFrontModel}
              onForcePullResult={handleForcePullResult}
              onDownloadModel={handleDownloadModel}
            />

            <div className="workspace-viewer__viewport">
              {tripoJob.outputs?.modelUrl ? (
                <Suspense
                  fallback={
                    <div className="viewer-placeholder">
                      <p>Loading viewer...</p>
                    </div>
                  }
                >
                  <ModelViewer modelUrl={tripoJob.outputs.modelUrl} />
                </Suspense>
              ) : (
                <div className="viewer-placeholder">
                  <p>The textured GLB appears here after Tripo completes.</p>
                </div>
              )}
            </div>
          </section>

          <div className="workspace-slot workspace-slot--turnaround">
            <MultiviewPromptEditor
              value={multiviewPrompt}
              onChange={setMultiviewPrompt}
              onGenerateFrontTest={() => handleGenerateTurnaround('front-only')}
              onGenerateTurnaround={() => handleGenerateTurnaround('full')}
              disabled={!portraitResult || turnaroundGenerationMode !== ''}
              generationMode={turnaroundGenerationMode}
            />
          </div>

          <div className="workspace-slot workspace-slot--multiview">
            <MultiviewGrid
              views={multiviewResult?.views || null}
              mode={multiviewResult?.mode || 'full'}
            />
          </div>
        </section>

        <HistoryPanel history={history} />
      </main>
    </div>
  )
}

export default App
