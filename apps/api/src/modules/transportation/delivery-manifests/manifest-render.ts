import PDFDocument from 'pdfkit';
import {
  DELIVERY_MANIFEST_LIMITS,
  DeliveryPackageStatus,
  type DeliveryManifestAddress,
  type DeliveryManifestFileKind,
  type DeliveryManifestRecord,
  type DeliveryManifestSnapshot,
} from '@pulsar/shared';
import { encodePackageBarcode } from './package-barcode';

type Doc = InstanceType<typeof PDFDocument>;
type Shipment = DeliveryManifestSnapshot['shipments'][number];
export const DELIVERY_MANIFEST_PDF_MAX_BYTES = 10 * 1024 * 1024;
const LETTER = { width: 612, height: 792, margin: 42, top: 65, bottom: 738 };
const LABEL = { width: 288, height: 432, margin: 18, inner: 252 };
const INK = '#172126';
const MUTED = '#52616a';
const VALUE_LABELS_FR = Object.freeze({
  PENDING: 'En attente',
  OPEN: 'Ouvert',
  PLANNED: 'Planifié',
  TENDERED: 'Offert',
  DISPATCHED: 'Réparti',
  IN_TRANSIT: 'En transit',
  PICKED_UP: 'Ramassé',
  PREPARED: 'Préparé',
  LOADED: 'Chargé',
  DELIVERED: 'Livré',
  RETURNED: 'Retourné',
  COMPLETED: 'Terminé',
  CLOSED: 'Clôturé',
  CANCELLED: 'Annulé',
  PICKUP: 'Ramassage',
  DELIVERY: 'Livraison',
});

/** Presentation only: never changes a captured value or guesses an unknown state. */
export function deliveryManifestValueLabel(value: string): string {
  return Object.prototype.hasOwnProperty.call(VALUE_LABELS_FR, value)
    ? VALUE_LABELS_FR[value as keyof typeof VALUE_LABELS_FR]
    : value;
}
// Exact Helvetica/WinAnsi repertoire supported by the deployed PDFKit standard font.
// No transliteration, replacement glyphs, or host-installed font fallback.
const PRINTABLE =
  /^[\r\n\x20-\x7e\u00a0-\u00ff\u0192\u02c6\u02dc\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u2013\u2014\u2018-\u201a\u201c-\u201e\u2020-\u2022\u2026\u2030\u2039\u203a\u20ac\u2122]*$/u;

function font(doc: Doc, size: number, bold = false) {
  return doc
    .font(bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(size)
    .fillColor(INK);
}

/** Word wrapping with a character fallback for arbitrarily long unbroken identifiers. */
function lines(doc: Doc, text: string, width: number, size: number, bold = false): string[] {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
  const result: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const token of paragraph.match(/\S+\s*|\s+/g) ?? ['']) {
      if (doc.widthOfString(line + token) <= width) {
        line += token;
        continue;
      }
      if (line.trim()) result.push(line.trimEnd());
      line = '';
      for (const char of token) {
        if (doc.widthOfString(line + char) > width) {
          result.push(line.trimEnd());
          line = '';
        }
        line += char;
      }
    }
    result.push(line.trimEnd());
  }
  return result;
}

function addressLines(address: DeliveryManifestAddress): string[] {
  return [
    address.name,
    address.addressLine1,
    address.addressLine2,
    [address.city, address.province, address.postalCode].filter(Boolean).join(', '),
    address.country,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
}

function checkStrings(value: unknown, path = 'document'): void {
  if (typeof value === 'string') {
    if (!PRINTABLE.test(value)) {
      throw new Error(
        `PDF non imprimable (${path}) : caractère hors alphabet latin Windows-1252 ou caractère de contrôle. Aucune substitution n'est autorisée.`,
      );
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => checkStrings(item, `${path}[${index}]`));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) checkStrings(item, `${path}.${key}`);
  }
}

interface LabelDestination {
  size: number;
  lines: { text: string; bold: boolean }[];
}

function labelDestination(doc: Doc, address: DeliveryManifestAddress): LabelDestination {
  for (const size of [11, 10, 9]) {
    const wrapped = addressLines(address).flatMap((text, index) =>
      lines(doc, text, LABEL.inner, size, index === 0).map((line) => ({
        text: line,
        bold: index === 0,
      })),
    );
    if (wrapped.length * (size + 3) <= 124) return { size, lines: wrapped };
  }
  throw new Error(
    'Destination trop longue pour une étiquette 4 x 6 pouces à 9 points. Corrigez les coordonnées avant émission ; aucune troncature.',
  );
}

