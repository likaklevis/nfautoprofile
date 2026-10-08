import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
const extensionId = 'test-extension';
const popup = { id: extensionId, url: `chrome-extension://${extensionId}/popup.html` };
const netflix = { id: extensionId, url: 'https://www.netflix.com/browse', frameId: 0, tab: { id: 7 } };

function setup(overrides = {}) {
  let listener;
  const calls = [];
  const settings = {
    async getSettings() { return { enabled: true, hasPin: true }; },
    async getPin() { calls.push('getPin'); return '0123'; },
    async saveSettings() {},
    async setEnabled() {},
    async pauseTemporarily() {},
    async resumeAutomation() {},
    async clear() {},
    ...overrides
  };
  const api = {
    runtime: {
      id: extensionId,
      getURL: path => `chrome-extension://${extensionId}/${path}`,
      onMessage: { addListener(value) { listener = value; } }
    },
    storage: { local: { async setAccessLevel(value) { calls.push(['access', value.accessLevel]); } } },
    tabs: { async query() { return []; } }
  };
  const context = vm.createContext({ chrome: api, URL, NFAuto: { settings } });
  vm.runInContext(source, context, { filename: 'background.js' });

  function send(method, sender = netflix, value) {
    return new Promise(resolve => {
      const waiting = listener({ type: 'NF_STORE', method, value }, sender, resolve);
      assert.equal(waiting, true);
    });
  }

  return { send, calls };
}

test('only the popup can change settings, and only a Netflix tab can read the PIN', async () => {
  const { send, calls } = setup();
  assert.deepEqual(calls, [['access', 'TRUSTED_CONTEXTS']]);
  const denied = [
    { ...netflix, id: 'other-extension' },
    { ...netflix, url: 'https://netflix.com.evil.test/browse' },
    { ...netflix, url: 'http://www.netflix.com/browse' },
    { ...netflix, frameId: 1 },
    { ...netflix, tab: undefined },
    popup
  ];
  for (const sender of denied) {
    assert.equal((await send('getPin', sender)).ok, false);
  }
  assert.equal(calls.includes('getPin'), false);
  assert.equal((await send('getPin')).value, '0123');
  for (const method of ['saveSettings', 'setEnabled', 'pauseTemporarily', 'resumeAutomation', 'clear']) {
    assert.equal((await send(method)).ok, false);
    assert.equal((await send(method, popup, true)).ok, true);
  }
});

test('PIN requests respect both temporary pause and the off switch', async () => {
  const state = { enabled: true, hasPin: true, pausedUntil: Date.now() + 10 * 60 * 1000 };
  const { send, calls } = setup({ async getSettings() { return { ...state }; } });
  const paused = await send('getPin');
  assert.equal(paused.ok, false);
  assert.match(paused.error, /paused/);
  assert.equal(calls.includes('getPin'), false);

  state.pausedUntil = Date.now() - 1;
  const expired = await send('getPin');
  assert.equal(expired.ok, true);
  assert.equal(expired.value, '0123');

  state.enabled = false;
  const readsBefore = calls.filter(call => call === 'getPin').length;
  assert.equal((await send('getPin')).ok, false);
  assert.equal(calls.filter(call => call === 'getPin').length, readsBefore);
});
