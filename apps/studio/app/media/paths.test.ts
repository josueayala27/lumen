import { describe, expect, it } from 'vitest'
import {
  isLocalMediaPath,
  mediaExtension,
  relinkedAsset,
  type RelinkableMedia,
} from './paths'

function asset(): RelinkableMedia {
  return {
    id: 'media_1',
    kind: 'image',
    name: 'Old.png',
    sha256: 'old',
    mime: 'image/png',
    size: 10,
    durationMs: null,
    width: 100,
    height: 100,
    localPath: '/old/Old.png',
    createdAt: 100,
    updatedAt: 200,
    missing: true,
  }
}

describe('isLocalMediaPath', () => {
  it('accepts absolute POSIX and Windows paths', () => {
    expect(isLocalMediaPath('/Users/demo/clip.mp4')).toBe(true)
    expect(isLocalMediaPath('C:\\Media\\clip.mp4')).toBe(true)
    expect(isLocalMediaPath('D:/Media/clip.mp4')).toBe(true)
  })

  it('rejects URLs, UNC shares and relative paths', () => {
    expect(isLocalMediaPath('clip.mp4')).toBe(false)
    expect(isLocalMediaPath('https://example.com/clip.mp4')).toBe(false)
    expect(isLocalMediaPath('file:///tmp/clip.mp4')).toBe(false)
    expect(isLocalMediaPath('//server/share/clip.mp4')).toBe(false)
    expect(isLocalMediaPath('\\\\server\\share\\clip.mp4')).toBe(false)
  })

  it('rejects control characters and untrimmed input', () => {
    expect(isLocalMediaPath('/tmp/line\nbreak.mp4')).toBe(false)
    expect(isLocalMediaPath(' /tmp/clip.mp4')).toBe(false)
    expect(isLocalMediaPath('')).toBe(false)
  })
})

describe('mediaExtension', () => {
  it('is lowercase and separator agnostic', () => {
    expect(mediaExtension('/tmp/Clip.MP4')).toBe('mp4')
    expect(mediaExtension('C:\\Media\\Palm.Sunday.JPG')).toBe('jpg')
    expect(mediaExtension('/tmp/no-extension')).toBe('')
  })
})

describe('relinkedAsset', () => {
  it('keeps the asset id and creation time while replacing metadata', () => {
    const next = relinkedAsset(
      asset(),
      {
        kind: 'video',
        name: 'New.mp4',
        sha256: 'new',
        mime: 'video/mp4',
        size: 20,
        durationMs: 5000,
        width: 1920,
        height: 1080,
        localPath: '/new/New.mp4',
      },
      500,
    )
    expect(next.id).toBe('media_1')
    expect(next.createdAt).toBe(100)
    expect(next.updatedAt).toBe(500)
    expect(next.missing).toBe(false)
    expect(next.kind).toBe('video')
    expect(next.sha256).toBe('new')
    expect(next.localPath).toBe('/new/New.mp4')
  })
})
