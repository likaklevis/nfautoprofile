(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const settingsKey = 'nfAutoProfile.settings';
  const pauseDuration = 10 * 60 * 1000;

  function validateProfile(profile) {
    if (!profile || typeof profile.name !== 'string' || !profile.name.trim() || profile.name.length > 200) {
      throw new Error('Choose a Netflix profile first.');
    }
    if (typeof profile.id !== 'string' || !profile.id || profile.id.length > 256) {
      throw new Error('This profile identifier is invalid. Refresh the profile list.');
    }
    const locked = profile.locked ?? null;
    if (locked !== null && typeof locked !== 'boolean') {
      throw new Error('This profile’s PIN requirement is invalid. Refresh the profile list.');
    }
    let avatar = profile.avatar || '';
    if (avatar) {
      let url;
      try {
        url = new URL(avatar);
      } catch {
        throw new Error('This profile image is invalid. Refresh the profile list.');
      }
      const hosts = ['netflix.com', 'nflximg.com', 'nflximg.net', 'nflxso.net', 'nflxext.com'];
      const allowed = hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
      if (typeof avatar !== 'string' || avatar.length > 2048
        || url.protocol !== 'https:' || url.username || url.password || !allowed) {
        throw new Error('This profile image is invalid. Refresh the profile list.');
      }
      avatar = url.href;
    }
    return { id: profile.id, name: profile.name.trim(), avatar, locked };
  }

  function validateSettings(settings) {
    if (!settings) return null;
    if (settings.version !== 1 || typeof settings.enabled !== 'boolean') {
      throw new Error('Saved settings could not be read. Forget the profile and set it up again.');
    }
    const profile = validateProfile(settings.profile);
    if (settings.pin && (typeof settings.pin.iv !== 'string' || typeof settings.pin.ciphertext !== 'string')) {
      throw new Error('The saved PIN could not be read. Save it again.');
    }
    const pausedUntil = settings.pausedUntil === undefined ? 0 : settings.pausedUntil;
    if (!Number.isSafeInteger(pausedUntil) || pausedUntil < 0) {
      throw new Error('The saved pause could not be read. Forget the profile and set it up again.');
    }
    return { ...settings, profile, pausedUntil };
  }

  async function read() {
    const result = await api.storage.local.get(settingsKey);
    return validateSettings(result[settingsKey]);
  }

  function identity(profile) {
    return JSON.stringify(['id', profile.id]);
  }

  async function getSettings() {
    const settings = await read();
    if (!settings) return null;
    return {
      enabled: settings.enabled,
      profile: settings.profile,
      hasPin: Boolean(settings.pin),
      pausedUntil: settings.pausedUntil,
      revision: settings.revision ?? null
    };
  }

  async function getPin() {
    const settings = await read();
    if (!settings?.pin) return null;
    try {
      const pin = await NFAuto.vault.decrypt(settings.pin, identity(settings.profile));
      if (!/^\d{4}$/.test(pin)) throw new Error('Invalid PIN');
      return pin;
    } catch {
      throw new Error('The saved PIN could not be read. Enter it again in the extension.');
    }
  }

  async function saveSettings({ enabled, profile, pin }) {
    const nextProfile = validateProfile(profile);
    if (typeof enabled !== 'boolean') throw new Error('Choose whether automatic selection is enabled.');
    if (pin !== undefined && pin !== '' && (typeof pin !== 'string' || !/^\d{4}$/.test(pin))) {
      throw new Error('Enter the four digits of your profile PIN.');
    }
    let previous;
    try {
      previous = await read();
    } catch {
      if (pin === undefined) throw new Error('Enter your PIN again to save this profile.');
      previous = null;
    }
    if (pin === undefined && previous?.profile.id !== nextProfile.id) {
      throw new Error('Enter the PIN for this profile.');
    }
    const next = {
      version: 1,
      revision: crypto.randomUUID(),
      enabled,
      profile: nextProfile,
      pin: pin === undefined ? previous.pin : null,
      pausedUntil: previous?.pausedUntil > Date.now() ? previous.pausedUntil : 0
    };
    if (pin) {
      next.pin = await NFAuto.vault.encrypt(pin, identity(nextProfile));
    }
    await api.storage.local.set({ [settingsKey]: next });
    if (!next.pin) await NFAuto.vault.clear();
    return getSettings();
  }

  async function setEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Invalid automatic selection setting.');
    const settings = await read();
    if (!settings) throw new Error('Save a profile first.');
    await api.storage.local.set({ [settingsKey]: { ...settings, enabled, pausedUntil: 0, revision: crypto.randomUUID() } });
  }

  async function updatePause(pausedUntil) {
    const settings = await read();
    if (!settings) throw new Error('Save a profile first.');
    await api.storage.local.set({ [settingsKey]: { ...settings, pausedUntil, revision: crypto.randomUUID() } });
    return getSettings();
  }

  function pauseTemporarily() {
    return updatePause(Date.now() + pauseDuration);
  }

  function resumeAutomation() {
    return updatePause(0);
  }

  async function clear() {
    await api.storage.local.remove(settingsKey);
    await NFAuto.vault.clear();
  }

  (globalThis.NFAuto ??= {}).settings = {
    getSettings, getPin, saveSettings, setEnabled, pauseTemporarily, resumeAutomation, clear
  };
})();
