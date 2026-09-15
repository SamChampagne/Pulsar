export const WMS_BIN_LABELS: Record<string, string> = {
  RECEIVING: 'Réception',
  STORAGE: 'Stockage',
  SHIPPING: 'Expédition',
};
export interface WmsSite {
  id: string;
  code: string;
  name: string;
  type: 'WAREHOUSE';
}
export interface WmsVisualBin {
  id: string;
  code: string;
  zone: string | null;
  kind: string;
  isActive: boolean;
  stockedItems: number;
  negativeItems: number;
}
export interface WmsWorkDocument {
  id: string;
  number: string;
  status: string;
  reference: string | null;
  createdAt: string;
  lineCount: number;
}
export interface WmsWorkspace {
  site: WmsSite;
  generatedAt: string;
  bins: { items: WmsVisualBin[]; total: number; page: number; pageSize: number };
  summary: {
    bins: number;
    stockedBins: number;
    inactiveBins: number;
    negativeLevels: number;
    cycleCounts: number;
  };
  receiving: { items: WmsWorkDocument[]; total: number };
  putaway: { items: WmsVisualBin[]; total: number };
  picking: { items: WmsWorkDocument[]; total: number };
  finishing: { items: WmsWorkDocument[]; total: number };
}
export interface WmsBinDetail {
  bin: WmsVisualBin & { locationId: string; updatedAt: string };
  levels: {
    items: {
      itemId: string;
      sku: string;
      name: string;
      unit: string;
      isActive: boolean;
      qtyOnHand: string;
    }[];
    total: number;
    page: number;
    pageSize: number;
  };
}
/** Schematic grouping, not physical coordinates or warehouse capacity. */
export function groupWmsBins(bins: WmsVisualBin[]) {
  const groups = new Map<
    string,
    { key: string; label: string; kind: string; bins: WmsVisualBin[] }
  >();
  for (const bin of bins) {
    const label = bin.zone?.trim() || 'Sans zone';
    const key = JSON.stringify([bin.kind, label]);
    if (!groups.has(key)) groups.set(key, { key, label, kind: bin.kind, bins: [] });
    groups.get(key)!.bins.push(bin);
  }
  const rank = ['RECEIVING', 'STORAGE', 'SHIPPING'];
  return [...groups.values()].sort(
    (a, b) => rank.indexOf(a.kind) - rank.indexOf(b.kind) || a.label.localeCompare(b.label, 'fr'),
  );
}
