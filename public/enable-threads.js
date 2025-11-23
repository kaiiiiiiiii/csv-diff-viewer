if (typeof window !== "undefined" && window.location.hostname !== "localhost") {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register(new URL("coi-serviceworker.js", import.meta.url))
      .then((registration) => {
        if (registration.active && !navigator.serviceWorker.controller) {
          window.location.reload();
        }
      });
  }
}
