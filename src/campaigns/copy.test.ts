import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateCampaignCopy } from '../../supabase/functions/_shared/campaign-copy'
import { createCampaign } from './model'

afterEach(() => vi.unstubAllGlobals())
describe('campaign AI generation', () => {
  it('requests bounded structured output without retaining input and validates the response', async () => {
    const doc = createCampaign()
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(doc.copy) }] }] })))
    vi.stubGlobal('fetch', request)
    expect(await generateCampaignCopy('test-only', doc)).toEqual(doc.copy)
    const sent = JSON.parse(request.mock.calls[0][1].body)
    expect(sent.store).toBe(false)
    expect(sent.max_output_tokens).toBe(3000)
    expect(sent.text.format.strict).toBe(true)
    expect(sent.text.format.schema.additionalProperties).toBe(false)
  })
  it('rejects incomplete, refused and malformed responses without manufacturing copy', async () => {
    for (const result of [
      { status: 'incomplete', output: [] },
      { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] },
      { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{}' }] }] },
    ]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(result))))
      await expect(generateCampaignCopy('test-only', createCampaign())).rejects.toThrow()
    }
  })
})
