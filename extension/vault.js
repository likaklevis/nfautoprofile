(() => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let connection;

  function open() {
    connection ??= new Promise((resolve, reject) => {
      const request = indexedDB.open('nf-auto-profile', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('keys');
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          connection = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        connection = null;
        reject(new Error('The local PIN vault could not be opened.'));
      };
    });
    return connection;
  }

  async function transact(mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('keys', mode);
      const request = action(transaction.objectStore('keys'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(new Error('The local PIN vault could not be updated.'));
      transaction.onerror = () => reject(new Error('The local PIN vault could not be updated.'));
    });
  }

  async function getKey(create) {
    let key = await transact('readonly', store => store.get('pin'));
    if (!key && create) {
      key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await transact('readwrite', store => store.put(key, 'pin'));
    }
    if (!key || key.extractable || key.algorithm.name !== 'AES-GCM') {
      throw new Error('The local PIN key is unavailable. Save your PIN again.');
    }
    return key;
  }

  function encode(bytes) {
    return btoa(String.fromCharCode(...bytes));
  }

  function decode(value) {
    return Uint8Array.from(atob(value), character => character.charCodeAt(0));
  }

  async function encrypt(pin, identity) {
    const key = await getKey(true);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(identity) }, key, encoder.encode(pin)
    );
    return { iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
  }

  async function decrypt(pin, identity) {
    const key = await getKey(false);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decode(pin.iv), additionalData: encoder.encode(identity) }, key, decode(pin.ciphertext)
    );
    return decoder.decode(plaintext);
  }

  async function clear() {
    await transact('readwrite', store => store.delete('pin'));
  }

  (globalThis.NFAuto ??= {}).vault = { encrypt, decrypt, clear };
})();
