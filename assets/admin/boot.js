/* Cleo Admin: runs before the page paints. Kept in its own file so admin.html needs no inline script. */
(() => {
  'use strict';
  // The console never runs inside another site's frame (click-hijacking overlays). The server's
  // headers refuse that first; this also covers a host that drops them.
  if (window.top !== window.self) {
    let own = false;
    try { own = window.top.location.origin === location.origin; } catch { /* another site's frame */ }
    if (!own) {
      document.documentElement.style.display = 'none';
      try { window.top.location = location.href; } catch { /* stays blank */ }
      return;
    }
  }
  // The appearance chosen in Cleo on this device, or the system's.
  try {
    let theme = JSON.parse(localStorage.getItem('cleo:theme'));
    if (theme !== 'light' && theme !== 'dark') theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
  } catch { /* the page's default (dark) stands */ }
})();
