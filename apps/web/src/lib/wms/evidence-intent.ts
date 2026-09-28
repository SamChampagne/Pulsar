export type EvidenceIntent = {
  operationKey: string;
  caption: string;
  fileName: string;
  mimeType: string;
  size: number;
  sha256: string;
};
export function readEvidenceIntent(key: string): EvidenceIntent | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const p = JSON.parse(raw);
  if (
    !p ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      p.operationKey,
    ) ||
    typeof p.caption !== 'string' ||
    p.caption.trim().length < 3 ||
    p.caption.length > 1000 ||
    typeof p.fileName !== 'string' ||
    !p.fileName.length ||
    p.fileName.length > 180 ||
    !['application/pdf', 'image/png', 'image/jpeg'].includes(p.mimeType) ||
    !Number.isInteger(p.size) ||
    p.size <= 0 ||
    p.size > 10 * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/.test(p.sha256)
  )
    throw new Error(
      'Demande de pièce illisible. Faites vérifier le registre avant de la réinitialiser.',
    );
  return p;
}
export function rememberEvidenceIntent(key: string, p: EvidenceIntent) {
  const old = readEvidenceIntent(key);
  if (old && JSON.stringify(old) !== JSON.stringify(p))
    throw new Error('Une autre pièce attend déjà confirmation.');
  localStorage.setItem(key, JSON.stringify(p));
}
export function sameEvidenceFile(
  p: EvidenceIntent,
  file: { name: string; type: string; size: number },
  sha256: string,
) {
  return (
    p.fileName === file.name &&
    p.mimeType === file.type &&
    p.size === file.size &&
    p.sha256 === sha256
  );
}
