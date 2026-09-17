import { describe, expect, it } from 'vitest';
import { renderReleaseNoteBody } from './release-notes';

describe('renderReleaseNoteBody', () => {
  it('escapes html', () => {
    expect(renderReleaseNoteBody('<script>alert(1)</script>')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );
  });
  it('renders paragraphs, bold and bullets', () => {
    expect(renderReleaseNoteBody('Titre **fort**\n\n- un\n- deux')).toBe(
      '<p>Titre <strong>fort</strong></p><ul><li>un</li><li>deux</li></ul>',
    );
  });
  it('returns empty string for blank input', () => {
    expect(renderReleaseNoteBody('  \n ')).toBe('');
  });
});
