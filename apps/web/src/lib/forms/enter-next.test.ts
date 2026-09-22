import { afterEach, describe, expect, it, vi } from 'vitest';
import { enterNext } from './enter-next';
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});
function setup() {
  document.body.innerHTML =
    '<form><input id="a"><input id="b"><textarea></textarea><button type="submit">Save</button></form>';
  const form = document.querySelector('form')!;
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  enterNext(form);
  return form;
}
describe('operational Enter navigation', () => {
  it('advances without submitting, supports backwards navigation', () => {
    setup();
    const a = document.querySelector<HTMLInputElement>('#a')!,
      b = document.querySelector<HTMLInputElement>('#b')!;
    a.focus();
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    a.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(b);
    b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(a);
  });
  it('preserves textareas, composition, comboboxes and existing key handlers', () => {
    setup();
    const input = document.querySelector('input')!;
    for (const mode of ['textarea', 'composition', 'combobox', 'handled']) {
      input.removeAttribute('role');
      if (mode === 'combobox') input.setAttribute('role', 'combobox');
      const target = mode === 'textarea' ? document.querySelector('textarea')! : input;
      target.focus();
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
        isComposing: mode === 'composition',
      });
      if (mode === 'handled') event.preventDefault();
      target.dispatchEvent(event);
      expect(document.activeElement).toBe(target);
    }
  });
});
