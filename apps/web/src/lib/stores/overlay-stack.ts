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
