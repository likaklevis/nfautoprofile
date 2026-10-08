if (typeof importScripts === 'function') importScripts('vault.js', 'settings.js');

(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const netflixOrigins = ['https://netflix.com', 'https://www.netflix.com'];
  const writes = new Set(['saveSettings', 'setEnabled', 'pauseTemporarily', 'resumeAutomation', 'clear']);
  const methods = new Set(['getSettings', 'getPin', ...writes]);
  let pending = Promise.resolve();

  api.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});

  function allowed(sender, method) {
    if (sender.id !== api.runtime.id) return false;
    if (sender.url === api.runtime.getURL('popup.html')) return method !== 'getPin';
    if (!sender.tab || sender.frameId !== 0 || writes.has(method)) return false;
    try {
      return netflixOrigins.includes(new URL(sender.url).origin);
    } catch {
      return false;
    }
  }

  async function notifyTabs() {
    const tabs = await api.tabs.query({ url: netflixOrigins.map(origin => `${origin}/*`) });
    await Promise.allSettled(tabs.map(tab => api.tabs.sendMessage(tab.id, { type: 'NF_REFRESH' })));
  }

  async function handle(message, sender) {
    if (!methods.has(message.method) || !allowed(sender, message.method)) {
      throw new Error('This page cannot access the saved profile.');
    }
    if (message.method === 'getPin') {
      const settings = await NFAuto.settings.getSettings();
      if (!settings?.enabled || settings.pausedUntil > Date.now()) {
        throw new Error('Automatic selection is paused.');
      }
    }
    const value = await NFAuto.settings[message.method](message.value);
    if (writes.has(message.method)) notifyTabs().catch(() => {});
    return value;
  }

  api.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'NF_STORE') return false;
    const operation = pending.then(() => handle(message, sender));
    pending = operation.catch(() => {});
    operation.then(
      value => respond({ ok: true, value: value ?? null }),
      error => respond({ ok: false, error: error.message || 'The saved profile could not be updated.' })
    );
    return true;
  });
})();
