import { redirect } from '@sveltejs/kit';
import { getAccessToken } from '$lib/stores/auth';

export function load() {
  redirect(307, getAccessToken() ? '/dashboard' : '/login');
}
