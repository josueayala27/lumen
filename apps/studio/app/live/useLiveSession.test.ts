import { beforeEach, describe, expect, it } from 'vitest'
import { buildBlankPresentation, updatePresentationDoc } from '@lumen/core'
import type { PresentationDoc } from '@lumen/schema'
import { addPresentationItem, createPlaylist, getPlaylist, newPlaylistDoc, savePlaylist } from '~/data/playlists'
import { createPresentation } from '~/data/presentations'
import { useLiveSession } from './useLiveSession'

function doc(title: string, lines: string[]): PresentationDoc {
  return updatePresentationDoc(buildBlankPresentation(title), { title, slideTexts: lines })
}

async function rundown(name: string, docs: PresentationDoc[]) {
  let playlistDoc = newPlaylistDoc(name)
  for (const entry of docs) {
    const record = await createPresentation(entry)
    playlistDoc = addPresentationItem(playlistDoc, record.id, entry.title)
  }
  return createPlaylist(playlistDoc)
}

function onAir(session: ReturnType<typeof useLiveSession>): string[] {
  return session.currentSlide.value?.lines ?? []
}

beforeEach(() => {
  localStorage.clear()
})

describe('useLiveSession', () => {
  it('loads another rundown into preview and keeps program on air until take', async () => {
    const morning = await rundown('Morning', [doc('Opening', ['Good morning', 'Welcome'])])
    const evening = await rundown('Evening', [doc('Closing', ['Good night'])])
    const session = useLiveSession()
    await session.load({ playlistId: morning.id })
    session.goTo(0, 1)
    session.take()
    session.setMode('black')
    expect(onAir(session)).toEqual(['Welcome'])

    await session.load({ playlistId: evening.id })
    expect(session.items.value.map((item) => item.label)).toEqual(['Closing'])
    expect(session.previewSlide.value?.lines).toEqual(['Good night'])
    expect(onAir(session)).toEqual(['Welcome'])
    expect(session.state.value.mode).toBe('black')

    // Preview moves keep the hold; take puts the new rundown on air.
    session.goTo(0, 0)
    expect(onAir(session)).toEqual(['Welcome'])
    session.take()
    expect(onAir(session)).toEqual(['Good night'])
    expect(session.held.value).toBeNull()
  })

  it('advancing off a held slide lands on the first slide of the new rundown', async () => {
    const morning = await rundown('Morning', [doc('Opening', ['Good morning', 'Welcome'])])
    const evening = await rundown('Evening', [doc('Closing', ['Good night', 'Drive safe'])])
    const session = useLiveSession()
    await session.load({ playlistId: morning.id })
    session.next()
    await session.load({ playlistId: evening.id })
    expect(onAir(session)).toEqual(['Welcome'])
    session.next()
    expect(onAir(session)).toEqual(['Good night'])
  })

  it('picks up a saved rundown edit without moving program', async () => {
    const morning = await rundown('Morning', [doc('Opening', ['Good morning', 'Welcome'])])
    const session = useLiveSession()
    await session.load({ playlistId: morning.id })
    session.next()
    expect(onAir(session)).toEqual(['Welcome'])

    const extra = await createPresentation(doc('Announcements', ['Coffee after']))
    const record = (await getPlaylist(morning.id))!
    await savePlaylist({ ...record, doc: addPresentationItem(record.doc, extra.id, 'Announcements'), updatedAt: Date.now() })
    await session.refresh()

    expect(session.items.value.map((item) => item.label)).toEqual(['Opening', 'Announcements'])
    expect(onAir(session)).toEqual(['Welcome'])
    session.next()
    expect(onAir(session)).toEqual(['Coffee after'])
  })
})