/**
 * Call before persisting an issuance. Passing the full prospective record also
 * validates reason/number/date metadata. Snapshot-only validation supports preview.
 * Every non-cancelled package must remain printable as one readable 4 x 6 label.
 */
export function validateDeliveryManifestPrintable(
  input: DeliveryManifestSnapshot | DeliveryManifestRecord,
): void {
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > DELIVERY_MANIFEST_PDF_MAX_BYTES) {
    throw new Error('Document trop volumineux : limite de 10 Mio pour le rendu PDF.');
  }
  checkStrings(input);
  const snapshot = 'snapshot' in input ? input.snapshot : input;
  if (snapshot.schemaVersion !== 1) throw new Error('Version de snapshot PDF non prise en charge.');
  if (snapshot.shipments.length > DELIVERY_MANIFEST_LIMITS.shipments) {
    throw new Error('Un manifeste accepte au plus 200 expéditions.');
  }
  const packages = snapshot.shipments.flatMap((shipment) => shipment.packages);
  if (packages.length > DELIVERY_MANIFEST_LIMITS.packages) {
    throw new Error('Un manifeste accepte au plus 2000 colis.');
  }
  if (
    packages.reduce((count, item) => count + item.contents.length, 0) >
    DELIVERY_MANIFEST_LIMITS.contentLines
  ) {
    throw new Error('Un manifeste accepte au plus 5000 lignes de contenu.');
  }
  const measure = new PDFDocument({ autoFirstPage: false });
  // Measurement only: consume the tiny PDF stream instead of retaining a buffer.
  measure.resume();
  try {
    for (const shipment of snapshot.shipments) {
      const active = shipment.packages.filter(
        (item) => item.status !== DeliveryPackageStatus.CANCELLED,
      );
      if (!active.length) continue;
      labelDestination(measure, shipment.destination);
      if (
        lines(measure, shipment.shipmentNumber, LABEL.inner, 10, true).length > 2 ||
        lines(measure, snapshot.load.loadNumber, LABEL.inner, 9).length > 2
      ) {
        throw new Error(
          'Identifiant trop long pour une étiquette 4 x 6 pouces ; aucune troncature.',
        );
      }
      for (const item of active) {
        const barcode = encodePackageBarcode(item.code);
        // At least 10 mil (0.72 pt) per module, including both 10-module quiet zones.
        if (LABEL.inner / barcode.moduleCount < 0.72) {
          throw new Error(
            'Code colis trop long pour une étiquette Code 128 lisible à 10 mil ; aucune troncature.',
          );
        }
      }
    }
    if ('snapshot' in input) {
      if (!Number.isFinite(new Date(input.issuedAt).getTime()))
        throw new Error('Date d’émission PDF invalide.');
      if (
        lines(measure, `${input.number} / révision ${input.revision}`, LABEL.inner, 10, true)
          .length > 2
      ) {
        throw new Error('Numéro de manifeste trop long pour une étiquette ; aucune troncature.');
      }
    }
  } finally {
    measure.end();
  }
}

/** Pure rendering of the stored snapshot. No clock, database, URL, or network access. */
export async function renderDeliveryManifest(
  record: DeliveryManifestRecord,
  kind: DeliveryManifestFileKind,
): Promise<Buffer> {
  validateDeliveryManifestPrintable(record);
  if (kind !== 'manifest' && kind !== 'labels') throw new Error('Format de manifeste inconnu.');
  if (
    kind === 'labels' &&
    !record.snapshot.shipments.some((shipment) =>
      shipment.packages.some((item) => item.status !== DeliveryPackageStatus.CANCELLED),
    )
  ) {
    throw new Error('Aucun colis non annulé à étiqueter dans cet instantané.');
  }
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      autoFirstPage: false,
      bufferPages: true,
      size: kind === 'labels' ? [LABEL.width, LABEL.height] : 'LETTER',
      margin: 0,
      info: {
        Title: `${kind === 'manifest' ? 'Manifeste' : 'Étiquettes'} ${record.number} / ${record.revision}`,
        Author: 'Pulsar',
        Creator: 'Pulsar Delivery Manifest v1',
        CreationDate: new Date(record.issuedAt),
        ModDate: new Date(record.issuedAt),
      },
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    doc.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > DELIVERY_MANIFEST_PDF_MAX_BYTES) {
        chunks.length = 0;
        doc.destroy(new Error('PDF trop volumineux : limite de 10 Mio.'));
      } else chunks.push(chunk);
    });
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    try {
      if (kind === 'manifest') drawManifest(doc, record);
      else drawLabels(doc, record);
      doc.end();
    } catch (error) {
      doc.destroy();
      reject(error);
    }
  });
}

