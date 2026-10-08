export const profiles = [
  { id: 'AAAAAAAAAAAAAAAAAAAAAAAAAA', name: 'Alex', avatar: 'https://assets.nflximg.net/first.png', locked: true },
  { id: 'BBBBBBBBBBBBBBBBBBBBBBBBBB', name: 'Alex', avatar: 'https://assets.nflximg.net/second.png', locked: false },
];

export function fixture(options = {}) {
  const config = { profiles, rejected: false, delayed: false, ...options };
  return `<!doctype html><html><head><meta charset="utf-8"><title>Netflix fixture</title>
    <style>
      body { font: 16px sans-serif; }
      [data-uia="profile-selector"] { display: flex; gap: 20px; }
      button { padding: 12px; }
      button > span { display: block; }
      img { width: 100px; height: 100px; }
    </style></head><body><main id="root"></main><script>
    const config = ${JSON.stringify(config)};
    const root = document.getElementById('root');
    let ready = !config.delayed;
    let currentProfiles = config.profiles;
    window.selected = [];
    window.attempts = [];
    window.clicks = 0;
    root.addEventListener('click', event => {
      if (event.target.closest('button[data-uia^="profile-selector+tile-"]')) window.clicks++;
    }, true);

    window.showCatalog = () => {
      root.removeAttribute('data-uia');
      root.innerHTML = '<button data-uia="navigation+profile-menu+trigger">Switch profiles</button>';
      root.firstElementChild.onclick = () => window.showChooser();
    };

    function showPin() {
      root.innerHTML = '<input data-uia="profile-gate-pin+input" type="text" autocomplete="one-time-code">';
      root.firstElementChild.oninput = event => {
        if (event.target.value.length !== 4) return;
        window.attempts.push(event.target.value);
        if (config.rejected) event.target.value = '';
        else window.showCatalog();
      };
    }

    window.activateProfiles = () => {
      ready = true;
      [...root.querySelectorAll('button')].forEach((card, index) => {
        card.onclick = () => {
          const profile = currentProfiles[index];
          window.selected.push(profile.id);
          if (profile.locked) showPin();
          else window.showCatalog();
        };
      });
    };

    window.showChooser = (list = config.profiles) => {
      currentProfiles = list;
      root.dataset.uia = 'profile-gate-screen';
      root.innerHTML = '<div data-uia="profile-selector"></div>';
      list.forEach((profile, index) => {
        const card = document.createElement('button');
        card.dataset.uia = 'profile-selector+tile-' + profile.id;
        card.innerHTML = '<div><img></div><span><span></span></span>';
        card.querySelector('img').src = profile.avatar;
        card.querySelector(':scope > span > span').textContent = profile.name;
        if (profile.locked) {
          const lock = document.createElement('span');
          lock.dataset.uia = card.dataset.uia + '+lock';
          lock.textContent = 'Lock';
          card.firstElementChild.append(lock);
        }
        if (index === 0) {
          for (const label of [card.lastElementChild, card.lastElementChild.firstElementChild]) {
            const style = document.createElement('style');
            style.textContent = '.fixture-profile-label { --label-spacing: unset; }';
            label.prepend(style);
          }
        }
        root.firstElementChild.append(card);
      });
      if (ready) window.activateProfiles();
    };
    window.showChooser();
    </script>${config.delayed ? '<script async src="/profile-ready.js"></script>' : ''}</body></html>`;
}
