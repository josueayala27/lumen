import { createWebHashHistory } from 'vue-router'
import type { RouterConfig } from '@nuxt/schema'

// The Tauri custom protocol has no server-side SPA fallback; hash history is reliable.
export default <RouterConfig>{
  history: (base) => createWebHashHistory(base),
}