function drawManifest(doc: Doc, record: DeliveryManifestRecord) {
  const width = LETTER.width - LETTER.margin * 2;
  let y = LETTER.top;
  const newPage = () => {
    doc.addPage();
    font(doc, 9, true).text('PULSAR / MANIFESTE DE LIVRAISON', LETTER.margin, 27, {
      lineBreak: false,
    });
    doc
      .moveTo(LETTER.margin, 47)
      .lineTo(LETTER.width - LETTER.margin, 47)
      .lineWidth(0.5)
      .strokeColor('#aebbc2')
      .stroke();
    y = LETTER.top;
  };
  newPage();
  const ensure = (height: number) => {
    if (y + height > LETTER.bottom) newPage();
  };
  const write = (value: string, size = 10, bold = false, indent = 0, color = INK) => {
    for (const line of lines(doc, value, width - indent, size, bold)) {
      ensure(size + 4);
      font(doc, size, bold)
        .fillColor(color)
        .text(line, LETTER.margin + indent, y, { lineBreak: false });
      y += size + 4;
    }
  };
  const section = (title: string) => {
    ensure(46);
    y += 12;
    write(title, 12, true);
    y += 4;
  };
  const address = (title: string, value: DeliveryManifestAddress) => {
    ensure(32);
    write(title, 9, true, 0, MUTED);
    addressLines(value).forEach((line) => write(line, 10));
    y += 6;
  };
  const snapshot = record.snapshot;
  write(record.number, 23, true);
  write(`Révision ${record.revision} | Émis le ${record.issuedAt} (UTC)`, 10);
  write(
    `Chargement ${snapshot.load.loadNumber} | État capturé : ${deliveryManifestValueLabel(snapshot.load.status)}`,
    12,
    true,
  );
  write(
    `Source du chargement : ${snapshot.load.updatedAt} (UTC) | Schéma d'instantané : v${snapshot.schemaVersion}`,
    9,
    false,
    0,
    MUTED,
  );
  y += 8;
  write(
    'Copie figée des données opérationnelles à l’émission. Les états et dates ci-dessous sont capturés, pas des confirmations actuelles.',
    9,
  );
  write(
    'Ce manifeste n’est ni un connaissement (BOL), ni une preuve de chargement, ni une preuve de livraison (POD). Le scan identifie le colis seulement.',
    9,
  );
  write(`Motif d’émission : ${record.reason || '(non renseigné)'}`, 9);
  section('ÉQUIPEMENT ET RESPONSABLES CAPTURÉS');
  write(`Transporteur : ${snapshot.load.carrierName ?? '(non affecté)'}`);
  write(`Chauffeur : ${snapshot.load.driverName ?? '(non affecté)'}`);
  write(`Véhicule : ${snapshot.load.vehicleNumber ?? '(non affecté)'}`);
  write(`Remorque : ${snapshot.load.trailerNumber ?? '(non affectée)'}`);
  if (snapshot.stops.length) {
    section('ORDRE DES ARRÊTS CAPTURÉ');
    for (const stop of snapshot.stops)
      address(`${stop.sequence}. ${deliveryManifestValueLabel(stop.type)}`, stop.location);
  } else {
    section('ARRÊTS');
    write('Aucun arrêt capturé dans cet instantané.');
  }
  const packages = snapshot.shipments.flatMap((shipment) => shipment.packages);
  section(`${snapshot.shipments.length} EXPÉDITION(S) / ${packages.length} COLIS DÉCLARÉ(S)`);
  write(
    'Comptes par colis ; les quantités de références ou d’unités différentes ne sont pas additionnées.',
    9,
    false,
    0,
    MUTED,
  );
  if (!snapshot.shipments.length) write('Aucune expédition capturée.');
  for (const shipment of snapshot.shipments) {
    section(`EXPÉDITION ${shipment.shipmentNumber}`);
    write(
      `État capturé : ${deliveryManifestValueLabel(shipment.status)} | Suivi colis : ${shipment.trackingEnabled ? 'activé' : 'non activé'}`,
      9,
    );
    const count = (status: DeliveryPackageStatus) =>
      shipment.packages.filter((item) => item.status === status).length;
    write(
      `Préparés : ${count(DeliveryPackageStatus.PREPARED)} | Chargés : ${count(DeliveryPackageStatus.LOADED)} | Livrés : ${count(DeliveryPackageStatus.DELIVERED)} | Retournés : ${count(DeliveryPackageStatus.RETURNED)} | Annulés : ${count(DeliveryPackageStatus.CANCELLED)}`,
      9,
    );
    address('ORIGINE', shipment.origin);
    address('DESTINATION', shipment.destination);
    if (!shipment.packages.length) write('Aucun colis déclaré pour cette expédition.', 10);
    for (const item of shipment.packages) {
      ensure(70);
      y += 6;
      write(
        `${item.code} | État capturé : ${deliveryManifestValueLabel(item.status)} | Version capturée ${item.version}`,
        11,
        true,
      );
      if (item.label) write(item.label, 10);
      write(
        `Chargement enregistré : ${item.loadedAt ? `${item.loadedAt} (UTC)` : 'non enregistré'}`,
        8,
        false,
        0,
        MUTED,
      );
      write(
        `Livraison enregistrée : ${item.deliveredAt ? `${item.deliveredAt} (UTC)` : 'non enregistrée'}`,
        8,
        false,
        0,
        MUTED,
      );
      for (const [index, content] of item.contents.entries()) {
        ensure(32);
        write(
          `${index + 1}. ${content.reference} | ${content.quantity} ${content.unit}`,
          10,
          true,
          12,
        );
        write(content.description, 10, false, 12);
      }
    }
  }
  section('PROVENANCE DE CETTE COPIE');
  write(`Empreinte de l’instantané (SHA-256) : ${record.snapshotHash}`, 8);
  write(`Empreinte de la source (SHA-256) : ${record.sourceHash}`, 8);
  write(
    'Les anciennes révisions restent des copies historiques. Aucune lecture de l’état courant n’a été ajoutée à ce document.',
    9,
  );
  const pages = doc.bufferedPageRange();
  for (let page = pages.start; page < pages.start + pages.count; page++) {
    doc.switchToPage(page);
    font(doc, 8)
      .fillColor(MUTED)
      .text(
        `${record.number} / r${record.revision} - ${page + 1} / ${pages.count}`,
        LETTER.margin,
        758,
        { lineBreak: false, width },
      );
  }
}

