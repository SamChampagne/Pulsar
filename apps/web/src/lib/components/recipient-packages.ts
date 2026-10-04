/** Recipient-only projection: deliberately no internal IDs, labels, contents or free text. */
export interface RecipientPackageTracking {
  enabled: boolean;
  counts: {
    total: number;
    active: number;
    prepared: number;
    loaded: number;
    delivered: number;
    cancelled: number;
    returned: number;
  } | null;
  packages: {
    code: string;
    status: string;
    loadedAt: string | null;
    deliveredAt: string | null;
  }[];
}
