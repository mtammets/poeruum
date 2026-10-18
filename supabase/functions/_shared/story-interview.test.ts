import { describe, expect, it } from 'vitest'
import { decodeStoryImage, parseStoryDraft, validStoryToken, writeStoryDraft, nextStoryQuestion } from './story-interview'

const draft = { title: 'Köögilauast oma poeni', intro: 'Liis alustas kruuside tegemist kodus.', opening: ['Esimene kruus valmis köögilaua taga.'], quote: 'Väljamõeldud tsitaat.', sections: [], imageCaption: 'Väljamõeldud foto.' }
describe('merchant story input boundaries', () => {
  it('rejects malformed, oversized and empty articles without accepting extra fields', () => {
    expect(parseStoryDraft({ ...draft, title: ' ' })).toBeNull()
    expect(parseStoryDraft({ ...draft, sections: [{ title: 'Algus', paragraphs: [] }] })).toBeNull()
    expect(parseStoryDraft({ ...draft, intro: 'x'.repeat(901) })).toBeNull()
    expect(parseStoryDraft({ ...draft, opening: ['x'.repeat(3001)] })).toBeNull()
    expect(parseStoryDraft({ ...draft, slug: 'overwrite', storeId: 'other' })).toEqual(draft)
    expect(validStoryToken('a'.repeat(64))).toBe(true)
    expect(validStoryToken('a'.repeat(63))).toBe(false)
    expect(validStoryToken('../other')).toBe(false)
  })
  it('rejects executable and disguised uploads', () => {
    expect(decodeStoryImage(`data:image/svg+xml;base64,${btoa('<svg/>')}`)).toBeNull()
    expect(decodeStoryImage(`data:image/png;base64,${btoa('<html>not a photo</html>')}`)).toBeNull()
    expect(decodeStoryImage('data:image/jpeg;base64,!!')).toBeNull()
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jLe0AAAAASUVORK5CYII='
    expect(decodeStoryImage(png)?.mime).toBe('image/png')
  })
  it('uses the transcript, validates structured output, and drops invented quotes and captions', async () => {
    const originalFetch = globalThis.fetch
    const transcript = [{ role: 'assistant' as const, content: 'Kuidas alustasid?' }, { role: 'user' as const, content: 'Esimene kruus valmis köögilaua taga.' }]
    let output: unknown = draft
    try {
      globalThis.fetch = async (_input, options) => {
        const body = JSON.parse(String(options?.body))
        expect(body.store).toBe(false)
        expect(body.text.format.strict).toBe(true)
        expect(JSON.parse(body.input[0].content).messages).toEqual(transcript)
        return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }] }))
      }
      expect(await writeStoryDraft('test', 'test-model', 'Savipood', transcript)).toEqual({ ...draft, quote: '', imageCaption: '' })
      output = { ...draft, quote: transcript[1].content }
      expect((await writeStoryDraft('test', 'test-model', 'Savipood', transcript)).quote).toBe(transcript[1].content)
      output = { question: '', finished: false }
      await expect(nextStoryQuestion('test', 'test-model', 'Savipood', transcript)).rejects.toThrow('Invalid interview turn')
      output = { question: '', finished: true }
      expect(await nextStoryQuestion('test', 'test-model', 'Savipood', transcript)).toEqual(output)
    } finally { globalThis.fetch = originalFetch }
  })
})
