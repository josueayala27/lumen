/** Pure local-path and relink helpers. No runtime or database access. */

export type MediaKindName = 'image' | 'video' | 'audio'

/** Metadata returned by the Rust import/relink commands. */
export interface MediaMetadata {
  kind: MediaKindName
  name: string
  sha256: string
  mime: string
  size: number
  durationMs: number | null
  width: number | null
  height: number | null
  localPath: string
}

/** Minimal asset shape updated by a relink, without touching its id. */
export interface RelinkableMedia extends MediaMetadata {
  id: string
  createdAt: number
  updatedAt: number
  missing: boolean
}

const REMOTE_SCHEMES = ['file:', 'data:', 'http:', 'https:', 'ftp:', 'smb:']

/**
 * Mirrors the Rust `is_local_file_path` rule: an absolute local path, no URL
 * scheme, no UNC share and no control characters.
 */
export function isLocalMediaPath(raw: string): boolean {
  if (!raw || raw.trim() !== raw || /[\u0000-\u001f\u007f]/.test(raw)) return false
  const lower = raw.toLowerCase()
  if (lower.includes('://') || lower.startsWith('//')) return false
  if (REMOTE_SCHEMES.some((scheme) => lower.startsWith(scheme))) return false
  if (raw.startsWith('/')) return true
  return /^[a-z]:[\\/]/i.test(raw) && !/^\\\\/.test(raw)
}

/** Lowercase extension without the dot, or an empty string. */
export function mediaExtension(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * Applies new file metadata to an asset. The id and creation time are kept so
 * every document reference to the asset stays valid.
 */
export function relinkedAsset<T extends RelinkableMedia>(
  asset: T,
  metadata: MediaMetadata,
  now = Date.now(),
): T {
  return {
    ...asset,
    kind: metadata.kind,
    name: metadata.name,
    sha256: metadata.sha256,
    mime: metadata.mime,
    size: metadata.size,
    durationMs: metadata.durationMs,
    width: metadata.width,
    height: metadata.height,
    localPath: metadata.localPath,
    updatedAt: now,
    missing: false,
  }
}
