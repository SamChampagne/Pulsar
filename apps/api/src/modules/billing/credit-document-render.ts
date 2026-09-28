import PDFDocument from 'pdfkit';
import type { CreditRecipientProvenance } from './credit-coordinate-source';

export interface CreditIdentities {
  issuerName: string;
  issuerAddress: string;
  issuerTaxIds: string;
  recipientName: string;
  recipientAddress: string;
}
export interface CreditDocumentSnapshot {
  version: 1;
  identities: CreditIdentities;
  recipientProvenance?: CreditRecipientProvenance;
  number: string;
  invoiceNumber: string;
  documentDate: string;
  accountingDate: string;
  currency: string;
  reason: string;
  netAmount: string;
  taxAmount: string;
  totalAmount: string;
  lines: {
    description: string;
    quantity: string;
    netAmount: string;
    taxAmount: string;
    totalAmount: string;
    taxes: { description: string; rate: string; amount: string }[];
  }[];
}

/** No database, current tax rules or network access: render only the frozen publication. */
export function renderCreditDocument(data: CreditDocumentSnapshot): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({
      size: 'A4',
      margins: { top: 48, left: 48, right: 48, bottom: 80 },
      bufferPages: true,
      info: {
        Title: `Note de crédit ${data.number}`,
        Author: data.identities.issuerName,
        CreationDate: new Date(data.documentDate),
        ModDate: new Date(data.documentDate),
      },
    });
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('error', reject);
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    const width = pdf.page.width - 96;
    const money = (amount: string) => `${Number(amount).toFixed(2)} ${data.currency}`;
    const text = (value: string, size = 10, bold = false) => {
      pdf
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(size)
        .fillColor('#1f2937');
      pdf.text(value, 48, pdf.y, { width, lineGap: 2 });
      pdf.moveDown(0.2);
    };
    const space = (height: number) => {
      if (pdf.y + height > pdf.page.height - 80) pdf.addPage();
    };
    text('NOTE DE CRÉDIT / AVOIR', 20, true);
    text(data.number, 13, true);
    text(`Facture d’origine : ${data.invoiceNumber}`);
    text(`Date du document (UTC) : ${data.documentDate.slice(0, 10)}`);
    text(`Validation comptable (UTC) : ${data.accountingDate.slice(0, 10)}`);
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
    if (data.recipientProvenance?.kind === 'INVOICE') {
      text(
        `Identité et adresse reprises de la facture d'origine, copie figée le ${data.recipientProvenance.frozenAt?.slice(0, 10)} (UTC).`,
        8,
      );
    }
    text('MOTIF', 9, true);
    text(data.reason);
    pdf.moveDown();
    for (const [index, line] of data.lines.entries()) {
      const blocks: [string, number, boolean][] = [
        [`${index + 1}. ${line.description}`, 11, true],
        [`Quantité / fraction de ligne créditée : ${line.quantity}`, 10, false],
        [`Hors taxes : ${money(line.netAmount)}    Taxes : ${money(line.taxAmount)}`, 10, false],
        ...line.taxes.map(
          (tax) =>
            [`${tax.description} (${tax.rate} %) : ${money(tax.amount)}`, 9, false] as [
              string,
              number,
              boolean,
            ],
        ),
        [`Crédit de la ligne : ${money(line.totalAmount)}`, 10, true],
      ];
      const height = blocks.reduce((total, [value, size, bold]) => {
        pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
        return (
          total +
          pdf.heightOfString(value, { width, lineGap: 2 }) +
          pdf.currentLineHeight(true) * 0.2
        );
      }, 12);
      // Keep ordinary rows together; oversized historical descriptions may span pages.
      space(Math.min(height, pdf.page.height - 128));
      for (const block of blocks) text(...block);
      pdf.moveDown(0.5);
    }
    space(110);
    text(`Total hors taxes : ${money(data.netAmount)}`, 11);
    text(`Taxes créditées : ${money(data.taxAmount)}`, 11);
    text(`TOTAL DE L’AVOIR : ${money(data.totalAmount)}`, 15, true);
    text(
      'Ce document réduit la créance. Il ne constitue ni un remboursement bancaire ni une preuve de retour physique.',
      9,
    );
    const range = pdf.bufferedPageRange();
    for (let page = range.start; page < range.start + range.count; page++) {
      pdf.switchToPage(page);
      // Draw within the reserved bottom margin without triggering an automatic new page.
      const bottom = pdf.page.margins.bottom;
      pdf.page.margins.bottom = 0;
      pdf
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#64748b')
        .text(`${data.number}  |  ${page + 1} / ${range.count}`, 48, pdf.page.height - 45, {
          width,
          lineBreak: false,
        });
      pdf.page.margins.bottom = bottom;
    }
    pdf.end();
  });
}
