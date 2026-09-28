import { BadRequestException } from '@nestjs/common';
/** Signature check, not antivirus or legal certification. Always download as attachment. */
export function validateEvidenceFile(file?: Express.Multer.File) {
  if (!file?.buffer.length || file.buffer.length > 10 * 1024 * 1024)
    throw new BadRequestException('Choisissez un fichier non vide de 10 Mo maximum.');
  if (
    !file.originalname ||
    file.originalname.length > 180 ||
    /[\x00-\x1f\x7f]/.test(file.originalname)
  )
    throw new BadRequestException('Nom de fichier invalide.');
  const b = file.buffer;
  const valid =
    (file.mimetype === 'application/pdf' && b.subarray(0, 5).toString() === '%PDF-') ||
    (file.mimetype === 'image/png' &&
      b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (file.mimetype === 'image/jpeg' && b.subarray(0, 3).equals(Buffer.from([255, 216, 255])));
  if (!valid)
    throw new BadRequestException(
      'Formats acceptés : PDF, PNG ou JPEG avec une signature de fichier valide.',
    );
  return file;
}
