/* ui/splash.js — branded splash shown over the app on load.
   Covers the page instantly (markup is in index.html), then fades out.
   Shows once per tab session, click-to-skip, reduced-motion aware. */

const SESSION_KEY = "dnshealth:splashed";

export function playSplash() {
  const splash = document.getElementById("splash");
  if (!splash) return;

  // Already shown this session (or skipped pre-paint via the inline head script).
  if (document.documentElement.classList.contains("no-splash")) {
    splash.remove();
    return;
  }

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hold = reduced ? 400 : 1700; // time the logo stays before fading
  const fade = reduced ? 150 : 600;  // must match the CSS opacity transition

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    try { sessionStorage.setItem(SESSION_KEY, "1"); } catch (_) {}
    splash.classList.add("is-hiding");
    setTimeout(() => splash.remove(), fade);
  };

  splash.addEventListener("click", dismiss); // tap to skip
  setTimeout(dismiss, hold);
}
