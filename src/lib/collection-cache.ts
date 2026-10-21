import type { ImportedItem } from './collection'

const DB_NAME = 'vinyl-library'
const STORE = 'collections'

export type CachedCollection = {
  userId: number
  items: ImportedItem[]
  savedAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'userId' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode)
      const request = action(transaction.objectStore(STORE))
      transaction.oncomplete = () => resolve(request.result)
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}

// Storage can be unavailable (e.g. some private browsing modes); the app then just re-imports each visit.
export async function loadCollection(userId: number): Promise<CachedCollection | null> {
  try {
    return (await withStore<CachedCollection | undefined>('readonly', (s) => s.get(userId))) ?? null
  } catch {
    return null
  }
}

export async function saveCollection(collection: CachedCollection): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.put(collection))
  } catch {
    // Not fatal: the list is still shown, it just won't be available instantly next time.
  }
}

export function deleteAllCollections(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => resolve()
  })
}
