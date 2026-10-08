import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { IDBFactory } from 'fake-indexeddb';

const sources = await Promise.all(['vault', 'settings'].map(name =>
  readFile(new URL(`../extension/${name}.js`, import.meta.url), 'utf8')));
const settingsKey = 'nfAutoProfile.settings';
const profile = { id: 'A'.repeat(26), name: 'Alex', avatar: '', locked: true };

function environment(t) {
  const factory = new IDBFactory();
  const connections = new Set();
  const data = {};
  const indexedDB = {
    open(...args) {
      const request = factory.open(...args);
      request.addEventListener('success', () => connections.add(request.result));
      return request;
    }
  };
  const chrome = { storage: { local: {
    async get(keys) {
      return Object.fromEntries([keys].flat().map(key => [key, structuredClone(data[key])]));
    },
    async set(values) { Object.assign(data, structuredClone(values)); },
    async remove(keys) { for (const key of [keys].flat()) delete data[key]; }
  } } };

  function close() {
    for (const connection of connections) connection.close();
    connections.clear();
  }

  function load() {
    const context = vm.createContext({ chrome, crypto: webcrypto, indexedDB, TextEncoder, TextDecoder, URL, btoa, atob });
    for (const source of sources) vm.runInContext(source, context);
    return { store: context.NFAuto.settings, vault: context.NFAuto.vault };
  }

  async function readKey() {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('nf-auto-profile', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('keys', 'readonly');
      const request = transaction.objectStore('keys').get('pin');
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  t.after(close);
  return { ...load(), data, readKey, reload() { close(); return load(); } };
}

test('PIN encryption survives reload without exposing plaintext or an exportable key', async t => {
  const env = environment(t);
  await env.store.saveSettings({ enabled: true, profile, pin: '0123' });
  assert.equal(await env.store.getPin(), '0123');
  assert.equal((await env.store.getSettings()).hasPin, true);
  assert.equal('pin' in await env.store.getSettings(), false);
  assert.deepEqual(Object.keys(env.data), [settingsKey]);
  assert.equal(JSON.stringify(env.data).includes(JSON.stringify('0123')), false);

  const first = env.data[settingsKey].pin;
  await env.store.saveSettings({ enabled: true, profile, pin: '0123' });
  assert.notEqual(env.data[settingsKey].pin.iv, first.iv);
  assert.notEqual(env.data[settingsKey].pin.ciphertext, first.ciphertext);
  const reloaded = env.reload();
  assert.equal(await reloaded.store.getPin(), '0123');
  const key = await env.readKey();
  assert.equal(key.algorithm.name, 'AES-GCM');
  assert.equal(key.algorithm.length, 256);
  assert.equal(key.extractable, false);
  await assert.rejects(webcrypto.subtle.exportKey('raw', key), /not extractable/);
});

test('only the same profile ID can retain or decrypt a saved PIN', async t => {
  const { store, data } = environment(t);
  await store.saveSettings({ enabled: true, profile, pin: '0123' });
  await store.saveSettings({ enabled: true, profile: { ...profile, name: 'Renamed' } });
  assert.equal(await store.getPin(), '0123');
  const different = { ...profile, id: 'B'.repeat(26), name: 'Renamed' };
  await assert.rejects(store.saveSettings({ enabled: true, profile: different }), /Enter the PIN/);
  assert.equal((await store.getSettings()).profile.id, profile.id);
  data[settingsKey].profile.id = different.id;
  await assert.rejects(store.getPin(), /saved PIN could not be read/);
});

test('missing keys fail closed, replacement PINs recover, and forgetting removes secrets', async t => {
  const { store, vault, data, readKey } = environment(t);
  await store.saveSettings({ enabled: true, profile, pin: '0123' });
  await vault.clear();
  await assert.rejects(store.getPin(), /saved PIN could not be read/);
  await store.saveSettings({ enabled: true, profile, pin: '4567' });
  assert.equal(await store.getPin(), '4567');
  assert.equal((await readKey()).extractable, false);

  await store.saveSettings({ enabled: true, profile: { ...profile, locked: false }, pin: '' });
  assert.equal((await store.getSettings()).hasPin, false);
  assert.equal(await readKey(), undefined);
  await store.saveSettings({ enabled: true, profile, pin: '0123' });
  await store.clear();
  assert.equal(await store.getSettings(), null);
  assert.equal(await store.getPin(), null);
  assert.deepEqual(data, {});
  assert.equal(await readKey(), undefined);
});
