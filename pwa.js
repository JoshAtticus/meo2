// Easy install (Chrome on Android and ChromeOS) and the collapsible window
// bar (window-controls-overlay) for the installed app.

let installPrompt = null;

window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    installPrompt = e;
    showInstallButtons();
});

window.addEventListener("appinstalled", () => {
    installPrompt = null;
    document.querySelectorAll(".install-app").forEach(el => el.remove());
});

async function installApp() {
    if (!installPrompt) return;
    installPrompt.prompt();
    const {outcome} = await installPrompt.userChoice;
    if (outcome === "accepted") {
        installPrompt = null;
        document.querySelectorAll(".install-app").forEach(el => el.remove());
    }
}

// Add install buttons to the Start page shortcuts and the settings menu
// whenever they're on screen and meo can be installed.
function showInstallButtons() {
    if (!installPrompt) return;
    const quick = document.querySelector(".quick-btns");
    if (quick && !quick.querySelector(".install-app")) {
        const btn = document.createElement("button");
        btn.className = "qbtn button install-app";
        btn.setAttribute("aria-label", "install meo");
        btn.textContent = "Install meo";
        btn.onclick = installApp;
        quick.appendChild(btn);
    }
    const logoutBtn = document.querySelector(".settings-button#logout");
    if (logoutBtn && !logoutBtn.parentElement.querySelector(".install-app")) {
        const btn = document.createElement("input");
        btn.type = "button";
        btn.className = "settings-button button install-app";
        btn.value = "Install meo";
        btn.setAttribute("aria-label", "install meo");
        btn.onclick = installApp;
        logoutBtn.before(btn);
    }
}

// Pages are re-rendered often, so re-add the buttons when the DOM changes.
new MutationObserver(() => {
    if (installPrompt) showInstallButtons();
}).observe(document.documentElement, {childList: true, subtree: true});

// Window controls overlay: mark the page so pwa.css can lay out around the
// window buttons, and keep it in sync when the bar is collapsed/expanded.
if ("windowControlsOverlay" in navigator) {
    const sync = () => document.documentElement.classList.toggle(
        "wco", navigator.windowControlsOverlay.visible
    );
    navigator.windowControlsOverlay.addEventListener("geometrychange", sync);
    sync();
}
