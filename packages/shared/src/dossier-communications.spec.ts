import { describe, it, expect } from 'vitest';
import {
  CommunicationChannel as C,
  DossierEmailStatus as S,
  canTransitionDossierEmail,
  communicationHtml,
  normalizeCommunicationRecipient,
  renderCommunicationTemplate,
  COMMUNICATION_ACCESS,
} from './dossier-communications';
describe('Dossier communications', () => {
  it('uses terminal, single-attempt email outcomes', () => {
    for (const from of Object.values(S))
      for (const to of Object.values(S))
        expect(canTransitionDossierEmail(from, to)).toBe(from === S.SENDING && to !== S.SENDING);
  });
  it('normalizes a single recipient, never inferring a country or accepting headers/lists', () => {
    expect(normalizeCommunicationRecipient(C.EMAIL, ' CONTACT@example.test ')).toBe(
      'contact@example.test',
    );
    expect(normalizeCommunicationRecipient(C.SMS, ' +15145550123 ')).toBe('+15145550123');
    for (const value of ['5145550123', '+15145550123 ext 2', 'abc'])
      expect(normalizeCommunicationRecipient(C.SMS, value)).toBeNull();
    for (const value of [
      'a@x.test,b@y.test',
      'a@x.test\r\nBcc:b@y.test',
      'Alex <a@x.test>',
      'no-at',
    ])
      expect(normalizeCommunicationRecipient(C.EMAIL, value)).toBeNull();
  });
  it('renders only closed variables and reports missing values', () => {
    expect(
      renderCommunicationTemplate('{{ dossier }} / {{secret}} / {{client}}', { dossier: 'JOB-42' }),
    ).toEqual({ value: 'JOB-42 / {{secret}} / {{client}}', missing: ['secret', 'client'] });
  });
  it('escapes HTML without interpreting user content', () => {
    expect(communicationHtml('<script>"&\'</script>')).toContain(
      '&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;',
    );
    expect(communicationHtml('<img src="https://x.test">')).not.toContain('<img');
  });
  it('keeps source grants unique and excludes financial documents', () => {
    expect(new Set(COMMUNICATION_ACCESS.map((a) => a.path)).size).toBe(COMMUNICATION_ACCESS.length);
    expect(COMMUNICATION_ACCESS.some((a) => a.path === 'services/jobs')).toBe(true);
    expect(COMMUNICATION_ACCESS.some((a) => a.path.includes('invoices/'))).toBe(false);
  });
});
