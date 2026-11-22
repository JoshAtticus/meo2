// Server addresses. On localhost meo talks to the local dev servers. When it's
// served under /meo/ from another address (the shared dev server, e.g. through
// a Cloudflare tunnel), it uses that server's /api, /cloudlink and /uploads
// proxies. Otherwise it uses the hosted servers. Each can be overridden in
// localStorage (meo_serverurl, meo_apiurl, meo_uploadsurl).
(function () {
    const local = ["localhost", "127.0.0.1"].includes(location.hostname);
    const shared = !local && location.pathname.startsWith("/meo");
    const wsOrigin = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;
    window.SERVER_URL = localStorage.getItem("meo_serverurl") ||
        (local ? "ws://127.0.0.1:3000/?v=1"
            : shared ? `${wsOrigin}/cloudlink/?v=1`
            : "wss://meower-cl.joshatticus.site/v0/cloudlink?v=1");
    window.API_URL = (localStorage.getItem("meo_apiurl") ||
        (local ? "http://127.0.0.1:3001"
            : shared ? `${location.origin}/api`
            : "https://meower-api.joshatticus.site")).replace(/\/$/, "");
    window.UPLOADS_URL = (localStorage.getItem("meo_uploadsurl") ||
        (local ? "http://127.0.0.1:3002"
            : shared ? `${location.origin}/uploads`
            : "https://uploads.meower.org")).replace(/\/$/, "");
})();
