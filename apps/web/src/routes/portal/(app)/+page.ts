import { redirect } from '@sveltejs/kit';

/** `/portal` has no surface of its own — the home is the dashboard. */
export function load() {
  redirect(307, '/portal/dashboard');
}
