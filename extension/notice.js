(() => {
  "use strict";

  let notice = null;
  let timer = null;

  function removeNotice() {
    notice?.remove();
    notice = null;
    clearTimeout(timer);
  }

  function notifyProfileOpened(name) {
    removeNotice();
    notice = document.createElement("div");
    notice.id = "nf-auto-profile-notice";
    const root = notice.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial; position: fixed; inset: auto 20px 20px auto;
        z-index: 2147483647; pointer-events: none;
        max-width: min(360px, calc(100vw - 40px));
      }
      p {
        margin: 0; padding: 12px 16px; border: 1px solid #454545; border-radius: 4px;
        background: #1f1f1f; color: #f5f5f1;
        font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        overflow-wrap: anywhere;
      }
      strong { font-weight: 600; }
    `;
    const message = document.createElement("p");
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");
    message.setAttribute("aria-atomic", "true");
    root.append(style, message);
    document.documentElement.append(notice);
    const brand = document.createElement("strong");
    brand.textContent = "NF Auto Profile";
    const profile = document.createElement("bdi");
    profile.textContent = name;
    message.append(brand, " opened ", profile, ".");
    timer = setTimeout(removeNotice, 3000);
  }

  window.addEventListener("pagehide", removeNotice);
  (globalThis.NFAuto ??= {}).notifyProfileOpened = notifyProfileOpened;
})();
