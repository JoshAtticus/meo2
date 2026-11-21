// Server addresses. On localhost meo talks to the local dev servers,
// otherwise to the hosted ones. Each can be overridden in localStorage
// (meo_serverurl, meo_apiurl, meo_uploadsurl).
(function () {
    const local = ["localhost", "127.0.0.1"].includes(location.hostname);
    window.SERVER_URL = localStorage.getItem("meo_serverurl") ||
        (local ? "ws://127.0.0.1:3000/?v=1" : "wss://meower-cl.joshatticus.site/v0/cloudlink?v=1");
    window.API_URL = (localStorage.getItem("meo_apiurl") ||
        (local ? "http://127.0.0.1:3001" : "https://meower-api.joshatticus.site")).replace(/\/$/, "");
    window.UPLOADS_URL = (localStorage.getItem("meo_uploadsurl") ||
        (local ? "http://127.0.0.1:3002" : "https://uploads.meower.org")).replace(/\/$/, "");
})();
