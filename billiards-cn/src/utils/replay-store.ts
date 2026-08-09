/**
 * 离线回放本地仓库（IndexedDB）。
 * 与 dist/menu-cn.js 中手维护的读取逻辑共用同一 DB 名 / 表名 / keyPath，
 * 因此「游戏内保存」与「主菜单我的回放」共享同一数据源。
 */

const DB_NAME = "billiards_replays"
const STORE = "replays"
const DB_VERSION = 1

export interface SavedReplay {
  id: string
  rule: string
  compressed: string
  createdAt: number
  score: number
  label: string
}

export function openReplayDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("IndexedDB not supported"))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveReplayToDB(r: SavedReplay): Promise<void> {
  const db = await openReplayDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite")
    tx.objectStore(STORE).put(r)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
  })
}

export async function listReplaysFromDB(): Promise<SavedReplay[]> {
  const db = await openReplayDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly")
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => {
      db.close()
      const list = (req.result as SavedReplay[]) || []
      list.sort((a, b) => b.createdAt - a.createdAt)
      resolve(list)
    }
    req.onerror = () => {
      db.close()
      reject(req.error)
    }
  })
}

export async function deleteReplayFromDB(id: string): Promise<void> {
  const db = await openReplayDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite")
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
  })
}
