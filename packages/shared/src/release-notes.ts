export enum ReleaseNoteKind {
  FEATURE = 'FEATURE',
  IMPROVEMENT = 'IMPROVEMENT',
  FIX = 'FIX',
}

export enum ReleaseNoteStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function applyBold(escaped: string): string {
  return escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/**
 * Pure, safe renderer for release note bodies: escapes HTML first, then applies
 * `**bold**` and splits blank-line-separated blocks into `<ul><li>` (all lines
 * starting with `- `) or `<p>` (lines joined with `<br>`) blocks.
 */
export function renderReleaseNoteBody(body: string): string {
  const blocks = body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  return blocks
    .map((block) => {
      const lines = block
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      const isBulletList = lines.length > 0 && lines.every((line) => line.startsWith('- '));

      if (isBulletList) {
        const items = lines
          .map((line) => applyBold(escapeHtml(line.slice(2))))
          .map((item) => `<li>${item}</li>`)
          .join('');
        return `<ul>${items}</ul>`;
      }

      const paragraph = lines.map((line) => applyBold(escapeHtml(line))).join('<br>');
      return `<p>${paragraph}</p>`;
    })
    .join('');
}
