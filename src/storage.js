// The saved game, kept in IndexedDB. There's one slot: the autosave. Each record is
// { data, savedAt, tick, buildings }, with data from sim/save.js's serialize and the
// rest there so the home page can describe the save without loading it.

const DB_NAME = "factory";
const STORE = "saves";
const SLOT = "autosave";

let dbPromise = null;

function openDb() {
  if (!globalThis.indexedDB) return Promise.reject(new Error("this browser can't store data"));
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close(); // another tab upgrading the database
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("the game is open in another tab"));
  }).catch((err) => {
    dbPromise = null; // try again next time
    throw err;
  });
  return dbPromise;
}

// Runs one request in its own transaction and resolves when it's committed.
async function request(mode, make) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = make(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(tx.error || req.error);
  });
}

// The saved record, or null if there isn't one.
export async function readSave() {
  return (await request("readonly", (s) => s.get(SLOT))) ?? null;
}

export function writeSave(data) {
  const record = { data, savedAt: Date.now(), tick: data.tick, buildings: data.entities.length };
  return request("readwrite", (s) => s.put(record, SLOT));
}
