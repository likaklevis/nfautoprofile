import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright';
import { profiles, fixture } from './fixture.mjs';

const extension = fileURLToPath(new URL('../extension/', import.meta.url));
const scripts = await Promise.all(['netflix.js', 'notice.js', 'content.js'].map(name =>
  readFile(new URL(`../extension/${name}`, import.meta.url), 'utf8')));
let context;
let worker;

before(async () => {
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await context.route(/^https?:\/\//, route => route.abort());
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
});
after(async () => { await context?.close(); });

async function mount(page, options = {}) {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/*', async route => {
    if (route.request().resourceType() === 'document') {
      return route.fulfill({ contentType: 'text/html', body: fixture(options) });
    }
    if (route.request().url().endsWith('/profile-ready.js')) {
      await pending;
      return route.fulfill({ contentType: 'application/javascript', body: 'window.activateProfiles();' });
    }
    return route.abort();
  });
  await page.goto('https://www.netflix.com/browse', { waitUntil: options.delayed ? 'domcontentloaded' : 'load' });
  return async () => { release(); await page.waitForLoadState('load'); };
}

async function openFixture(options = {}, settings = { enabled: true, profile: profiles[0], pin: '0123' }) {
  await worker.evaluate(async settings => {
    await NFAuto.settings.clear();
    if (settings) await NFAuto.settings.saveSettings(settings);
  }, settings);
  const page = await context.newPage();
  await mount(page, options);
  return page;
}

async function message(page, type = 'NF_SCAN') {
  return worker.evaluate(async ({ url, type }) => {
    const [tab] = await chrome.tabs.query({ url });
    return chrome.tabs.sendMessage(tab.id, { type });
  }, { url: page.url(), type });
}

async function waitStatus(page, code) {
  const end = Date.now() + 6000;
  while (Date.now() < end) {
    const result = await message(page);
    if (result.status.code === code) return result;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(`Expected ${code}, got ${JSON.stringify(await message(page))}`);
}

async function openPopup() {
  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'https://www.netflix.com/browse' });
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html'), active: false });
    }),
  ]);
  await popup.locator('#profile option[value="0"]').waitFor({ state: 'attached' });
  return popup;
}

for (const engine of [chromium, firefox]) {
  test(`${engine.name()}: visible labels, locks and stable IDs survive styles, duplicates and reordering`, async () => {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await mount(page);
      await page.addScriptTag({ content: scripts[0] });
      const read = () => page.evaluate(() => NFAuto.netflix.readProfiles(document)
        .map(({ element, ...profile }) => profile));
      assert.deepEqual(await read(), profiles);
      await page.locator('button style').evaluateAll(styles => styles.forEach(style => style.remove()));
      assert.deepEqual(await read(), profiles);
      await page.locator('button').first().evaluate(card => {
        card.style.order = '1';
        card.querySelector(':scope > span > span').textContent = 'Renamed Alex';
      });
      const reordered = await read();
      assert.deepEqual(reordered.map(profile => profile.id), [profiles[1].id, profiles[0].id]);
      const matching = await page.evaluate(saved => {
        const found = NFAuto.netflix.readProfiles(document);
        return {
          name: NFAuto.netflix.matchProfile(saved, found).profile.name,
          missing: NFAuto.netflix.matchProfile({ ...saved, id: 'CCCCCCCCCCCCCCCCCCCCCCCCCC' }, found).code,
          noId: NFAuto.netflix.matchProfile({ ...saved, id: null }, found).code,
        };
      }, profiles[0]);
      assert.deepEqual(matching, { name: 'Renamed Alex', missing: 'id-missing', noId: 'id-required' });
      await page.locator('button').first().locator(':scope > span').evaluate(label => { label.hidden = true; });
      assert.deepEqual((await read()).map(profile => profile.id), [profiles[1].id]);
      await page.locator('button').first().locator(':scope > span').evaluate(label => {
        label.hidden = false;
        label.innerHTML = '<style>.fixture { color: red; }</style>';
      });
      assert.deepEqual((await read()).map(profile => profile.id), [profiles[1].id]);
    } finally { await browser.close(); }
  });

  test(`${engine.name()}: waits for load and attached Netflix handlers before clicking`, async () => {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const release = await mount(page, { delayed: true });
      await page.evaluate(profile => {
        window.browser = {
          runtime: { id: 'fixture', onMessage: { addListener(listener) {
            window.extensionMessage = type => new Promise(resolve => listener({ type }, { id: 'fixture' }, resolve));
          } } },
          storage: { onChanged: { addListener() {} } },
        };
        window.NFAuto = { store: {
          getSettings: async () => ({ enabled: true, profile, hasPin: true }),
          getPin: async () => '0123',
        } };
      }, profiles[0]);
      for (const content of scripts) await page.addScriptTag({ content });
      assert.equal(await page.evaluate(() => document.readyState), 'interactive');
      assert.equal((await page.evaluate(() => window.extensionMessage('NF_SCAN'))).status.code, 'loading');
      assert.equal(await page.evaluate(() => window.clicks), 0);
      await release();
      await page.waitForFunction(() => window.attempts.length === 1);
      assert.deepEqual(await page.evaluate(() => [window.clicks, window.selected, window.attempts]),
        [1, [profiles[0].id], ['0123']]);
      await page.locator('#nf-auto-profile-notice').waitFor();
    } finally { await browser.close(); }
  });
}

test('Chromium reports no installation warnings or extension errors', async () => {
  const page = await context.newPage();
  const id = new URL(worker.url()).hostname;
  try {
    await page.goto('chrome://extensions/');
    await page.waitForSelector('extensions-manager');
    const [reloaded] = await Promise.all([
      context.waitForEvent('serviceworker', candidate => new URL(candidate.url()).hostname === id),
      page.evaluate(async id => {
        const call = (method, ...args) => new Promise((resolve, reject) => {
          chrome.developerPrivate[method](...args, value => chrome.runtime.lastError
            ? reject(new Error(chrome.runtime.lastError.message)) : resolve(value));
        });
        await call('updateProfileConfiguration', { inDeveloperMode: true });
        await call('reload', id, { failQuietly: true });
      }, id),
    ]);
    worker = reloaded;
    const diagnostics = await page.evaluate(id => new Promise((resolve, reject) => {
      chrome.developerPrivate.getExtensionInfo(id, info => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve({ state: info.state, collecting: info.errorCollection.isActive,
          warnings: [...info.installWarnings, ...info.runtimeWarnings],
          errors: [...info.manifestErrors, ...info.runtimeErrors].map(error => error.message) });
      });
    }), id);
    assert.deepEqual(diagnostics, { state: 'ENABLED', collecting: true, warnings: [], errors: [] });
  } finally { await page.close(); }
});

for (const [index, profile] of profiles.entries()) {
  test(`loaded extension saves a ${profile.locked ? 'locked' : 'PIN-free'} profile and re-enters after success`, async () => {
    const page = await openFixture({}, null);
    let popup;
    try {
      await waitStatus(page, 'not-configured');
      popup = await openPopup();
      await popup.locator('#profile').selectOption(String(index));
      assert.equal(await popup.locator('#pin').isVisible(), profile.locked);
      if (profile.locked) await popup.locator('#pin').fill('0123');
      await popup.locator('#save').click();
      await waitStatus(page, 'profile-opened');
      const saved = await worker.evaluate(() => NFAuto.settings.getSettings());
      assert.equal(saved.profile.id, profile.id);
      assert.equal(saved.profile.locked, profile.locked);
      assert.equal(saved.hasPin, profile.locked);
      assert.deepEqual(await page.evaluate(() => window.selected), [profile.id]);
      assert.deepEqual(await page.evaluate(() => window.attempts), profile.locked ? ['0123'] : []);
      const notice = page.locator('#nf-auto-profile-notice');
      assert.equal(await notice.getByRole('status').innerText(), 'NF Auto Profile opened Alex.');
      assert.equal(await notice.evaluate(element => getComputedStyle(element).pointerEvents), 'none');
      await popup.locator('#enabled').uncheck();
      await waitStatus(page, 'disabled');
      await popup.locator('#enabled').check();
      await popup.waitForFunction(() => !document.getElementById('enabled').disabled);
      await page.getByRole('button', { name: 'Switch profiles', exact: true }).click();
      await page.waitForFunction(() => window.selected.length === 2);
      await waitStatus(page, 'profile-opened');
      assert.deepEqual(await page.evaluate(() => window.selected), [profile.id, profile.id]);
      assert.deepEqual(await page.evaluate(() => window.attempts), profile.locked ? ['0123', '0123'] : []);
      await popup.locator('#forget').click();
      await popup.locator('#confirm-forget').click();
      await waitStatus(page, 'not-configured');
      assert.equal(await worker.evaluate(() => NFAuto.settings.getSettings()), null);
      assert.equal(await popup.evaluate(() => document.activeElement.id), 'open-netflix');
    } finally { await popup?.close(); await page.close(); }
  });
}

test('a rejected PIN does not produce success or retry when the chooser returns', async () => {
  const page = await openFixture({ rejected: true });
  try {
    await waitStatus(page, 'pin-entered');
    assert.equal(await page.locator('#nf-auto-profile-notice').count(), 0);
    await page.evaluate(() => window.showChooser());
    await message(page, 'NF_REFRESH');
    await page.waitForTimeout(400);
    assert.deepEqual(await page.evaluate(() => [window.selected, window.attempts]), [[profiles[0].id], ['0123']]);
    assert.equal(await page.locator('#nf-auto-profile-notice').count(), 0);
  } finally { await page.close(); }
});

test('Pause survives Save and reload until Resume is clicked', async () => {
  const options = { profiles: [] };
  const page = await openFixture(options);
  let popup;
  try {
    await waitStatus(page, 'waiting');
    popup = await openPopup();
    await popup.getByRole('button', { name: 'Pause automatic selection for 10 minutes' }).click();
    await waitStatus(page, 'temporarily-paused');
    await popup.locator('#save').click();
    assert.ok((await worker.evaluate(() => NFAuto.settings.getSettings())).pausedUntil > Date.now());
    options.profiles = profiles;
    await page.reload();
    await waitStatus(page, 'temporarily-paused');
    assert.deepEqual(await page.evaluate(() => [window.selected, window.attempts]), [[], []]);
    await popup.getByRole('button', { name: 'Resume automatic selection', exact: true }).click();
    await waitStatus(page, 'profile-opened');
    assert.deepEqual(await page.evaluate(() => [window.selected, window.attempts]), [[profiles[0].id], ['0123']]);
  } finally { await popup?.close(); await page.close(); }
});
