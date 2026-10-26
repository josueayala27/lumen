import { beforeEach, describe, expect, it } from 'vitest'
import type { PlaylistDoc } from '@lumen/schema'
import {
  addPresentationItem,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  listPlaylists,
  movePlaylistItem,
  newPlaylistDoc,
  removePlaylistItem,
  savePlaylist,
} from './playlists'

beforeEach(() => {
  localStorage.clear()
})

describe('playlist helpers', () => {
  it('adds, reorders and removes presentation items', () => {
    const doc = newPlaylistDoc('Sunday')
    const first = addPresentationItem(doc, 'presentation_a', 'Opening')
    const second = addPresentationItem(first, 'presentation_b', 'Worship')
    expect(second.items).toHaveLength(2)
    expect(second.items[1]?.kind).toBe('presentation')

    const moved = movePlaylistItem(second, second.items[1]!.id, -1)
    expect(moved.items.map((item) => item.kind === 'presentation' && item.label)).toEqual([
      'Worship',
      'Opening',
    ])
    expect(movePlaylistItem(moved, moved.items[0]!.id, -1)).toBe(moved)

    const removed = removePlaylistItem(moved, moved.items[0]!.id)
    expect(removed.items).toHaveLength(1)
    expect(removed.items[0]?.label).toBe('Opening')
  })
})

describe('local playlist store', () => {
  it('creates, lists and reopens a playlist', async () => {
    const doc = addPresentationItem(newPlaylistDoc('Midweek'), 'presentation_a', 'Teaching')
    const record = await createPlaylist(doc)
    const list = await listPlaylists()
    expect(list).toHaveLength(1)
    expect(list[0]?.name).toBe('Midweek')
    expect(list[0]?.presentationCount).toBe(1)

    const reopened = await getPlaylist(record.id)
    expect(reopened?.doc.items[0]?.label).toBe('Teaching')
  })

  it('rejects invalid playlist documents', async () => {
    const record = await createPlaylist(newPlaylistDoc('Valid'))
    await expect(
      savePlaylist({
        ...record,
        doc: { schemaVersion: 1, name: '', items: [] } as unknown as PlaylistDoc,
      }),
    ).rejects.toThrow()
  })

  it('deletes a playlist and hides corrupt rows', async () => {
    const record = await createPlaylist(newPlaylistDoc('Delete me'))
    localStorage.setItem(
      'lumen.playlists',
      JSON.stringify([
        { id: 'broken', doc: { schemaVersion: 2 }, createdAt: 1, updatedAt: 1 },
      ]),
    )
    expect(await listPlaylists()).toHaveLength(0)

    await createPlaylist(newPlaylistDoc('Keep'))
    await deletePlaylist(record.id)
    expect(await getPlaylist(record.id)).toBeNull()
  })
})
