import { BadRequestException } from '@nestjs/common';

/** Key namespace reserved for EDI partners. */
export const EDI_KEY_PREFIX = 'edi-';
/** `config.format` marking an integration as an X12 endpoint. */
export const X12_FORMAT = 'x12';

function formatOf(config: Record<string, unknown> | undefined): string {
  return typeof config?.format === 'string' ? config.format : '';
}

/** Null-safe: a partial projection must never crash a dispatch decision. */
function hasEdiKey(key: string | undefined): boolean {
  return typeof key === 'string' && key.startsWith(EDI_KEY_PREFIX);
}

/**
 * THE definition of an EDI integration — one predicate, used by every gate and
 * by both inbound doors.
 *
 * Both halves are required. Keying only on the prefix let a `config.format:
 * 'x12'` on an arbitrary key reach the EDI plane through the public receiver
 * while skipping the configuration gates; keying only on the format let an
 * `edi-*` integration configured without it slip past the same gates. The save
 * path keeps the two in sync (see {@link normalizeEdiConfig}), so this is an
 * equivalence at rest — and a defensive AND at dispatch time.
 */
export function isEdiIntegration(
  key: string | undefined,
  config: Record<string, unknown> | undefined,
): boolean {
  return hasEdiKey(key) && formatOf(config) === X12_FORMAT;
}

/**
 * True when a configuration *claims* to be EDI by either half. Every guard
 * (permission gate, FK ownership, egress) runs on this wider predicate, so a
 * half-declared receiver is checked rather than waved through.
 */
export function mentionsEdi(
  key: string | undefined,
  config: Record<string, unknown> | undefined,
): boolean {
  return hasEdiKey(key) || formatOf(config) === X12_FORMAT;
}

/**
 * Makes the two halves agree before anything is persisted:
 *  - `format: 'x12'` on a key outside the `edi-` namespace is refused (400) —
 *    that was the bypass: it would have produced an anonymous EDI door whose
 *    key never triggered the permission gate;
 *  - an `edi-*` key without a format gets `x12` (the only one it can have);
 *  - an `edi-*` key with another format is refused.
 *
 * Returns the configuration to persist (a copy when it had to be completed).
 */
export function normalizeEdiConfig(
  key: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const format = formatOf(config);
  const isEdiKey = hasEdiKey(key);

  if (format === X12_FORMAT && !isEdiKey) {
    throw new BadRequestException(
      `format "${X12_FORMAT}" requires an "${EDI_KEY_PREFIX}<partner>" integration key`,
    );
  }
  if (!isEdiKey) return config;
  if (!format) return { ...config, format: X12_FORMAT };
  if (format !== X12_FORMAT) {
    throw new BadRequestException(
      `an "${EDI_KEY_PREFIX}<partner>" integration must use format "${X12_FORMAT}"`,
    );
  }
  return config;
}
