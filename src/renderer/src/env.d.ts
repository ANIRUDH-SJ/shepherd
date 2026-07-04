/// <reference types="vite/client" />

// The shape of the preload bridge, as seen by the renderer. Kept in sync with
// src/preload/index.ts. In later milestones this grows (and we may move it to a
// shared/types.ts imported by both sides — see textbook/09-typescript-and-the-data-model.md).
interface Window {
  api: {
    version: string
  }
}
