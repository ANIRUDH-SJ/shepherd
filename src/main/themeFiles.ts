import { BrowserWindow, dialog, ipcMain } from 'electron'
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'
import { IPC } from '../shared/ipc'
import {
  MAX_THEME_FILE_BYTES,
  parseCustomTheme,
  validateCustomTheme,
  type CustomTheme
} from '../shared/customTheme'
import { writeSessionSnapshot } from './sessionFile'

function selectedWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

function readBoundedTheme(path: string): string {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    const stat = fstatSync(descriptor)
    if (!stat.isFile()) throw new Error('Choose a regular JSON theme file')
    if (stat.size > MAX_THEME_FILE_BYTES) throw new Error('Theme file exceeds the 32 KB limit')
    const buffer = Buffer.alloc(MAX_THEME_FILE_BYTES + 1)
    let bytes = 0
    while (bytes < buffer.length) {
      const count = readSync(descriptor, buffer, bytes, buffer.length - bytes, bytes)
      if (count === 0) break
      bytes += count
    }
    if (bytes > MAX_THEME_FILE_BYTES) throw new Error('Theme file exceeds the 32 KB limit')
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes))
    } catch (error) {
      throw new Error('Theme file must be UTF-8', { cause: error })
    }
  } finally {
    closeSync(descriptor)
  }
}

export async function importThemeFile(): Promise<CustomTheme | null> {
  const options = {
    title: 'Import Shepherd theme',
    properties: ['openFile'] as Array<'openFile'>,
    filters: [{ name: 'Shepherd theme JSON', extensions: ['json'] }]
  }
  const window = selectedWindow()
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return null
  return parseCustomTheme(readBoundedTheme(result.filePaths[0]))
}

export async function exportThemeFile(value: unknown): Promise<{ path: string } | null> {
  const theme = validateCustomTheme(value)
  if (Buffer.byteLength(JSON.stringify(theme), 'utf8') > MAX_THEME_FILE_BYTES)
    throw new Error('Theme exceeds the 32 KB limit')
  const filename = theme.name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '')
  const options = {
    title: 'Export Shepherd theme',
    defaultPath: `${filename || 'shepherd-theme'}.json`,
    filters: [{ name: 'Shepherd theme JSON', extensions: ['json'] }]
  }
  const window = selectedWindow()
  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null
  writeSessionSnapshot(result.filePath, theme)
  return { path: result.filePath }
}

export function registerThemeFileIpc(): void {
  ipcMain.handle(IPC.THEME_IMPORT, () => importThemeFile())
  ipcMain.handle(IPC.THEME_EXPORT, (_event, value: unknown) => exportThemeFile(value))
}
