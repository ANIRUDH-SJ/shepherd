/// <reference types="vite/client" />

// The shape of the preload bridge, as seen by the renderer. We reuse the single
// source of truth (CmuxApi) from the shared IPC contract so main, preload, and
// renderer can never drift apart. See textbook/09-typescript-and-the-data-model.md.
import type { CmuxApi } from '../../shared/ipc'

declare global {
  interface Window {
    api: CmuxApi
  }
}
