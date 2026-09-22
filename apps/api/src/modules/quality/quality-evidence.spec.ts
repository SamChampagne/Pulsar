import { validateQualityEvidence } from './quality-evidence';
import { assertGenericDocumentType } from '../../core/documents/protected-documents';
describe('Quality proof intake', () => {
  const file = (mime = 'application/pdf', buffer = Buffer.from('%PDF-1.7\nTest')) =>
    ({
      buffer,
      size: buffer.length,
      originalname: 'proof.pdf',
      mimetype: mime,
    }) as Express.Multer.File;
  it('accepts supported signatures and rejects a MIME-only spoof', () => {
    expect(validateQualityEvidence(file()).originalname).toBe('proof.pdf');
    expect(() =>
      validateQualityEvidence(file('application/pdf', Buffer.from('<script/>'))),
    ).toThrow();
    expect(() => validateQualityEvidence(file('text/html'))).toThrow();
    expect(() => validateQualityEvidence(undefined)).toThrow();
  });
  it('rejects empty, oversized and control-character filenames', () => {
    expect(() => validateQualityEvidence(file('application/pdf', Buffer.alloc(0)))).toThrow();
    expect(() =>
      validateQualityEvidence(file('application/pdf', Buffer.alloc(10 * 1024 * 1024 + 1))),
    ).toThrow();
    expect(() => validateQualityEvidence({ ...file(), originalname: 'x\r\nattack.pdf' })).toThrow();
  });
  it('protects the reserved business document namespace', () => {
    expect(() => assertGenericDocumentType('quality-evidence')).toThrow();
    expect(() => assertGenericDocumentType('load')).not.toThrow();
  });
});
