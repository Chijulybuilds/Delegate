// Applies the dashboard's dark theme before the first paint, so it never flashes white.
// Only inside /app: the landing page and sign-in are always light. See src/lib/theme.ts.
(function () {
  try {
    var p = location.pathname;
    if (p !== '/app' && p.indexOf('/app/') !== 0) return;
    document.documentElement.setAttribute('data-scope', 'app'); // slightly larger text in the dashboard
    var t = localStorage.getItem('delegate.theme');
    if (t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  } catch (e) {}
})();
