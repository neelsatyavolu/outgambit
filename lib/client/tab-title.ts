import { useEffect } from "react";

/**
 * Shows `title` on the browser tab for as long as one is given, then puts
 * back the page's own. The framework writes the page's title into the
 * document itself, some time after the page loads and again on moving to
 * another page, so this watches for that: it notes what the framework wrote
 * and puts `title` back over it.
 */
export function useTabTitle(title: string | null): void {
  useEffect(() => {
    if (title === null) return;
    /** The page's own title, as the framework last wrote it. */
    let own: string | null = null;
    const apply = () => {
      // Until the framework has written a title there is none to stand in for.
      if (!document.querySelector("title") || document.title === title) return;
      own = document.title;
      document.title = title;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (own !== null && document.title === title) document.title = own;
    };
  }, [title]);
}
