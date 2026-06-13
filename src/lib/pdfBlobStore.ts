const DB_NAME = "catcare_pdf_blob_store";
const DB_VERSION = 1;
const STORE_NAME = "pdfBlobs";

type PdfBlobRecord = {
  reportId: string;
  pdfBlob?: Blob;
  updatedAt: string;
};

function canUseIndexedDb() {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function openPdfBlobDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!canUseIndexedDb()) {
      reject(new Error("IndexedDB is not available"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "reportId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open PDF blob store"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openPdfBlobDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      const request = action(store);
      let settled = false;

      if (request) {
        request.onsuccess = () => {
          settled = true;
          resolve(request.result);
        };
        request.onerror = () => reject(request.error || new Error("PDF blob store request failed"));
      }

      tx.oncomplete = () => {
        if (!settled) resolve(undefined);
      };
      tx.onerror = () => reject(tx.error || new Error("PDF blob store transaction failed"));
    });
  } finally {
    db.close();
  }
}

export async function savePdfBlob(reportId: string, pdfBlob: Blob) {
  if (!reportId || !pdfBlob || !canUseIndexedDb()) return;
  const record: PdfBlobRecord = {
    reportId,
    pdfBlob,
    updatedAt: new Date().toISOString(),
  };
  await withStore("readwrite", (store) => store.put(record));
}

export async function loadPdfBlob(reportId: string): Promise<Blob | null> {
  if (!reportId || !canUseIndexedDb()) return null;
  const record = await withStore<PdfBlobRecord>("readonly", (store) => store.get(reportId));
  return record?.pdfBlob || null;
}

export async function deletePdfBlob(reportId: string) {
  if (!reportId || !canUseIndexedDb()) return;
  await withStore("readwrite", (store) => store.delete(reportId));
}

export async function clearPdfBlobStore() {
  if (!canUseIndexedDb()) return;
  await withStore("readwrite", (store) => store.clear());
}
