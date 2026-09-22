// Fullscreen is requested on <html>, so it survives SPA route changes.
const root = document.documentElement;

export const fullscreenSupported = Boolean(root.requestFullscreen || root.webkitRequestFullscreen);

export function isFullscreen() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

export async function toggleFullscreen() {
  try {
    if (isFullscreen()) {
      await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      await (root.requestFullscreen || root.webkitRequestFullscreen).call(root, { navigationUI: "hide" });
    }
  } catch {
    // Browser refused (e.g. not triggered by a user gesture) – nothing to do.
  }
}

export function onFullscreenChange(fn) {
  document.addEventListener("fullscreenchange", fn);
  document.addEventListener("webkitfullscreenchange", fn);
  return () => {
    document.removeEventListener("fullscreenchange", fn);
    document.removeEventListener("webkitfullscreenchange", fn);
  };
}
