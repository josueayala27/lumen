import { beforeEach, describe, expect, it } from 'vitest'
import { buildBlankPresentation, buildSongDoc, slideText } from '@lumen/core'
import {
  createPresentation,
  deletePresentation,
  getPresentation,
  listPresentations,
  savePresentation,
  updatedLabel,
} from './presentations'

beforeEach(() => {
  localStorage.clear()
})

describe('local presentation store', () => {
  it('creates, lists and reopens a song', async () => {
    const doc = buildSongDoc({
      title: 'Amazing Grace',
      author: 'John Newton',
      ccli: '',
      key: 'G',
      tempo: 72,
      lyrics: '[Verse 1]\nAmazing grace how sweet the sound',
    })
    const record = await createPresentation(doc)
    const list = await listPresentations('song')
    expect(list).toHaveLength(1)
    expect(list[0]?.title).toBe('Amazing Grace')
    expect(list[0]?.slideCount).toBeGreaterThan(0)

    const reopened = await getPresentation(record.id)
    expect(reopened?.doc.song?.author).toBe('John Newton')
    expect(slideText(reopened!.doc.slides[0]!)).toContain('Amazing grace')
  })

  it('updates and soft-deletes presentations', async () => {
    const record = await createPresentation(buildBlankPresentation('First'))
    await savePresentation({
      ...record,
      doc: buildBlankPresentation('Updated'),
      updatedAt: Date.now() + 1,
    })
    expect((await getPresentation(record.id))?.doc.title).toBe('Updated')

    await deletePresentation(record.id)
    expect(await getPresentation(record.id)).toBeNull()
    expect(await listPresentations()).toHaveLength(0)
  })
})

describe('updatedLabel', () => {
  it('formats recent timestamps', () => {
    const now = 1_000_000_000
    expect(updatedLabel(now - 5_000, now)).toBe('just now')
    expect(updatedLabel(now - 120_000, now)).toBe('2 min ago')
    expect(updatedLabel(now - 7_200_000, now)).toBe('2 hours ago')
  })
})
