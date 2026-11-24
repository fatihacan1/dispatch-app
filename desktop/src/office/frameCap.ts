/**
 * Says when an office scene may draw: never when hidden, folded away or while the window is dragged; at most 30 fps in
 * front. Without focus a scene stands still, only the music bars go on at 12 fps.
 */
export function frameGate(container: HTMLElement, background = false): (t: number) => boolean {
  let last = -Infinity;
  return (t: number) => {
    const front = document.hasFocus();
    if (document.hidden || (!front && !background)) return false;
    if (document.documentElement.classList.contains("win-moving")) return false;
    if (!container.offsetParent || !container.clientWidth) return false;
    // A little early rather than late: 30 fps must not become 20 on a 60 Hz display.
    if (t - last < (front ? 1000 / 30 : 1000 / 12) - 4) return false;
    last = t;
    return true;
  };
}
