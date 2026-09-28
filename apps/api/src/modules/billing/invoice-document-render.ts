import PDFDocument from 'pdfkit';
import type { CreditIdentities } from './credit-document-render';
import type { CreditRecipientProvenance } from './credit-coordinate-source';

export interface InvoiceDocumentSnapshot {
  version: 1;
  identities: CreditIdentities;
  recipientProvenance: CreditRecipientProvenance;
  number: string;
  documentDate: string;
  approvedAt: string | null;
  currency: string;
  netAmount: string;
  taxAmount: string;
  totalAmount: string;
  lines: {
    description: string;
    quantity: string | null;
    unitPrice: string | null;
    amount: string;
  }[];
  taxes: { description: string; rate: string; amount: string }[];
}

/** Render only the publication snapshot. Balances/payment status are deliberately not printed. */
export function renderInvoiceDocument(data: InvoiceDocumentSnapshot): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({
      size: 'A4',
      margins: { top: 48, left: 48, right: 48, bottom: 80 },
      bufferPages: true,
      info: {
        Title: `Facture ${data.number}`,
        Author: data.identities.issuerName,
        CreationDate: new Date(data.documentDate),
        ModDate: new Date(data.documentDate),
      },
    });
    const chunks: Buffer[] = [];
    pdf.on('data', (b: Buffer) => chunks.push(b));
    pdf.on('error', reject);
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    const width = pdf.page.width - 96;
    const text = (s: string, size = 10, bold = false) => {
      pdf
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(size)
        .fillColor('#1f2937');
      pdf.text(s, 48, pdf.y, { width, lineGap: 2 });
      pdf.moveDown(0.2);
    };
    const space = (height: number) => {
      if (pdf.y + height > pdf.page.height - 80) pdf.addPage();
    };
    const money = (s: string) => `${s} ${data.currency}`;
    text('FACTURE CLIENT', 20, true);
    text(data.number, 13, true);
    text(`Publication du document (UTC) : ${data.documentDate.slice(0, 10)}`);
    text(
      `Approbation de la facture (UTC) : ${data.approvedAt?.slice(0, 10) ?? 'date historique non enregistrée'}`,
    );
    pdf.moveDown();
    text('ÉMETTEUR', 9, true);
    text(
      [data.identities.issuerName, data.identities.issuerAddress, data.identities.issuerTaxIds]
        .filter(Boolean)
        .join('\n'),
    );
    text('CLIENT', 9, true);
    text(
      [data.identities.recipientName, data.identities.recipientAddress].filter(Boolean).join('\n'),
    );
    if (data.recipientProvenance.kind === 'INVOICE')
      text(
        `Identité et adresse capturées à l'approbation, copie figée le ${data.recipientProvenance.frozenAt!.slice(0, 10)} (UTC).`,
        8,
      );
    pdf.moveDown();
    for (const [i, line] of data.lines.entries()) {
      pdf.font('Helvetica-Bold').fontSize(11);
      space(Math.min(pdf.heightOfString(line.description, { width }) + 75, pdf.page.height - 128));
      text(`${i + 1}. ${line.description}`, 11, true);
      if (line.quantity !== null) text(`Quantité : ${line.quantity}`);
      text(`Montant hors taxes : ${money(line.amount)}`, 10, true);
      pdf.moveDown(0.4);
    }
    space(110);
    text(`Total hors taxes : ${money(data.netAmount)}`, 11);
    for (const tax of data.taxes) {
      space(25);
      text(`${tax.description} (${tax.rate} %) : ${money(tax.amount)}`);
    }
    space(100);
    text(`Taxes : ${money(data.taxAmount)}`, 11);
    text(`TOTAL DE LA FACTURE : ${money(data.totalAmount)}`, 15, true);
    text(
      'Montants approuvés. Ce document ne constitue pas une preuve de paiement. Les encaissements et avoirs sont suivis séparément.',
      9,
    );
    const range = pdf.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      pdf.switchToPage(i);
      const bottom = pdf.page.margins.bottom;
      pdf.page.margins.bottom = 0;
      pdf
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#64748b')
        .text(`${data.number}  |  ${i + 1} / ${range.count}`, 48, pdf.page.height - 45, {
          width,
          lineBreak: false,
        });
      pdf.page.margins.bottom = bottom;
    }
    pdf.end();
  });
}
