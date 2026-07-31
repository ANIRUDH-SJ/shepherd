import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { LEGACY_PRODUCT_SLUG, PRODUCT_NAME, PRODUCT_SLUG } from '../shared/product'

type Exists = (path: string) => boolean

interface ProductApp {
  getPath(name: 'appData'): string
  setName(name: string): void
  setPath(name: 'userData', path: string): void
}

export interface ProductIdentitySelection {
  userDataPath: string
  usesLegacyState: boolean
}

function hasOwnedState(path: string, exists: Exists): boolean {
  return exists(join(path, 'session.json')) || exists(join(path, 'Local Storage'))
}

export function selectProductUserDataPath(
  appDataPath: string,
  exists: Exists = existsSync
): ProductIdentitySelection {
  const userDataPath = join(appDataPath, PRODUCT_SLUG)
  const legacyPath = join(appDataPath, LEGACY_PRODUCT_SLUG)
  if (!hasOwnedState(userDataPath, exists) && hasOwnedState(legacyPath, exists)) {
    return { userDataPath: legacyPath, usesLegacyState: true }
  }
  return { userDataPath, usesLegacyState: false }
}

export function configureProductIdentity(
  app: ProductApp,
  exists: Exists = existsSync
): ProductIdentitySelection {
  app.setName(PRODUCT_NAME)
  const selection = selectProductUserDataPath(app.getPath('appData'), exists)
  app.setPath('userData', selection.userDataPath)
  return selection
}
