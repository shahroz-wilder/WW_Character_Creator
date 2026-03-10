import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_MULTIVIEW_PROMPT } from '../constants/prompts'
import { loadPersistedSession } from '../lib/persistedSession'

describe('loadPersistedSession', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('upgrades the legacy multiview default prompt to the current preset', () => {
    window.localStorage.setItem(
      'ww-character-session-v1',
      JSON.stringify({
        multiviewPrompt: `full-length one full body character, Side VIEW ONLY, head-to-toe in frame
orthographic, neutral A-pose, light grey seamless background, sharp focus, No weapon, No cape`,
      }),
    )

    const session = loadPersistedSession()

    expect(session?.multiviewPrompt).toBe(DEFAULT_MULTIVIEW_PROMPT)
  })

  it('upgrades legacy single-animation sprite payloads into the animation catalog shape', () => {
    window.localStorage.setItem(
      'ww-character-session-v1',
      JSON.stringify({
        spriteResult: {
          animation: 'walk',
          spriteSize: 64,
          directions: {
            front: {
              previewDataUrl: 'data:image/png;base64,Zm9v',
            },
          },
        },
      }),
    )

    const session = loadPersistedSession()

    expect(session?.spriteResult?.animations?.walk?.directions?.front?.previewDataUrl).toBe(
      'data:image/png;base64,Zm9v',
    )
  })

  it('lifts legacy embedded 360 previews into shared sprite directions', () => {
    window.localStorage.setItem(
      'ww-character-session-v1',
      JSON.stringify({
        spriteResult: {
          animation: 'idle',
          spriteSize: 64,
          directions: {
            view_360: {
              previewDataUrl: 'data:image/png;base64,YmFy',
            },
            front: {
              previewDataUrl: 'data:image/png;base64,Zm9v',
            },
          },
          animations: {
            idle: {
              animation: 'idle',
              directions: {
                view_360: {
                  previewDataUrl: 'data:image/png;base64,YmFy',
                },
                front: {
                  previewDataUrl: 'data:image/png;base64,Zm9v',
                },
              },
            },
          },
        },
      }),
    )

    const session = loadPersistedSession()

    expect(session?.spriteResult?.sharedDirections?.view_360?.previewDataUrl).toBe(
      'data:image/png;base64,YmFy',
    )
  })

  it('upgrades legacy animated tripo outputs into a walk animation entry', () => {
    window.localStorage.setItem(
      'ww-character-session-v1',
      JSON.stringify({
        tripoJob: {
          taskId: 'retarget-task',
          taskType: 'animate_retarget',
          status: 'success',
          outputs: {
            modelUrl: '/api/tripo/tasks/retarget-task/model?variant=animation_model',
            downloadUrl: '/api/tripo/tasks/retarget-task/model?variant=animation_model',
            variant: 'animation_model',
            variants: {
              animation_model: '/api/tripo/tasks/retarget-task/model?variant=animation_model',
            },
          },
        },
      }),
    )

    const session = loadPersistedSession()

    expect(session?.tripoJob?.outputs?.animations?.walk?.modelUrl).toBe(
      '/api/tripo/tasks/retarget-task/model?variant=animation_model',
    )
  })

  it('maps persisted single-animation retarget outputs to the requested animation key', () => {
    window.localStorage.setItem(
      'ww-character-session-v1',
      JSON.stringify({
        tripoJob: {
          taskId: 'retarget-task',
          taskType: 'animate_retarget',
          status: 'success',
          requestedAnimations: ['preset:run'],
          outputs: {
            modelUrl: '/api/tripo/tasks/retarget-task/model?variant=animation_model',
            downloadUrl: '/api/tripo/tasks/retarget-task/model?variant=animation_model',
            variant: 'animation_model',
            variants: {
              animation_model: '/api/tripo/tasks/retarget-task/model?variant=animation_model',
            },
          },
        },
      }),
    )

    const session = loadPersistedSession()

    expect(session?.tripoJob?.outputs?.animations?.run?.modelUrl).toBe(
      '/api/tripo/tasks/retarget-task/model?variant=animation_model',
    )
  })

  it('preserves bundled multi-animation clip metadata in persisted tripo outputs', () => {
    window.localStorage.setItem(
      'ww-character-session-v1',
      JSON.stringify({
        tripoJob: {
          taskId: 'retarget-task',
          taskType: 'animate_retarget',
          status: 'success',
          outputs: {
            modelUrl: '/api/tripo/tasks/retarget-task/model?variant=model&animationMode=animated&animationKey=idle',
            downloadUrl:
              '/api/tripo/tasks/retarget-task/model?variant=model&animationMode=animated&animationKey=idle',
            variant: 'model',
            variants: {
              model:
                '/api/tripo/tasks/retarget-task/model?variant=model&animationMode=animated&animationKey=idle',
            },
            animations: {
              run: {
                preset: 'preset:biped:run',
                label: 'Run',
                variant: 'model',
                modelUrl:
                  '/api/tripo/tasks/retarget-task/model?variant=model&animationMode=animated&animationKey=run',
                downloadUrl:
                  '/api/tripo/tasks/retarget-task/model?variant=model&animationMode=animated&animationKey=run',
                variants: {
                  model:
                    '/api/tripo/tasks/retarget-task/model?variant=model&animationMode=animated&animationKey=run',
                },
                clipIndex: 2,
              },
            },
          },
        },
      }),
    )

    const session = loadPersistedSession()

    expect(session?.tripoJob?.outputs?.animations?.run?.clipIndex).toBe(2)
  })
})
