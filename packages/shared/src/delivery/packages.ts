/** Physical delivery units, distinct from catalogue packaging definitions and WMS stock. */
export enum DeliveryPackageStatus {
  PREPARED = 'PREPARED',
  LOADED = 'LOADED',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  RETURNED = 'RETURNED',
}

const transitions: Record<DeliveryPackageStatus, readonly DeliveryPackageStatus[]> = {
  PREPARED: [DeliveryPackageStatus.LOADED, DeliveryPackageStatus.CANCELLED],
  LOADED: [
    DeliveryPackageStatus.PREPARED,
    DeliveryPackageStatus.DELIVERED,
    DeliveryPackageStatus.RETURNED,
  ],
  DELIVERED: [DeliveryPackageStatus.RETURNED],
  CANCELLED: [],
  RETURNED: [],
};

/** Unloading additionally requires the current load/mission guards in the business service. */
export function canTransitionDeliveryPackage(
  from: DeliveryPackageStatus,
  to: DeliveryPackageStatus,
): boolean {
  return Object.prototype.hasOwnProperty.call(transitions, from) && transitions[from].includes(to);
}

export interface DeliveryPackageContent {
  reference: string;
  description: string;
  /** Positive exact decimal in base units; never parsed as a floating-point number. */
  quantity: string;
  unit: string;
}

function text(value: unknown, name: string, maximum: number, minimum = 1): string {
  if (typeof value !== 'string') throw new Error(`${name} doit être un texte.`);
  const result = value.trim();
  if (result.length < minimum || result.length > maximum)
    throw new Error(`${name} doit contenir entre ${minimum} et ${maximum} caractères.`);
  if (/[\u0000-\u001f\u007f]/u.test(result))
    throw new Error(`${name} contient des caractères de contrôle.`);
  return result;
}

export function normalizeDeliveryPackageLabel(value: unknown): string {
  return text(value, 'Le libellé du colis', 120, 0);
}

/** Maximum 12 integral digits and 3 fractional digits. No rounding or unit conversion. */
export function normalizeDeliveryPackageQuantity(value: unknown): string {
  if (typeof value !== 'string') throw new Error('La quantité doit être un texte décimal exact.');
  const input = value.trim();
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,3})?$/.test(input))
    throw new Error('Quantité invalide : au plus 12 chiffres entiers et 3 décimales.');
  const [whole, fraction = ''] = input.split('.');
  const scaled = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  if (scaled <= 0n) throw new Error('La quantité doit être strictement positive.');
  const canonicalFraction = fraction.replace(/0+$/, '');
  return `${whole}${canonicalFraction ? `.${canonicalFraction}` : ''}`;
}

/** Closed payload: unknown fields are rejected rather than silently discarded. */
export function validateDeliveryPackageContents(value: unknown): DeliveryPackageContent[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50)
    throw new Error('Un colis doit contenir entre 1 et 50 lignes.');
  return Array.from(value, (line, index) => {
    if (
      !line ||
      typeof line !== 'object' ||
      Array.isArray(line) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(line))
    )
      throw new Error(`Ligne ${index + 1} invalide.`);
    const record = line as Record<string, unknown>;
    const keys = Reflect.ownKeys(record);
    if (
      keys.length !== 4 ||
      keys.some(
        (key) =>
          typeof key !== 'string' ||
          !['reference', 'description', 'quantity', 'unit'].includes(key),
      )
    )
      throw new Error(`Ligne ${index + 1} : référence, description, quantité et unité requises.`);
    return {
      reference: text(record.reference, 'La référence', 80),
      description: text(record.description, 'La description', 200),
      quantity: normalizeDeliveryPackageQuantity(record.quantity),
      unit: text(record.unit, "L'unité", 20),
    };
  });
}

export interface DeliveryPackageCounts {
  total: number;
  active: number;
  prepared: number;
  loaded: number;
  delivered: number;
  cancelled: number;
  returned: number;
}

/** Counts physical units only; never adds quantities of different references or units. */
export function deriveDeliveryPackageCounts(
  packages: readonly { status: DeliveryPackageStatus }[],
): DeliveryPackageCounts {
  const counts: DeliveryPackageCounts = {
    total: packages.length,
    active: 0,
    prepared: 0,
    loaded: 0,
    delivered: 0,
    cancelled: 0,
    returned: 0,
  };
  for (const item of packages) {
    switch (item.status) {
      case DeliveryPackageStatus.PREPARED:
        counts.prepared++;
        break;
      case DeliveryPackageStatus.LOADED:
        counts.loaded++;
        break;
      case DeliveryPackageStatus.DELIVERED:
        counts.delivered++;
        break;
      case DeliveryPackageStatus.CANCELLED:
        counts.cancelled++;
        break;
      case DeliveryPackageStatus.RETURNED:
        counts.returned++;
        break;
      default:
        throw new Error('Statut de colis inconnu.');
    }
  }
  counts.active = counts.prepared + counts.loaded + counts.delivered + counts.returned;
  return counts;
}

/** Internal authenticated view. Public tracking needs its own restricted projection. */
export interface DeliveryPackageView {
  id: string;
  shipmentId: string;
  code: string;
  label: string;
  status: DeliveryPackageStatus;
  contents: DeliveryPackageContent[];
  version: number;
  loadedLoadId: string | null;
  loadedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}
