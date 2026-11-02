/**
 * Runs in <head> before paint, so a saved light or dark choice never flashes.
 * Kept out of ThemeToggle.tsx because exports of a "use client" module reach
 * server components as client references, not values.
 */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
