// Theme preference ("auto" | "light" | "dark"), saved and applied as <html data-theme>.
const KEY = "factory:theme";
const PREFS = ["auto", "light", "dark"];
const THEME_COLORS = { light: "#f6f3ec", dark: "#12141a" };

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set();

export function getThemePref() {
  try {
    const saved = localStorage.getItem(KEY);
    return PREFS.includes(saved) ? saved : "auto";
  } catch {
    return "auto";
  }
}

export function getTheme() {
  const pref = getThemePref();
  if (pref !== "auto") return pref;
  return systemDark.matches ? "dark" : "light";
}

export function setThemePref(pref) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {}
  apply();
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function apply() {
  const theme = getTheme();
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
  for (const fn of listeners) fn(theme);
}

systemDark.addEventListener("change", () => getThemePref() === "auto" && apply());
apply();
