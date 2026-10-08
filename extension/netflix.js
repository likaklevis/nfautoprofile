(() => {
  "use strict";

  const namespace = (globalThis.NFAuto ??= {});
  const avatarDomains = ["netflix.com", "nflximg.com", "nflximg.net", "nflxso.net", "nflxext.com"];
  const cardSelector = 'button[data-uia^="profile-selector+tile-"]';

  function profileId(card) {
    return /^profile-selector\+tile-([A-Z0-9]{26})$/.exec(card.getAttribute("data-uia") ?? "")?.[1] ?? null;
  }

  function normalizeName(value) {
    return typeof value === "string" ? value.normalize("NFC").replace(/\s+/g, " ").trim() : "";
  }

  function isSupportedPage(location) {
    return location.protocol === "https:"
      && ["netflix.com", "www.netflix.com"].includes(location.hostname)
      && /^\/(?:browse\/?)?$/.test(location.pathname);
  }

  function normalizeAvatar(value) {
    if (typeof value !== "string" || !value) return "";
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password) return "";
      if (!avatarDomains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) return "";
      return url.href;
    } catch {
      return "";
    }
  }

  function isVisible(element) {
    if (!element?.isConnected || element.closest('[hidden], [aria-hidden="true"]')) return false;
    const visibility = element.ownerDocument.defaultView.getComputedStyle(element).visibility;
    return visibility !== "hidden" && visibility !== "collapse" && element.getClientRects().length > 0;
  }

  function findChooser(document) {
    for (const gate of document.querySelectorAll('[data-uia="profile-gate-screen"]')) {
      if (!isVisible(gate)) continue;
      const chooser = gate.querySelector('[data-uia="profile-selector"]');
      if (chooser?.querySelector(cardSelector)) return chooser;
    }
    return null;
  }

  function readName(card) {
    const label = card.querySelector(":scope > span");
    return isVisible(label) ? normalizeName(label.innerText) : "";
  }

  function readAvatar(card) {
    const image = card.querySelector(":scope > div > img");
    return normalizeAvatar(image?.currentSrc || image?.src);
  }

  function orderProfiles(profiles) {
    const positions = profiles.map((profile) => {
      const icon = profile.element.querySelector(":scope > div > img");
      const iconRect = icon?.getBoundingClientRect();
      const rect = iconRect?.width && iconRect.height ? iconRect : profile.element.getBoundingClientRect();
      return { profile, rect };
    }).sort((first, second) => first.rect.top - second.rect.top || first.rect.left - second.rect.left);

    const rows = [];
    for (const position of positions) {
      const row = rows.find(({ rect }) => {
        const overlap = Math.min(rect.bottom, position.rect.bottom) - Math.max(rect.top, position.rect.top);
        return overlap >= Math.min(rect.height, position.rect.height) / 2;
      });
      if (row) row.positions.push(position);
      else rows.push({ rect: position.rect, positions: [position] });
    }
    return rows.flatMap((row) => row.positions
      .sort((first, second) => first.rect.left - second.rect.left || first.rect.top - second.rect.top)
      .map(({ profile }) => profile));
  }

  function readProfiles(document) {
    const chooser = findChooser(document);
    if (!chooser) return [];
    const elements = [...chooser.querySelectorAll(cardSelector)];
    const profiles = elements.filter((card) => isVisible(card) && profileId(card)).map((element) => ({
      id: profileId(element),
      name: readName(element),
      avatar: readAvatar(element),
      locked: Boolean(element.querySelector(`[data-uia="${element.getAttribute("data-uia")}+lock"]`)),
      element,
    })).filter((profile) => profile.name);
    return orderProfiles(profiles);
  }

  function matchProfile(saved, profiles) {
    if (!saved) return { profile: null, code: "not-configured" };
    if (!saved.id) return { profile: null, code: "id-required" };
    const matches = profiles.filter((profile) => profile.id === saved.id);
    if (matches.length === 1) return { profile: matches[0], code: "matched" };
    return { profile: null, code: matches.length ? "ambiguous-id" : "id-missing" };
  }

  function findPinInput(document) {
    const inputs = [...document.querySelectorAll('input[data-uia="profile-gate-pin+input"]')]
      .filter(input => isVisible(input) && !input.disabled && !input.readOnly);
    return inputs.length === 1 ? inputs[0] : null;
  }

  function getPageState(document) {
    if ([...document.querySelectorAll('input[data-uia="profile-gate-pin+input"]')].some(isVisible)) return "pin";
    if ([...document.querySelectorAll('[data-uia="profile-gate-screen"]')].some(isVisible)) return "chooser";
    if ([...document.querySelectorAll('[data-uia="navigation+profile-menu+trigger"]')].some(isVisible)) return "profile";
    return "other";
  }

  function setInputValue(input, value) {
    const view = input.ownerDocument.defaultView;
    const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new view.Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new view.Event("change", { bubbles: true, composed: true }));
  }

  namespace.netflix = Object.freeze({
    isSupportedPage,
    isVisible,
    readProfiles,
    matchProfile,
    findPinInput,
    getPageState,
    setInputValue,
  });
})();
