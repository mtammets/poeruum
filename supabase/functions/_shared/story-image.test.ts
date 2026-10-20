import { describe, expect, it } from 'vitest'
import { invoiceLogoFixtures } from '../../../scripts/fixtures/invoice-logo'
import { storyImageMetadata } from './story-image'

describe('story cover metadata', () => {
  for (const format of ['png', 'jpeg', 'webp'] as const) {
    it(`reads dimensions from an actual ${format} image`, () => {
      const bytes = Uint8Array.from(atob(invoiceLogoFixtures[format]), (char) => char.charCodeAt(0))
      expect(storyImageMetadata(bytes)).toEqual({ imageWidth: 120, imageHeight: 40, imageType: `image/${format}` })
      for (let length = 0; length < 24; length++) expect(storyImageMetadata(bytes.subarray(0, length))).toBeNull()
    })
  }
  it('ignores non-image content', () => {
    expect(storyImageMetadata(new TextEncoder().encode('<html>Image unavailable</html>'))).toBeNull()
  })
})
