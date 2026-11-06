import { useEffect, useState } from "react";

function query(media: string) {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(media).matches;
}

// Returns whether a CSS media query currently matches. The first render
// already uses the real value so layouts do not flash (false without DOM).
export function useMediaQuery(media: string): boolean {
  const [matches, setMatches] = useState(() => query(media));

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(media);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    window.addEventListener("resize", update, { passive: true });
    return () => {
      mq.removeEventListener?.("change", update);
      window.removeEventListener("resize", update);
    };
  }, [media]);

  return matches;
}
