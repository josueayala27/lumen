import { ref } from 'vue'
import { listMediaAssets } from '~/data/media'
import { listPlaylists, type PlaylistSummary } from '~/data/playlists'
import { listPresentations, type PresentationSummary } from '~/data/presentations'
import type { MediaAsset } from '~/data/media'

/** Shared, read-only snapshot of the local library for the shell (sidebar meter, search, Go Live). */
const presentations = ref<PresentationSummary[]>([])
const playlists = ref<PlaylistSummary[]>([])
const media = ref<MediaAsset[]>([])
const mediaBytes = ref(0)
const loaded = ref(false)

async function refresh(): Promise<void> {
  const [nextPresentations, nextPlaylists, nextMedia] = await Promise.all([
    listPresentations().catch(() => []),
    listPlaylists().catch(() => []),
    listMediaAssets().catch(() => []),
  ])
  presentations.value = nextPresentations
  playlists.value = nextPlaylists
  media.value = nextMedia
  mediaBytes.value = nextMedia.reduce((total, asset) => total + (asset.missing ? 0 : asset.size), 0)
  loaded.value = true
}

export function useShellStats() {
  return { presentations, playlists, media, mediaBytes, loaded, refresh }
}
