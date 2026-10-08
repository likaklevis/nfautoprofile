(() => {
  "use strict";

  const { api, store } = globalThis.NFAuto;
  const elements = Object.fromEntries([
    "enabled", "enabled-label", "status", "setup", "open-netflix", "refresh",
    "profile", "profile-help", "profile-avatar", "avatar-placeholder", "pin-section", "pin", "show-pin", "save",
    "error", "forget", "forget-confirmation", "cancel-forget", "confirm-forget",
    "pause-controls", "pause-time", "pause-automation",
  ].map(id => [id, document.getElementById(id)]));

  let settings = null;
  let settingsUnreadable = false;
  let profiles = [];
  let options = [];
  let activeTabId = null;
  let tabPaused = false;
  let pendingAction = null;
  let refreshing = false;
  let avatarUrl = "";
  let pauseTimer = null;

  function setStatus(message = "", state = "idle") {
    elements.status.textContent = message;
    elements.status.hidden = !message;
    elements.status.dataset.state = state;
  }

  function showError(message = "") {
    elements.error.textContent = message;
    elements.error.hidden = !message;
  }

  function sameProfile(first, second) {
    return Boolean(first?.id && first.id === second?.id);
  }

  function selectedProfile() {
    const choice = options[Number(elements.profile.value)];
    return elements.profile.value !== "" && choice && !choice.disabled ? choice.profile : null;
  }

  function keepsSavedPin(profile = selectedProfile()) {
    return Boolean(settings?.hasPin && sameProfile(profile, settings.profile));
  }

  function isTemporarilyPaused() {
    return Boolean(settings?.enabled && settings.pausedUntil > Date.now());
  }

  function updatePauseControls() {
    clearTimeout(pauseTimer);
    pauseTimer = null;
    const available = Boolean(settings?.enabled && !settingsUnreadable);
    const paused = isTemporarilyPaused();
    elements["pause-controls"].hidden = !available;
    elements["pause-time"].hidden = !paused;
    elements["pause-automation"].disabled = pendingAction !== null;
    elements["pause-automation"].textContent = paused ? "Resume" : "Pause 10 min";
    elements["pause-automation"].setAttribute("aria-label", paused ? "Resume automatic selection" : "Pause automatic selection for 10 minutes");
    elements["pause-automation"].setAttribute("aria-busy", String(pendingAction === "pause" || pendingAction === "resume"));
    if (paused) {
      const remaining = Math.ceil((settings.pausedUntil - Date.now()) / 1000);
      elements["pause-time"].textContent = `Paused ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
      pauseTimer = setTimeout(updatePauseControls, 1000);
    }
  }

  function updateForm() {
    const pending = pendingAction !== null;
    const profile = selectedProfile();
    const unlocked = profile?.locked === false;
    const hasSavedPin = keepsSavedPin(profile);
    updateAvatar(profile);
    updateProfileHelp(profile, hasSavedPin);
    const pin = elements.pin.value;
    const validPin = /^[0-9]{4}$/.test(pin);
    const valid = Boolean(profile && (unlocked || validPin || (!pin && hasSavedPin)));
    elements.profile.disabled = pending || settingsUnreadable || !options.some(option => !option.disabled);
    elements["pin-section"].hidden = !profile || unlocked;
    elements.pin.disabled = pending || settingsUnreadable || !profile || unlocked;
    elements["show-pin"].disabled = elements.pin.disabled || !pin;
    elements.save.disabled = pending || settingsUnreadable || !valid;
    elements.enabled.disabled = pending || !settings;
    elements["confirm-forget"].disabled = pending;
    elements["cancel-forget"].disabled = pending;
    elements.refresh.disabled = pending || refreshing;
    elements["open-netflix"].disabled = pending;
    elements.save.textContent = pendingAction === "save" ? "Saving…" : "Save";
    elements["enabled-label"].textContent = elements.enabled.checked ? "On" : "Off";
    elements.pin.placeholder = hasSavedPin ? "PIN saved" : "4 digits";
    elements.pin.title = hasSavedPin ? "Leave empty to keep your saved PIN" : "";
    updatePauseControls();
  }

  function updateAvatar(profile) {
    const nextUrl = profile?.avatar || "";
    if (nextUrl === avatarUrl) return;
    avatarUrl = nextUrl;
    elements["profile-avatar"].hidden = true;
    elements["avatar-placeholder"].removeAttribute("hidden");
    if (nextUrl) elements["profile-avatar"].src = nextUrl;
    else elements["profile-avatar"].removeAttribute("src");
  }

  elements["profile-avatar"].addEventListener("load", () => {
    const image = elements["profile-avatar"];
    if (!avatarUrl || image.currentSrc !== avatarUrl || !image.naturalWidth) return;
    image.hidden = false;
    elements["avatar-placeholder"].setAttribute("hidden", "");
  });

  elements["profile-avatar"].addEventListener("error", () => {
    elements["profile-avatar"].hidden = true;
    elements["avatar-placeholder"].removeAttribute("hidden");
  });

  function updateProfileHelp(profile, hasSavedPin) {
    let message = "";
    if (!profile && options.some(option => option.disabled)) {
      message = "Couldn’t identify these profiles. Reload Netflix.";
    } else if (!options.length) {
      message = "Open Netflix’s profile chooser.";
    } else if (profile && profile.locked == null && !hasSavedPin) {
      message = "Refresh on Netflix’s profile chooser to detect its PIN lock.";
    }
    elements["profile-help"].textContent = message;
    elements["profile-help"].hidden = !message;
  }

  function setPinRevealed(revealed) {
    const label = revealed ? "Hide PIN" : "Show PIN";
    elements.pin.type = revealed ? "text" : "password";
    elements["show-pin"].setAttribute("aria-label", label);
    elements["show-pin"].setAttribute("aria-pressed", String(revealed));
    elements["show-pin"].title = label;
  }

  function resetPin() {
    elements.pin.value = "";
    setPinRevealed(false);
  }

  function renderProfiles(preferred = settings?.profile) {
    const listed = [...profiles];
    if (!listed.length && settings?.profile) listed.push(settings.profile);

    options = listed.map(profile => {
      const duplicateName = listed.filter(item => item.name === profile.name).length > 1;
      const hasId = typeof profile.id === "string" && profile.id.length > 0;
      const duplicateId = hasId && listed.filter(item => item.id === profile.id).length > 1;
      return { profile, disabled: !hasId || duplicateId, duplicateName };
    });

    elements.profile.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = options.length ? "Choose a profile" : "No profiles found";
    elements.profile.append(placeholder);

    options.forEach(({ profile, disabled, duplicateName }, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      let label = profile.name;
      if (profile.id && duplicateName) label += ` · …${String(profile.id).slice(-6)}`;
      if (disabled) label += " — unavailable";
      option.textContent = label;
      option.disabled = disabled;
      elements.profile.append(option);
    });

    const index = options.findIndex(option => !option.disabled && sameProfile(option.profile, preferred));
    elements.profile.value = index < 0 ? "" : String(index);
  }

  async function sendToTab(type) {
    if (activeTabId == null) return null;
    return api.tabs.sendMessage(activeTabId, { type });
  }

  async function scanProfiles(pause = false) {
    refreshing = true;
    elements.refresh.disabled = true;
    showError();
    try {
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      activeTabId = tab?.id ?? null;
      if (pause) {
        await sendToTab("NF_PAUSE_TAB");
        tabPaused = activeTabId != null;
      }
      const result = await sendToTab("NF_SCAN");
      if (!result || !Array.isArray(result.profiles)) throw new Error("No profile scan response");
      tabPaused = tabPaused || result.status?.code === "paused";
      profiles = result.profiles.filter(profile => profile && typeof profile.name === "string" && profile.name.length);
      if (result.page === "pin" && result.status?.code === "pin-needed" && settings?.profile) {
        settings.profile = { ...settings.profile, locked: true };
        profiles = profiles.map(profile => sameProfile(profile, settings.profile) ? { ...profile, locked: true } : profile);
      }
      renderProfiles(selectedProfile() || settings?.profile);
      if (!settings?.enabled || isTemporarilyPaused() || result.page === "profile" || result.page === "other"
        || result.status?.code === "unsupported-page") {
        setStatus();
      } else if (tabPaused && result.page === "chooser") {
        setStatus("Reload Netflix to resume.");
      } else {
        const messages = {
          "id-required": "Choose your profile again.",
          "id-missing": "Choose your profile again.",
          "ambiguous-id": "Refresh the list to identify your profile.",
          "pin-unavailable": "Save your PIN again.",
          "pin-needed": "Save this profile’s PIN.",
          "pin-already-entered": "Finish entering the PIN on Netflix.",
          "pin-form-changed": "Enter the PIN on Netflix this time.",
          "setup-changed": "Reload Netflix to continue.",
          "navigated": "Reload Netflix to continue.",
          "error": "Reload Netflix or save your profile again.",
        };
        const errors = ["id-required", "id-missing", "ambiguous-id", "pin-unavailable", "error"];
        setStatus(messages[result.status?.code], errors.includes(result.status?.code) ? "error" : "idle");
      }
    } catch {
      profiles = [];
      renderProfiles(selectedProfile() || settings?.profile);
      setStatus("Can’t connect. Reload this Netflix tab, then refresh.", "error");
    } finally {
      refreshing = false;
      updateForm();
    }
  }

  elements.profile.addEventListener("change", () => {
    showError();
    setStatus();
    resetPin();
    updateForm();
  });

  elements.pin.addEventListener("input", () => {
    showError();
    setStatus();
    if (elements.pin.value && !/^[0-9]{1,4}$/.test(elements.pin.value)) showError("Use four digits, from 0 to 9.");
    updateForm();
  });

  elements["show-pin"].addEventListener("click", () => {
    setPinRevealed(elements.pin.type === "password");
  });

  elements["open-netflix"].addEventListener("click", async () => {
    try {
      await api.tabs.create({ url: "https://www.netflix.com/browse" });
    } catch {
      showError("Open netflix.com in a tab, then try again.");
    }
  });

  elements.refresh.addEventListener("click", () => scanProfiles(true));

  elements.setup.addEventListener("submit", async event => {
    event.preventDefault();
    const profile = selectedProfile();
    if (!profile || pendingAction || settingsUnreadable) return;
    const enteredPin = elements.pin.value;
    if (profile.locked !== false && !/^[0-9]{4}$/.test(enteredPin) && !(keepsSavedPin() && !enteredPin)) {
      showError("Enter the 4-digit profile PIN.");
      elements.pin.focus();
      return;
    }
    showError();
    pendingAction = "save";
    updateForm();
    try {
      settings = await store.saveSettings({
        enabled: settings ? elements.enabled.checked : true,
        profile: { id: profile.id, name: profile.name, avatar: profile.avatar || null, locked: profile.locked ?? null },
        pin: profile.locked === false ? "" : enteredPin || undefined,
      });
      elements.enabled.checked = settings.enabled;
      elements.forget.hidden = false;
      resetPin();
      setStatus(settings.enabled && !isTemporarilyPaused() && tabPaused ? "Saved. Reload Netflix." : "Saved");
    } catch (error) {
      showError(error?.message || "Couldn’t save; try again.");
    } finally {
      pendingAction = null;
      updateForm();
    }
  });

  elements.enabled.addEventListener("change", async () => {
    if (!settings || pendingAction) return;
    const enabled = elements.enabled.checked;
    pendingAction = "toggle";
    updateForm();
    showError();
    try {
      await store.setEnabled(enabled);
      settings.enabled = enabled;
      settings.pausedUntil = 0;
      setStatus(enabled ? (tabPaused ? "Reload Netflix to resume." : "") : "Paused");
    } catch {
      elements.enabled.checked = settings.enabled;
      showError("Couldn’t change auto-select; try again.");
    } finally {
      pendingAction = null;
      updateForm();
    }
  });

  elements["pause-automation"].addEventListener("click", async () => {
    if (!settings?.enabled || pendingAction) return;
    const resume = isTemporarilyPaused();
    pendingAction = resume ? "resume" : "pause";
    showError();
    updateForm();
    try {
      settings = await (resume ? store.resumeAutomation() : store.pauseTemporarily());
      setStatus();
      if (resume) {
        try {
          const response = await sendToTab("NF_RESUME_TAB");
          if (response) tabPaused = false;
        } catch {
          // The saved pause can end even when this tab is unavailable.
        }
      }
    } catch {
      showError(resume ? "Couldn’t resume; try again." : "Couldn’t pause; try again.");
    } finally {
      pendingAction = null;
      updateForm();
    }
  });

  elements.forget.addEventListener("click", () => {
    elements.forget.hidden = true;
    elements["forget-confirmation"].hidden = false;
    elements["cancel-forget"].focus();
  });

  elements["cancel-forget"].addEventListener("click", () => {
    elements["forget-confirmation"].hidden = true;
    elements.forget.hidden = false;
    elements.forget.focus();
  });

  elements["confirm-forget"].addEventListener("click", async () => {
    pendingAction = "forget";
    updateForm();
    showError();
    try {
      await store.clear();
      settings = null;
      settingsUnreadable = false;
      elements.enabled.checked = false;
      elements["forget-confirmation"].hidden = true;
      elements.forget.hidden = true;
      renderProfiles(null);
      resetPin();
      setStatus("Profile forgotten.");
    } catch {
      showError("Couldn’t forget this profile; try again.");
    } finally {
      pendingAction = null;
      updateForm();
      if (!settings) elements["open-netflix"].focus();
    }
  });

  async function initialize() {
    try {
      settings = await store.getSettings();
      elements.enabled.checked = Boolean(settings?.enabled);
      elements.forget.hidden = !settings;
      await scanProfiles();
    } catch {
      settingsUnreadable = true;
      elements.forget.hidden = false;
      updateForm();
      showError("Use “Forget profile” to reset unreadable settings.");
      setStatus();
    }
  }

  window.addEventListener("pagehide", () => clearTimeout(pauseTimer));
  initialize();
})();
