import { createHash } from 'node:crypto';
import { validateDirectoryEntry, type DocumentCoordinates } from '@pulsar/shared';

export interface CreditRecipientProvenance {
  kind: 'INVOICE' | 'MANUAL';
  invoiceId?: string;
  coordinatesHash?: string;
  frozenAt?: string;
  addressVersion?: number;
  addressEntryId?: string;
  contactEmail?: string;
  reason?: string;
}

/** Project only the bill-to identity. Never publish directory notes, delivery addresses or phones. */
export function invoiceCreditRecipient(invoiceId: string, customerId: string, raw: unknown) {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as DocumentCoordinates;
  const address = c.entries?.billingAddress;
  if (
    c.schemaVersion !== 1 ||
    c.owner?.kind !== 'customer' ||
    c.owner.id !== customerId ||
    typeof c.owner.name !== 'string' ||
    !c.owner.name.trim() ||
    typeof c.frozenAt !== 'string' ||
    !c.frozenAt ||
    !Number.isFinite(Date.parse(c.frozenAt)) ||
    !address ||
    typeof address.id !== 'string' ||
    !Number.isInteger(address.version) ||
    address.version < 1 ||
    validateDirectoryEntry(address.data).errors.length ||
    address.data.kind !== 'ADDRESS' ||
    !address.data.address
  )
    return null;
  const a = address.data.address;
  const recipientAddress = [
    a.line1,
    a.line2,
    [a.city, a.region, a.postalCode].filter(Boolean).join(', '),
    a.countryCode,
  ]
    .filter(Boolean)
    .join('\n');
  const projection = {
    invoiceId,
    customerId,
    recipientName: c.owner.name,
    recipientAddress,
    frozenAt: c.frozenAt,
    addressEntryId: address.id,
    addressVersion: address.version,
  };
  const contact = c.entries?.contact;
  const contactEmail =
    contact?.data?.kind === 'CONTACT' && !validateDirectoryEntry(contact.data).errors.length
      ? contact.data.email
      : '';
  const coordinatesHash = createHash('sha256')
    .update(JSON.stringify({ ...projection, contactEmail }))
    .digest('hex');
  return { ...projection, coordinatesHash, contactEmail };
}
