import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpriteGrid } from '../components/SpriteGrid'

const makeDataUrl = (seed) => `data:image/png;base64,${btoa(seed)}`

describe('SpriteGrid', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses direction delayMs for animated preview playback', () => {
    render(
      <SpriteGrid
        embedded
        displayMode="walk"
        directions={{
          front: {
            frameDataUrls: [makeDataUrl('frame-a'), makeDataUrl('frame-b')],
            delayMs: 270,
          },
        }}
      />,
    )

    const frontPreview = screen.getByAltText('Front run sprite preview')

    expect(frontPreview).toHaveAttribute('src', makeDataUrl('frame-a'))

    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(frontPreview).toHaveAttribute('src', makeDataUrl('frame-a'))

    act(() => {
      vi.advanceTimersByTime(70)
    })

    expect(frontPreview).toHaveAttribute('src', makeDataUrl('frame-b'))
  })
})
