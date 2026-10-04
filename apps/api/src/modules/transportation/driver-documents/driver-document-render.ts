import PDFDocument from 'pdfkit';
import type {
  DriverDocumentRecord,
  DriverDocumentSnapshot,
  DeliveryManifestAddress,
} from '@pulsar/shared';

const MAX_BYTES = 10 * 1024 * 1024;
const PRINTABLE =
  /^[\r\n\x20-\x7e\u00a0-\u00ff\u0192\u02c6\u02dc\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u2013\u2014\u2018-\u201a\u201c-\u201e\u2020-\u2022\u2026\u2030\u2039\u203a\u20ac\u2122]*$/u;

export function validateDriverDocumentPrintable(snapshot: DriverDocumentSnapshot): void {
  if (snapshot.schemaVersion !== 1 || Buffer.byteLength(JSON.stringify(snapshot)) > 5 * 1024 * 1024)
    throw new Error('Version ou taille du document chauffeur non prise en charge.');
  const visit = (value: unknown): void => {
    if (typeof value === 'string' && !PRINTABLE.test(value))
      throw new Error(
        'Document chauffeur non imprimable : alphabet latin Windows-1252 requis, sans caractères de contrôle.',
      );
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(snapshot);
}

/** Pure rendering of the frozen allowlisted snapshot, never of the full database record. */
export function renderDriverDocument(record: DriverDocumentRecord): Promise<Buffer> {
  validateDriverDocumentPrintable(record.snapshot);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      autoFirstPage: false,
      bufferPages: true,
      size: 'LETTER',
      margin: 0,
      info: {
        Title: `Document de tournée ${record.number}`,
        Author: 'Pulsar',
        Creator: 'Pulsar Driver Document v1',
        CreationDate: new Date(record.issuedAt),
        ModDate: new Date(record.issuedAt),
      },
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    doc.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) doc.destroy(new Error('PDF trop volumineux.'));
      else chunks.push(chunk);
    });
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    try {
      let y = 66;
      const page = () => {
        doc.addPage();
        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .fillColor('#334155')
          .text('PULSAR / DOCUMENT DE TOURNÉE CHAUFFEUR', 42, 26, { lineBreak: false });
        doc.moveTo(42, 47).lineTo(570, 47).strokeColor('#cbd5e1').stroke();
        y = 66;
      };
      page();
      const write = (text: string, size = 10, bold = false) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
        for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
          let line = '';
          // Wrap words, falling back to characters only for an overlong unbroken identifier.
          const draw = () => {
            if (y + size + 5 > 738) page();
            doc
              .font(bold ? 'Helvetica-Bold' : 'Helvetica')
              .fontSize(size)
              .fillColor('#172126')
              .text(line, 42, y, { lineBreak: false });
            y += size + 5;
            line = '';
          };
          for (const word of paragraph.match(/\S+\s*|\s+/g) ?? ['']) {
            if (doc.widthOfString(line + word.trimEnd()) <= 528) {
              line += word;
              continue;
            }
            if (line.trim()) {
              line = line.trimEnd();
              draw();
            }
            for (const char of word) {
              if (doc.widthOfString(line + char) > 528) draw();
              line += char;
            }
          }
          draw();
        }
      };
      const section = (title: string) => {
        if (y + 65 > 738) page();
        y += 10;
        write(title, 12, true);
      };
      const address = (label: string, value: DeliveryManifestAddress) => {
        write(label, 9, true);
        [
          value.name,
          value.addressLine1,
          value.addressLine2,
          [value.city, value.province, value.postalCode].filter(Boolean).join(', '),
          value.country,
        ]
          .filter((s): s is string => !!s)
          .forEach((s) => write(s));
      };
      write(`${record.number} / révision ${record.revision}`, 21, true);
      write(`Chargement ${record.snapshot.load.loadNumber}`, 13, true);
      write(`Émis le ${record.issuedAt} (UTC)`, 9);
      write(
        'Copie figée publiée pour la mission chauffeur. Ne remplace ni un connaissement réglementaire, ni un document douanier, ni un POD.',
        9,
      );
      write(
        'Les codes identifient des colis déclarés; ils ne prouvent ni leur présence dans le véhicule ni leur livraison. Vérifier la mission en ligne.',
        9,
      );
      section('RESSOURCES AFFECTÉES À L’ÉMISSION');
      write(`Chauffeur : ${record.snapshot.load.driverName ?? '(non affecté)'}`);
      write(`Transporteur : ${record.snapshot.load.carrierName ?? '(non affecté)'}`);
      write(
        `Véhicule : ${record.snapshot.load.vehicleNumber ?? '(non affecté)'} | Remorque : ${record.snapshot.load.trailerNumber ?? '(non affectée)'}`,
      );
      section('ARRÊTS DE LA TOURNÉE');
      if (!record.snapshot.stops.length)
        write(
          'Aucun arrêt de tournée défini. Se reporter aux origines et destinations ci-dessous.',
        );
      for (const stop of record.snapshot.stops) {
        section(
          `${stop.sequence}. ${stop.type === 'PICKUP' ? 'Ramassage' : stop.type === 'DELIVERY' ? 'Livraison' : stop.type}`,
        );
        address('ADRESSE OPÉRATIONNELLE', stop.location);
      }
      for (const shipment of record.snapshot.shipments) {
        section(`EXPÉDITION ${shipment.shipmentNumber}`);
        address('ORIGINE', shipment.origin);
        address('DESTINATION', shipment.destination);
        write(
          shipment.trackingEnabled
            ? `${shipment.packageCodes.length} colis déclaré(s), hors annulation et retour :`
            : 'Suivi colis non activé : aucun contenu ou colis supposé.',
          9,
          true,
        );
        for (const code of shipment.packageCodes) write(code);
      }
      const range = doc.bufferedPageRange();
      for (let p = range.start; p < range.start + range.count; p++) {
        doc.switchToPage(p);
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor('#52616a')
          .text(`${record.number} / r${record.revision} - ${p + 1} / ${range.count}`, 42, 758, {
            lineBreak: false,
          });
      }
      doc.end();
    } catch (error) {
      doc.destroy();
      reject(error);
    }
  });
}
