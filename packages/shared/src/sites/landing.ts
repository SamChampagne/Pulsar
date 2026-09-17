export enum LandingPageStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
}

export const LANDING_BLOCK_TYPES = ['heading', 'text', 'image', 'form', 'cta'] as const;
export type LandingBlockType = (typeof LANDING_BLOCK_TYPES)[number];
export const LANDING_FORM_FIELDS = ['name', 'email', 'phone', 'company', 'message'] as const;

/** URL-safe slug: lowercase, strip accents, non-alnum → dashes, collapse/trim dashes. */
export function slugify(input: string): string {
  return (input ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Extract recognised lead fields from a raw form submission (pure). */
export function mapSubmissionToContact(data: Record<string, unknown>): {
  name?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  message?: string;
} {
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
  const out: {
    name?: string;
    email?: string;
    phone?: string;
    companyName?: string;
    message?: string;
  } = {};
  if (str(data.name)) out.name = str(data.name);
  if (str(data.email)) out.email = str(data.email);
  if (str(data.phone)) out.phone = str(data.phone);
  if (str(data.company)) out.companyName = str(data.company);
  if (str(data.message)) out.message = str(data.message);
  return out;
}

/**
 * cta href: a single-leading-slash relative path, or an absolute http(s) URL —
 * never javascript:/data:/etc, and never protocol-relative (`//evil.com` or
 * `/\evil.com` — browsers normalize a backslash to a forward slash in http(s)
 * URLs, so `/\evil.com` resolves to `//evil.com`, the same open redirect).
 * Backslashes are rejected outright (no legitimate use in a cta href).
 */
const CTA_HREF_PATTERN = /^(\/(?![\\/])|https:\/\/|http:\/\/)/;

/** Permissive shape check: content must be an array of blocks with a known type. */
export function validateLandingContent(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.every((b) => {
    if (!b || typeof b !== 'object') return false;
    const type = (b as { type?: string }).type as LandingBlockType;
    if (!LANDING_BLOCK_TYPES.includes(type)) return false;
    if (type === 'cta') {
      const label = (b as { label?: unknown }).label;
      const href = (b as { href?: unknown }).href;
      if (typeof label !== 'string' || label.trim().length === 0 || label.length > 80) {
        return false;
      }
      if (
        typeof href !== 'string' ||
        href.length === 0 ||
        href.includes('\\') ||
        !CTA_HREF_PATTERN.test(href)
      ) {
        return false;
      }
    }
    return true;
  });
}