function drawLabels(doc: Doc, record: DeliveryManifestRecord) {
  const items = record.snapshot.shipments.flatMap((shipment) =>
    shipment.packages
      .filter((item) => item.status !== DeliveryPackageStatus.CANCELLED)
      .map((item) => ({ shipment, item })),
  );
  for (const [index, { shipment, item }] of items.entries()) {
    doc.addPage();
    font(doc, 9, true).text('PULSAR / COLIS', LABEL.margin, 16, { lineBreak: false });
    const text = (value: string, y: number, size: number, bold = false) => {
      for (const [lineIndex, line] of lines(doc, value, LABEL.inner, size, bold).entries()) {
        font(doc, size, bold).text(line, LABEL.margin, y + lineIndex * (size + 3), {
          lineBreak: false,
        });
      }
    };
    text(`${record.number} / révision ${record.revision}`, 32, 10, true);
    text(shipment.shipmentNumber, 62, 10, true);
    text(record.snapshot.load.loadNumber, 92, 9);
    const barcode = encodePackageBarcode(item.code);
    const moduleWidth = Math.min(1.5, LABEL.inner / barcode.moduleCount);
    const start = (LABEL.width - barcode.moduleCount * moduleWidth) / 2;
    doc.fillColor('#000000');
    for (const bar of barcode.bars)
      doc.rect(start + bar.offset * moduleWidth, 126, bar.width * moduleWidth, 48).fill();
    font(doc, 15, true);
    const codeSize = Math.min(15, (15 * LABEL.inner) / doc.widthOfString(item.code));
    font(doc, codeSize, true).text(item.code, LABEL.margin, 180, {
      width: LABEL.inner,
      align: 'center',
      lineBreak: false,
    });
    font(doc, 8, true)
      .fillColor(MUTED)
      .text('DESTINATION CAPTURÉE', LABEL.margin, 207, { lineBreak: false });
    const destination = labelDestination(doc, shipment.destination);
    for (const [lineIndex, line] of destination.lines.entries()) {
      font(doc, destination.size, line.bold).text(
        line.text,
        LABEL.margin,
        221 + lineIndex * (destination.size + 3),
        { lineBreak: false },
      );
    }
    font(doc, 9, true).text(
      `État capturé : ${deliveryManifestValueLabel(item.status)} / v${item.version}`,
      LABEL.margin,
      352,
      {
        lineBreak: false,
      },
    );
    text(`Émis ${record.issuedAt} (UTC)`, 370, 7);
    text(`Source v1 / ${record.snapshot.load.updatedAt} (UTC)`, 382, 7);
    text(`Identification seulement - pas une preuve de livraison.`, 395, 7);
    font(doc, 7)
      .fillColor(MUTED)
      .text(`4 x 6 po / Code 128 / ${index + 1} sur ${items.length}`, LABEL.margin, 413, {
        lineBreak: false,
      });
  }
}
