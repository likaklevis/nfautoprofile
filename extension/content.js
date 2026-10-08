(() => {
  "use strict";

  if (window.top !== window || !globalThis.NFAuto?.netflix) return;

  const api = globalThis.browser ?? globalThis.chrome;
  const { netflix, store, notifyProfileOpened } = globalThis.NFAuto;
  let settings = null;
  let status = { code: "loading", message: "Checking your setup…" };
  let stage = "waiting";
  let paused = false;
  let observer = null;
  let scanTimer = null;
  let deadline = null;
  let resumeTimer = null;
  let revision = 0;
  let running = false;
  let rerun = false;
  let selectedUrl = null;
  let selectedSetup = null;
  let selectedName = "";

  const matchMessages = {
    "id-required": "Choose your profile again to save its Netflix ID.",
    "id-missing": "The saved profile ID is not available. Choose your profile again to continue.",
    "ambiguous-id": "More than one profile has this ID. Automatic selection stopped.",
  };

  function setStatus(code, message) {
    status = { code, message };
  }

  function profileKey(profile) {
    return JSON.stringify([profile?.id ?? null, profile?.name ?? "", profile?.avatar ?? "", profile?.locked ?? null]);
  }

  function settingsKey(value) {
    return JSON.stringify([Boolean(value?.enabled), profileKey(value?.profile), Boolean(value?.hasPin), value?.pausedUntil ?? 0, value?.revision ?? null]);
  }

  function stopWatching() {
    observer?.disconnect();
    observer = null;
    clearTimeout(scanTimer);
    clearTimeout(deadline);
    clearTimeout(resumeTimer);
    scanTimer = null;
    deadline = null;
    resumeTimer = null;
    document.removeEventListener("pointerdown", onInteraction, true);
    document.removeEventListener("keydown", onInteraction, true);
    document.removeEventListener("input", onInteraction, true);
  }

  function finish(code, message) {
    stage = "done";
    revision += 1;
    setStatus(code, message);
    stopWatching();
  }

  function onInteraction(event) {
    if (!event.isTrusted) return;
    if (!(settings?.pausedUntil > Date.now()) && netflix.getPageState(document) === "profile") return;
    paused = true;
    revision += 1;
    setStatus("paused", "Paused after you interacted with this page. Reload to run again.");
    stopWatching();
  }

  function scheduleScan() {
    if (scanTimer || paused || stage === "done") return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      void run();
    }, 200);
  }

  function watch() {
    if (observer || paused || stage === "done") return;
    observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-hidden", "data-uia", "src", "disabled", "readonly"],
    });
    watchInteraction();
  }

  function watchInteraction() {
    document.addEventListener("pointerdown", onInteraction, true);
    document.addEventListener("keydown", onInteraction, true);
    document.addEventListener("input", onInteraction, true);
  }

  function canContinue(token) {
    return token === revision && !paused && stage !== "done" && settings?.enabled
      && !(settings.pausedUntil > Date.now())
      && netflix.isSupportedPage(location)
      && (selectedUrl === null || selectedUrl === location.href);
  }

  async function enterPin(token) {
    const input = netflix.findPinInput(document);
    if (!input) return;
    if (input.value) {
      finish("pin-already-entered", "The PIN field already has input. Automatic entry stopped.");
      return;
    }
    if (!settings.hasPin) {
      finish("pin-needed", "Profile selected. Enter its PIN, or save one in the extension.");
      return;
    }

    const pin = await store.getPin();
    const current = await store.getSettings();
    if (!canContinue(token)) return;
    if (settingsKey(current) !== selectedSetup) {
      finish("setup-changed", "Your setup changed. Reload to use the new settings.");
      return;
    }
    if (!/^\d{4}$/.test(pin ?? "")) {
      finish("pin-unavailable", "The saved PIN could not be read. Save it again in the extension.");
      return;
    }

    const currentInput = netflix.findPinInput(document);
    if (currentInput !== input || currentInput.value) {
      finish("pin-form-changed", "The PIN form changed during entry. Enter it manually this time.");
      return;
    }
    stage = "entering-pin";
    input.focus({ preventScroll: true });
    netflix.setInputValue(input, pin);
    if (canContinue(token)) {
      stage = "confirming";
      setStatus("pin-entered", "PIN entered. Waiting for Netflix to open your profile.");
      clearTimeout(deadline);
      deadline = setTimeout(() => finish("pin-entered", "PIN entered once. If Netflix rejects it, update your saved PIN."), 15000);
      scheduleScan();
    }
  }

  async function run() {
    if (running) {
      rerun = true;
      return;
    }
    if (paused || stage === "done") return;
    running = true;
    const token = revision;
    try {
      if (!netflix.isSupportedPage(location)) {
        finish("unsupported-page", "This Netflix page is not supported yet.");
        return;
      }
      if (selectedUrl && selectedUrl !== location.href) {
        finish("navigated", "Automatic entry stopped after navigation. Reload to run again.");
        return;
      }
      settings = await store.getSettings();
      if (token !== revision || paused) return;
      if (!settings?.profile) {
        setStatus("not-configured", "Open Netflix’s profile chooser, then choose your profile in the extension.");
        stopWatching();
        return;
      }
      if (!settings.enabled) {
        setStatus("disabled", "Automatic profile selection is turned off.");
        stopWatching();
        return;
      }
      if (settings.pausedUntil > Date.now()) {
        setStatus("temporarily-paused", "Automatic selection is temporarily paused.");
        stopWatching();
        watchInteraction();
        resumeTimer = setTimeout(() => {
          resumeTimer = null;
          void run();
        }, Math.min(settings.pausedUntil - Date.now(), 2147483647));
        return;
      }
      clearTimeout(resumeTimer);
      resumeTimer = null;
      watch();
      if (stage === "selected" || stage === "confirming") {
        if (settingsKey(settings) !== selectedSetup) {
          finish("setup-changed", "Your setup changed. Reload to use the new settings.");
          return;
        }
        if (netflix.getPageState(document) === "profile") {
          stage = "opened";
          revision += 1;
          clearTimeout(deadline);
          deadline = null;
          selectedUrl = null;
          selectedSetup = null;
          setStatus("profile-opened", "Your profile is open.");
          notifyProfileOpened(selectedName);
          selectedName = "";
          return;
        }
        if (stage === "selected") await enterPin(token);
        return;
      }
      if (stage === "opened") {
        if (netflix.getPageState(document) !== "chooser") return;
        stage = "waiting";
      }
      if (stage !== "waiting") return;
      if (document.readyState !== "complete") {
        setStatus("loading", "Waiting for Netflix to finish loading.");
        return;
      }
      const profiles = netflix.readProfiles(document);
      if (!profiles.length) {
        setStatus("waiting", "Waiting for Netflix’s profile chooser.");
        return;
      }
      const match = netflix.matchProfile(settings.profile, profiles);
      if (!match.profile) {
        setStatus(match.code, matchMessages[match.code] ?? "Choose your profile in the extension to continue.");
        return;
      }
      if (!canContinue(token) || !netflix.isVisible(match.profile.element)) return;
      selectedUrl = location.href;
      selectedSetup = settingsKey(settings);
      selectedName = match.profile.name;
      stage = "selected";
      setStatus("profile-selected", "Profile selected. Waiting for its PIN prompt…");
      deadline = setTimeout(() => {
        if (stage === "selected") finish("profile-selected", "Profile selected. No supported PIN prompt appeared.");
      }, 15000);
      match.profile.element.click();
      scheduleScan();
    } catch {
      finish("error", "Automatic selection stopped. Reload Netflix or check your saved setup.");
    } finally {
      running = false;
      if (rerun) {
        rerun = false;
        scheduleScan();
      }
    }
  }

  async function refresh() {
    const current = await store.getSettings();
    const changed = settingsKey(current) !== settingsKey(settings);
    if (changed) {
      revision += 1;
      settings = current;
    }
    if (changed && ["selected", "entering-pin", "confirming"].includes(stage)) {
      finish("setup-changed", "Your setup changed. Reload to use the new settings.");
    } else if (!paused && stage !== "done") {
      await run();
    }
    return { status };
  }

  function scan() {
    const page = netflix.getPageState(document);
    if (!netflix.isSupportedPage(location)) {
      return { profiles: [], page, status: { code: "unsupported-page", message: "Open Netflix’s profile chooser to set up the extension." } };
    }
    return {
      profiles: netflix.readProfiles(document).map(({ id, name, avatar, locked }) => ({ id, name, avatar, locked })),
      page,
      status,
    };
  }

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id && sender.id !== api.runtime.id) return false;
    if (message?.type === "NF_SCAN") {
      sendResponse(scan());
      return false;
    }
    if (message?.type === "NF_PAUSE_TAB") {
      paused = true;
      revision += 1;
      stopWatching();
      setStatus("paused", "Paused in this tab. Reload to run again.");
      sendResponse({ status });
      return false;
    }
    if (message?.type === "NF_RESUME_TAB" && ["waiting", "opened"].includes(stage)) {
      paused = false;
      revision += 1;
    }
    if (message?.type === "NF_REFRESH" || message?.type === "NF_RESUME_TAB") {
      refresh().then(sendResponse, () => sendResponse({ status: { code: "error", message: "Could not refresh settings." } }));
      return true;
    }
    return false;
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
      refresh().catch(() => finish("error", "Could not refresh settings. Reload Netflix to try again."));
    }
  });
  window.addEventListener("popstate", () => {
    if (selectedUrl && selectedUrl !== location.href) finish("navigated", "Automatic entry stopped after navigation. Reload to run again.");
    else scheduleScan();
  });
  window.addEventListener("pagehide", () => {
    finish("navigated", "Automatic entry stopped after navigation.");
  });
  window.addEventListener("load", () => { void run(); }, { once: true });
  void run();
})();
