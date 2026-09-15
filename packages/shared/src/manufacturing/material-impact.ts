/** Advisory allocation, never a reservation or a replacement for the APS solver.
 * Exact 9dp arithmetic; earlier due dates have priority, then stable order id. */
export function deriveMaterialImpact(input: {
  today: string;
  stocks: { itemId: string; quantity: string }[];
  arrivals: { id: string; itemId: string; quantity: string; expectedDate: string }[];
  orders: {
    id: string;
    dueDate: string;
    targetDate: string;
    components: { itemId: string; quantity: string }[];
  }[];
}) {
  const scale = 1_000_000_000n;
  const number = (v: string) => {
    if (!/^\d+(\.\d{1,9})?$/.test(v)) throw new Error('Invalid material quantity');
    const [whole, fraction = ''] = v.split('.');
    return BigInt(whole) * scale + BigInt(fraction.padEnd(9, '0'));
  };
  const string = (v: bigint) =>
    `${v / scale}.${String(v % scale).padStart(9, '0')}`.replace(/\.?0+$/, '');
  const pools = new Map<string, { id: string | null; date: string; qty: bigint }[]>();
  for (const stock of input.stocks) {
    const rows = pools.get(stock.itemId) ?? [];
    rows.push({ id: null, date: input.today, qty: number(stock.quantity) });
    pools.set(stock.itemId, rows);
  }
  for (const arrival of [...input.arrivals].sort(
    (a, b) => a.expectedDate.localeCompare(b.expectedDate) || a.id.localeCompare(b.id),
  )) {
    // A missed promise is not physical inventory or a trustworthy future supply.
    if (arrival.expectedDate < input.today) continue;
    const rows = pools.get(arrival.itemId) ?? [];
    rows.push({ id: arrival.id, date: arrival.expectedDate, qty: number(arrival.quantity) });
    pools.set(arrival.itemId, rows);
  }
  return [...input.orders]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id))
    .map((order) => {
      let readyDate = input.today;
      const components = order.components.map((line) => {
        let needed = number(line.quantity);
        const sources: { purchaseId: string | null; date: string; quantity: string }[] = [];
        for (const lot of pools.get(line.itemId) ?? []) {
          const taken = lot.qty < needed ? lot.qty : needed;
          if (taken <= 0n) continue;
          lot.qty -= taken;
          needed -= taken;
          if (lot.date > readyDate) readyDate = lot.date;
          sources.push({ purchaseId: lot.id, date: lot.date, quantity: string(taken) });
        }
        return { ...line, shortage: string(needed), sources };
      });
      const shortage = components.some((c) => c.shortage !== '0');
      return {
        id: order.id,
        readyDate: shortage ? null : readyDate,
        state: shortage ? 'SHORTAGE' : readyDate > input.today ? 'WAITING' : 'READY',
        targetDate: order.targetDate,
        delayDays: shortage
          ? null
          : Math.max(
              0,
              Math.round((Date.parse(readyDate) - Date.parse(order.targetDate)) / 86400000),
            ),
        components,
      };
    });
}
