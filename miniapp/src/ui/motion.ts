import { animate } from "framer-motion";

// Motion tokens: every duration and spring in the app comes from here.
export const M = {
  dur: { fast: 0.18, normal: 0.35, slow: 0.6, crawl: 1 },
  ease: { smooth: [0.22, 1, 0.36, 1] as const, sharp: [0.4, 0, 0.2, 1] as const },
  spring: {
    snappy: { type: "spring", stiffness: 340, damping: 30 } as const,
    gentle: { type: "spring", stiffness: 130, damping: 18 } as const,
    bouncy: { type: "spring", stiffness: 420, damping: 16 } as const,
    roll: { type: "spring", stiffness: 90, damping: 18 } as const,
    sheet: { type: "spring", stiffness: 320, damping: 34 } as const,
  },
  press: 0.96,
};

/** Where a card's crests and odds sit on screen, so what opens can grow out of them. */
export type Morph = Partial<Record<string, HTMLElement>>;

/**
 * Grows the sheet out of the card: clones of the crests and odds fly from where
 * they sit to their place in the sheet. Clones rather than a shared layoutId,
 * because the target rides on a sheet that is itself sliding up.
 */
export function flyIn(morph: Morph, header: HTMLElement) {
  const sheet = header.closest(".pn-sheet, .pn-detail");
  const phone = header.closest(".pn-phone");
  const stage = header.closest(".pn-stage");
  if (!sheet || !phone || !stage) return () => {};
  const sheetRect = sheet.getBoundingClientRect();
  // The sheet starts below the screen, so aim at where it will come to rest.
  const dy = sheetRect.top - (phone.getBoundingClientRect().bottom - sheetRect.height);
  const stops = Object.keys(morph).map((key) => {
    const src = morph[key];
    const to = header.querySelector<HTMLElement>(`[data-morph-to="${key}"]`);
    if (!src || !to) return () => {};
    const from = src.getBoundingClientRect();
    const target = to.getBoundingClientRect();
    const clone = src.cloneNode(true) as HTMLElement;
    clone.style.cssText = `position:fixed;left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px;margin:0;z-index:40;transform-origin:top left;pointer-events:none`;
    stage.append(clone);
    src.style.visibility = "hidden";
    to.style.visibility = "hidden";
    const finish = () => {
      clone.remove();
      src.style.visibility = "";
      to.style.visibility = "";
    };
    const flight = animate(clone, { x: target.left - from.left, y: target.top - dy - from.top, scale: target.width / from.width }, M.spring.sheet);
    void flight.then(finish);
    return () => {
      flight.stop();
      finish();
    };
  });
  return () => stops.forEach((stop) => stop());
}

/** The way back: the same clones return from the sheet to the card as it closes. */
export function flyOut(morph: Morph, header: HTMLElement) {
  const stage = header.closest(".pn-stage");
  if (!stage) return;
  for (const key of Object.keys(morph)) {
    const home = morph[key];
    const from = header.querySelector<HTMLElement>(`[data-morph-to="${key}"]`);
    if (!home?.isConnected || !from) continue;
    const start = from.getBoundingClientRect();
    const end = home.getBoundingClientRect();
    const clone = from.cloneNode(true) as HTMLElement;
    clone.style.cssText = `position:fixed;left:${start.left}px;top:${start.top}px;width:${start.width}px;height:${start.height}px;margin:0;z-index:40;transform-origin:top left;pointer-events:none`;
    stage.append(clone);
    home.style.visibility = "hidden";
    const finish = () => {
      clone.remove();
      home.style.visibility = "";
    };
    void animate(clone, { x: end.left - start.left, y: end.top - start.top, scale: end.width / start.width }, M.spring.sheet).then(finish);
  }
}
