// Fills in the version in the toolbar popup.
const api = globalThis.browser ?? globalThis.chrome;
document.getElementById("version").textContent = "v" + api.runtime.getManifest().version;
