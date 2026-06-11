import { groupByCurrency } from './customer-invoices.service';

describe('groupByCurrency', () => {
  it('one group per currency, order preserved', () => {
    const groups = groupByCurrency([
      { orderId: '1', orderNumber: 'TO-1', amount: 100, currency: 'CAD', snapshot: {} },
      { orderId: '2', orderNumber: 'TO-2', amount: 200, currency: 'USD', snapshot: {} },
      { orderId: '3', orderNumber: 'TO-3', amount: 300, currency: 'CAD', snapshot: {} },
    ]);
    expect([...groups.keys()]).toEqual(['CAD', 'USD']);
    expect(groups.get('CAD')!.map((r) => r.orderId)).toEqual(['1', '3']);
  });
});
