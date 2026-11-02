"use client";

const ORDER = ["system", "light", "dark"] as const;
type Mode = (typeof ORDER)[number];

function current(): Mode {
  const value = document.documentElement.getAttribute("data-theme");
  return value === "light" || value === "dark" ? value : "system";
}

function apply(mode: Mode) {
  const root = document.documentElement;
  if (mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
  try {
    localStorage.setItem("theme", mode);
  } catch {
    // Storage can be blocked; the choice then lasts for this page only.
  }
}

/** Cycles system → light → dark. CSS shows the icon for the mode on <html>. */
export function ThemeToggle() {
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label="Theme: system, light or dark"
      title="Theme"
      onClick={() => apply(ORDER[(ORDER.indexOf(current()) + 1) % ORDER.length])}
    >
      <svg className="icon-system" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        <rect x="2" y="3" width="12" height="8" rx="1.5" />
        <path d="M6 14h4" />
      </svg>
      <svg className="icon-light" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" />
      </svg>
      <svg className="icon-dark" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z" />
      </svg>
    </button>
  );
}
