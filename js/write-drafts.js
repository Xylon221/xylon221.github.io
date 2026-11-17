const storeName = 'drafts';

export function openDrafts() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('xylon-blog-writing', 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: 'mode' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('草稿存储正在被其他页面使用。'));
  });
}

export function draftTransaction(db, access, operation) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, access);
    const request = operation(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error);
  });
}
