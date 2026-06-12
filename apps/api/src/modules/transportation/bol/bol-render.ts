import PDFDocument from 'pdfkit';
import type { BolData, BolLine } from './bol-data';

type Doc = InstanceType<typeof PDFDocument>;

const MARGIN = 40;
const PAGE_WIDTH = 612; // LETTER width in points
const INNER_WIDTH = PAGE_WIDTH - MARGIN * 2;

/**
 * Render a Bill of Lading PDF from the structured BolData.
 * Returns a Buffer — pure function over the data.
 */
export function renderBol(data: BolData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: MARGIN });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      drawDocument(doc, data);
    } catch (err) {
      reject(err);
    } finally {
      doc.end();
    }
  });
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

function hline(doc: Doc, y: number) {
  doc.moveTo(MARGIN, y).lineTo(MARGIN + INNER_WIDTH, y).stroke();
}

function box(doc: Doc, x: number, y: number, w: number, h: number) {
  doc.rect(x, y, w, h).stroke();
}

function label(doc: Doc, text: string, x: number, y: number) {
  doc.fontSize(7).fillColor('#555').text(text, x, y);
}

function value(doc: Doc, text: string, x: number, y: number) {
  doc.fontSize(9).fillColor('#000').text(text, x, y);
}

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

function drawDocument(doc: Doc, data: BolData) {
  let y = MARGIN;

  // ── Header band ──────────────────────────────────────────────────────────
  doc.fontSize(18).fillColor('#000').font('Helvetica-Bold')
    .text('BILL OF LADING', MARGIN, y, { width: INNER_WIDTH, align: 'center' });
  y += 24;

  doc.fontSize(9).font('Helvetica')
    .fillColor('#333')
    .text(`BOL #: ${data.bolNumber}`, MARGIN, y)
    .text(
      `Date: ${data.generatedAt.toLocaleDateString('en-CA')}`,
      MARGIN + INNER_WIDTH / 2,
      y,
      { align: 'right', width: INNER_WIDTH / 2 },
    );
  y += 16;
  hline(doc, y);
  y += 8;

  // ── Shipper / Consignee two-column ────────────────────────────────────────
  const colW = (INNER_WIDTH - 12) / 2;
  const boxH = 70;

  box(doc, MARGIN, y, colW, boxH);
  box(doc, MARGIN + colW + 12, y, colW, boxH);

  label(doc, 'SHIPPER', MARGIN + 4, y + 4);
  if (data.shipper) {
    value(doc, data.shipper.name, MARGIN + 4, y + 16);
    value(doc, data.shipper.address, MARGIN + 4, y + 28);
    value(doc, data.shipper.city, MARGIN + 4, y + 40);
  }

  const cx = MARGIN + colW + 16;
  label(doc, 'CONSIGNEE', cx, y + 4);
  if (data.consignee) {
    value(doc, data.consignee.name, cx, y + 16);
    value(doc, data.consignee.address, cx, y + 28);
    value(doc, data.consignee.city, cx, y + 40);
  }

  y += boxH + 10;

  // ── Carrier / Driver / Equipment line ────────────────────────────────────
  doc.fontSize(8).fillColor('#555').font('Helvetica')
    .text('CARRIER:', MARGIN, y)
    .text('DRIVER:', MARGIN + 140, y)
    .text('VEHICLE:', MARGIN + 290, y)
    .text('TRAILER:', MARGIN + 400, y);
  y += 10;

  doc.fontSize(9).fillColor('#000').font('Helvetica-Bold')
    .text(data.carrier?.name ?? '—', MARGIN, y, { width: 130 })
    .text(
      data.carrier?.scac ? `(${data.carrier.scac})` : '',
      MARGIN,
      y + 10,
      { width: 130 },
    );

  doc.font('Helvetica')
    .text(data.driverName ?? '—', MARGIN + 140, y, { width: 140 })
    .text(data.equipment.vehicle ?? '—', MARGIN + 290, y, { width: 100 })
    .text(data.equipment.trailer ?? '—', MARGIN + 400, y, { width: 100 });

  y += 30;
  hline(doc, y);
  y += 8;

  // ── Shipment lines table ─────────────────────────────────────────────────
  const colX = {
    shipment: MARGIN,
    order: MARGIN + 110,
    ref: MARGIN + 230,
    weight: MARGIN + 340,
    pallets: MARGIN + 430,
  };

  // Table header
  doc.fontSize(8).fillColor('#555').font('Helvetica-Bold');
  doc.text('SHIPMENT #', colX.shipment, y, { width: 105 });
  doc.text('ORDER #', colX.order, y, { width: 95 });
  doc.text('REFERENCE', colX.ref, y, { width: 100 });
  doc.text('WEIGHT (kg)', colX.weight, y, { width: 85 });
  doc.text('PALLETS', colX.pallets, y, { width: 80 });
  y += 12;
  hline(doc, y);
  y += 4;

  // Data rows
  doc.font('Helvetica').fillColor('#000').fontSize(9);
  for (const line of data.lines) {
    drawLine(doc, line, colX, y);
    y += 14;
  }

  // Totals row
  y += 4;
  hline(doc, y);
  y += 6;
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#000');
  doc.text('TOTALS', colX.shipment, y, { width: 320 });
  doc.text(String(data.totals.weightKg), colX.weight, y, { width: 85 });
  doc.text(String(data.totals.units), colX.pallets, y, { width: 80 });
  y += 20;
  hline(doc, y);
  y += 12;

  // ── Notes ─────────────────────────────────────────────────────────────────
  if (data.notes) {
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#555').text('NOTES:', MARGIN, y);
    y += 11;
    doc.fontSize(9).font('Helvetica').fillColor('#000').text(data.notes, MARGIN, y, {
      width: INNER_WIDTH,
    });
    y += doc.heightOfString(data.notes, { width: INNER_WIDTH }) + 8;
  }

  y += 8;

  // ── Signature blocks ──────────────────────────────────────────────────────
  const sigW = 160;
  const sigH = 70;
  const sigGap = (INNER_WIDTH - sigW * 3) / 2;
  const sigPositions = [
    { x: MARGIN, label: 'Shipper signature' },
    { x: MARGIN + sigW + sigGap, label: 'Driver signature\nReceived at pickup' },
    { x: MARGIN + (sigW + sigGap) * 2, label: 'Consignee signature\nReceived at delivery' },
  ];

  for (const sig of sigPositions) {
    box(doc, sig.x, y, sigW, sigH);
    doc.fontSize(7).fillColor('#555').font('Helvetica')
      .text(sig.label, sig.x + 4, y + 4, { width: sigW - 8 });
    // Blank signature line
    doc.moveTo(sig.x + 8, y + 48).lineTo(sig.x + sigW - 8, y + 48).stroke();
    doc.fontSize(7).fillColor('#888').text('Signature', sig.x + 8, y + 50, { width: 60 });
    // Date line
    doc.moveTo(sig.x + 8, y + 62).lineTo(sig.x + sigW - 8, y + 62).stroke();
    doc.fontSize(7).fillColor('#888').text('Date', sig.x + 8, y + 64, { width: 40 });
  }

  // Exceptions/damages lines under consignee block
  const lastSig = sigPositions[2];
  const excY = y + sigH + 8;
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#555')
    .text('Exceptions / damages noted:', lastSig.x, excY, { width: sigW });
  doc.moveTo(lastSig.x, excY + 14).lineTo(lastSig.x + sigW, excY + 14).stroke();
  doc.moveTo(lastSig.x, excY + 26).lineTo(lastSig.x + sigW, excY + 26).stroke();

  y += sigH + 50;

  // ── Footer — conditions ───────────────────────────────────────────────────
  hline(doc, y);
  y += 6;
  doc.fontSize(7).fillColor('#555').font('Helvetica-Oblique').text(data.conditions, MARGIN, y, {
    width: INNER_WIDTH,
    align: 'center',
  });
}

function drawLine(
  doc: Doc,
  line: BolLine,
  colX: Record<string, number>,
  y: number,
) {
  doc.text(line.shipmentNumber, colX.shipment, y, { width: 105 });
  doc.text(line.orderNumber, colX.order, y, { width: 95 });
  doc.text(line.customerReference ?? '—', colX.ref, y, { width: 100 });
  doc.text(line.weightKg != null ? String(line.weightKg) : '—', colX.weight, y, {
    width: 85,
  });
  doc.text(line.palletCount != null ? String(line.palletCount) : '—', colX.pallets, y, {
    width: 80,
  });
}
