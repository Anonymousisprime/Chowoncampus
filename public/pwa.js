(() => {
  if (!("serviceWorker" in navigator)) return;

  const button = document.getElementById("installAppButton");
  let installPrompt = null;
  const isStandalone = () =>
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
  const isAppleMobile = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  function showInstallButton() {
    if (button && !isStandalone()) button.classList.remove("hidden");
  }

  if (!isStandalone() && isAppleMobile) showInstallButton();

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    showInstallButton();
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    if (button) button.classList.add("hidden");
  });

  if (button) {
    button.addEventListener("click", async () => {
      if (isStandalone()) {
        button.classList.add("hidden");
        return;
      }
      if (installPrompt) {
        installPrompt.prompt();
        const choice = await installPrompt.userChoice;
        if (choice.outcome === "accepted") button.classList.add("hidden");
        installPrompt = null;
        return;
      }
      if (isAppleMobile) {
        window.alert("To install ChowOnCampus on your iPhone or iPad:\n\n1. Open this page in Safari.\n2. Tap the Share button.\n3. Choose “Add to Home Screen”.\n4. Tap “Add”.\n\nChowOnCampus will appear on your Home Screen like an app.");
        return;
      }
      window.alert("To install ChowOnCampus, open your browser menu and choose “Install app” or “Add to Home Screen”.");
    });
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
      .then(registration => registration.update().catch(() => {}))
      .catch(error => console.warn("ChowOnCampus offline app setup failed:", error));
  });
})();
