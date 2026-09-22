/** Opt-in for operational forms. Enter never submits implicitly; the save button does. */
export function enterNext(form: HTMLFormElement) {
  const handle = (event: KeyboardEvent) => {
    if (
      event.key !== 'Enter' ||
      event.defaultPrevented ||
      event.isComposing ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey
    )
      return;
    const target = event.target;
    if (
      !(target instanceof HTMLInputElement) ||
      target.form !== form ||
      ['submit', 'button', 'checkbox', 'radio', 'file'].includes(target.type) ||
      target.getAttribute('role') === 'combobox' ||
      target.hasAttribute('data-scan-input') ||
      target.hasAttribute('list')
    )
      return;
    event.preventDefault();
    if (!event.shiftKey && !target.reportValidity()) return;
    const fields = Array.from(
      form.querySelectorAll<HTMLElement>('input, select, textarea, button'),
    ).filter(
      (el) =>
        !el.matches(':disabled, [type=hidden], [tabindex="-1"]') && el.getClientRects().length > 0,
    );
    const next = fields[fields.indexOf(target) + (event.shiftKey ? -1 : 1)];
    next?.focus();
  };
  form.addEventListener('keydown', handle);
  return { destroy: () => form.removeEventListener('keydown', handle) };
}
