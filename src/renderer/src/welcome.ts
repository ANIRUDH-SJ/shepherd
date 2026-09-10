export const WELCOME_STORAGE_KEY = 'shepherd.welcome.v1'
export const WELCOME_COMMAND = 'shepherd welcome\r'

interface WelcomeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function shouldShowWelcome(
  hasRestoredSession: boolean,
  storage: WelcomeStorage = window.localStorage
): boolean {
  if (hasRestoredSession) return false
  try {
    return storage.getItem(WELCOME_STORAGE_KEY) !== '1'
  } catch {
    return true
  }
}

export function markWelcomeShown(storage: WelcomeStorage = window.localStorage): void {
  try {
    storage.setItem(WELCOME_STORAGE_KEY, '1')
  } catch {
    // Session persistence still prevents repeat display when storage is unavailable.
  }
}
