import { describe, expect, it } from 'vitest'
import {
  buildCombinedAnimationRowsPlan,
  resolveCombinedAnimationRowFrameIndex,
} from '../lib/combinedSpriteGif'

const makeDirection = (prefix, delayMs = 0) => ({
  previewDataUrl: `data:image/png;base64,${btoa(`${prefix}-preview`)}`,
  frameDataUrls: [
    `data:image/png;base64,${btoa(`${prefix}-0`)}`,
    `data:image/png;base64,${btoa(`${prefix}-1`)}`,
  ],
  delayMs,
})

describe('combinedSpriteGif', () => {
  it('builds a combined-row plan using the slowest row duration and fastest shared delay', () => {
    const plan = buildCombinedAnimationRowsPlan(
      [
        {
          animation: 'walk',
          directions: {
            front: makeDirection('walk-front', 50),
            right: makeDirection('walk-right', 50),
          },
        },
        {
          animation: 'idle',
          directions: {
            front: makeDirection('idle-front', 150),
            right: makeDirection('idle-right', 150),
          },
        },
      ],
      {
        directionKeys: ['front', 'right'],
      },
    )

    expect(plan.outputDelayMs).toBe(50)
    expect(plan.outputFrameCount).toBe(6)
    expect(plan.rows).toHaveLength(2)
  })

  it('holds slower rows on the same frame for multiple combined frames', () => {
    expect(
      resolveCombinedAnimationRowFrameIndex({
        outputFrameIndex: 0,
        outputDelayMs: 50,
        rowFrameDelayMs: 150,
        rowFrameCount: 2,
      }),
    ).toBe(0)
    expect(
      resolveCombinedAnimationRowFrameIndex({
        outputFrameIndex: 2,
        outputDelayMs: 50,
        rowFrameDelayMs: 150,
        rowFrameCount: 2,
      }),
    ).toBe(0)
    expect(
      resolveCombinedAnimationRowFrameIndex({
        outputFrameIndex: 3,
        outputDelayMs: 50,
        rowFrameDelayMs: 150,
        rowFrameCount: 2,
      }),
    ).toBe(1)
  })
})
