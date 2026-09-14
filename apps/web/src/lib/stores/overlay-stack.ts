/** Tracks open overlays (modals, panels, palette) so Escape only closes the topmost. */
let stack: symbol[] = [];

export function pushOverlay(): symbol {
  const token = Symbol();
  stack = [...stack, token];
  return token;
}

export function popOverlay(token: symbol) {
  stack = stack.filter((t) => t !== token);
}

export function isTopOverlay(token: symbol): boolean {
  return stack[stack.length - 1] === token;
}

/** Reference-counted locks include the independently scrolling work surface. */
let lockCount = 0;
let scrollLocks: { element: HTMLElement; overflow: string }[] = [];

export function lockScroll() {
  if (++lockCount !== 1) return;
  const workspaces = Array.from(document.querySelectorAll<HTMLElement>('[data-workspace-scroll]'));
  scrollLocks = [document.body, ...workspaces].map((element) => ({
    element,
    overflow: element.style.overflow,
  }));
  for (const { element } of scrollLocks) element.style.overflow = 'hidden';
}

export function unlockScroll() {
  if (lockCount > 0 && --lockCount === 0) {
    for (const { element, overflow } of scrollLocks) element.style.overflow = overflow;
    scrollLocks = [];
  }
}

export function hasOpenOverlay(): boolean {
  return stack.length > 0;
}

export function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (element) =>
      !element.matches(':disabled, [aria-disabled="true"], [inert], [type="hidden"]') &&
      !element.closest('[inert]') &&
      element.getClientRects().length > 0,
  );
}
