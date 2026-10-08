(() => {
  const api = globalThis.browser ?? globalThis.chrome;

  async function request(method, value) {
    const response = await api.runtime.sendMessage({ type: 'NF_STORE', method, value });
    if (!response?.ok) throw new Error(response?.error || 'The extension could not read its settings. Please try again.');
    return response.value;
  }

  const namespace = (globalThis.NFAuto ??= {});
  namespace.api = api;
  namespace.store = {
    getSettings: () => request('getSettings'),
    getPin: () => request('getPin'),
    saveSettings: settings => request('saveSettings', settings),
    setEnabled: enabled => request('setEnabled', enabled),
    pauseTemporarily: () => request('pauseTemporarily'),
    resumeAutomation: () => request('resumeAutomation'),
    clear: () => request('clear')
  };
})();
