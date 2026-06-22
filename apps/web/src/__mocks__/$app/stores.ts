import { vi } from 'vitest';
import { readable, writable } from 'svelte/store';

export const page = readable({
  url: new URL('http://localhost/'),
  params: {},
  route: { id: null },
  status: 200,
  error: null,
  data: {},
  state: {},
  form: undefined,
});

export const navigating = readable(null);
export const updated = readable(false);
export const getStores = vi.fn(() => ({ page, navigating, updated }));
