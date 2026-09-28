export const STORE_NAME = 'entries'
export const NAMESPACE_INDEX = 'namespace'

export function openCacheDatabase(
  factory: IDBFactory,
  name: string
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1)

    request.onupgradeneeded = () => {
      const database = request.result

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database
          .createObjectStore(STORE_NAME, { keyPath: 'key' })
          .createIndex(NAMESPACE_INDEX, NAMESPACE_INDEX, { unique: false })
      }
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result

      database.onversionchange = () => database.close()
      resolve(database)
    }
  })
}

export function waitForRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

export function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  const result = new Promise<void>((resolve, reject) => {
    const rejectWithTransactionError = (event: Event) => {
      reject(
        transaction.error ??
        readIDBRequestError(event.target) ??
        new Error('IndexedDB transaction failed')
      )
    }

    transaction.onabort = rejectWithTransactionError
    transaction.onerror = rejectWithTransactionError
    transaction.oncomplete = () => resolve()
  })

  void result.catch(() => {})
  return result
}

export function readIDBRequestError(target: EventTarget | null): DOMException | null {
  if (!target || !('error' in target)) {
    return null
  }

  const error = (target as { error?: unknown }).error

  return error instanceof DOMException ? error : null
}

export function visitCursor(
  request: IDBRequest<IDBCursorWithValue | null>,
  visitor: (cursor: IDBCursorWithValue) => void | boolean
): Promise<void> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const cursor = request.result

      if (!cursor) {
        resolve()
        return
      }

      try {
        if (visitor(cursor) === false) {
          resolve()
          return
        }
      } catch (error) {
        try {
          readCursorTransaction(request)?.abort()
        } catch {
          // The original visitor error is more actionable than abort failure.
        }

        reject(error)
        return
      }

      cursor.continue()
    }
  })
}

export function readCursorTransaction(
  request: IDBRequest<IDBCursorWithValue | null>
): IDBTransaction | undefined {
  const source = request.source

  if (!source) {
    return undefined
  }

  if ('transaction' in source) {
    return source.transaction
  }

  if ('objectStore' in source) {
    return source.objectStore.transaction
  }

  return 'transaction' in source.source
    ? source.source.transaction
    : source.source.objectStore.transaction
}
