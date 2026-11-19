/* Local development uses the local API; production uses the same-origin Vercel API route.
   For a separately deployed backend, set this to that deployment's public /api URL. */
(() => {
  if (window.NOURISH_API_BASE) return;
  const localHosts = ['localhost', '127.0.0.1', '::1'];
  window.NOURISH_API_BASE = localHosts.includes(window.location.hostname)
    ? 'http://localhost:3000/api'
    : `${window.location.origin}/api`;
})();
