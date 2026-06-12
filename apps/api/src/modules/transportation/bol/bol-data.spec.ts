import { buildBolData } from './bol-data';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const location1 = {
  name: 'Acme Warehouse',
  addressLine1: '100 Industrial Blvd',
  city: 'Montreal',
};

const location2 = {
  name: 'Client Distribution',
  addressLine1: '200 Commerce St',
  city: 'Toronto',
};

const makeLoad = () => ({
  carrier: { name: 'Fast Freight Inc', scac: 'FFRT' },
  driver: { firstName: 'Alice', lastName: 'Tremblay' },
  vehicle: { unitNumber: 'T-101' },
  trailer: { unitNumber: 'TR-202' },
  notes: 'Handle with care',
  route: {
    stops: [
      {
        sequence: 1,
        type: 'PICKUP',
        location: location1,
      },
      {
        sequence: 2,
        type: 'DELIVERY',
        location: location2,
      },
    ],
  },
  shipments: [
    {
      shipmentNumber: 'SH-000001',
      weightKg: 500,
      palletCount: 10,
      originLocation: null,
      destinationLocation: null,
      transportOrder: {
        orderNumber: 'TO-000001',
        customerReference: 'REF-ABC',
      },
    },
    {
      shipmentNumber: 'SH-000002',
      weightKg: 250,
      palletCount: 5,
      originLocation: null,
      destinationLocation: null,
      transportOrder: {
        orderNumber: 'TO-000002',
        customerReference: null,
      },
    },
  ],
});

// ---------------------------------------------------------------------------
// Suite 1: full load with route stops
// ---------------------------------------------------------------------------

describe('buildBolData — with route stops', () => {
  const fixture = makeLoad();
  const result = buildBolData(fixture, 'BOL-000001');

  it('carries the BOL number', () => {
    expect(result.bolNumber).toBe('BOL-000001');
  });

  it('sets generatedAt to a recent Date', () => {
    expect(result.generatedAt).toBeInstanceOf(Date);
    expect(Date.now() - result.generatedAt.getTime()).toBeLessThan(5000);
  });

  it('maps carrier name and scac', () => {
    expect(result.carrier).toEqual({ name: 'Fast Freight Inc', scac: 'FFRT' });
  });

  it('builds driverName as "First Last"', () => {
    expect(result.driverName).toBe('Alice Tremblay');
  });

  it('maps vehicle and trailer unit numbers', () => {
    expect(result.equipment).toEqual({ vehicle: 'T-101', trailer: 'TR-202' });
  });

  it('derives shipper from the first PICKUP stop location', () => {
    expect(result.shipper).toEqual({
      name: 'Acme Warehouse',
      address: '100 Industrial Blvd',
      city: 'Montreal',
    });
  });

  it('derives consignee from the last DELIVERY stop location', () => {
    expect(result.consignee).toEqual({
      name: 'Client Distribution',
      address: '200 Commerce St',
      city: 'Toronto',
    });
  });

  it('builds one BolLine per shipment with all fields', () => {
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toEqual({
      shipmentNumber: 'SH-000001',
      orderNumber: 'TO-000001',
      customerReference: 'REF-ABC',
      weightKg: 500,
      palletCount: 10,
    });
    expect(result.lines[1]).toEqual({
      shipmentNumber: 'SH-000002',
      orderNumber: 'TO-000002',
      customerReference: null,
      weightKg: 250,
      palletCount: 5,
    });
  });

  it('computes totals as sum of all shipments', () => {
    expect(result.totals).toEqual({ weightKg: 750, units: 15 });
  });

  it('passes notes through', () => {
    expect(result.notes).toBe('Handle with care');
  });

  it('includes the standard conditions sentence', () => {
    expect(result.conditions).toContain('Received in apparent good order');
  });
});

// ---------------------------------------------------------------------------
// Suite 2: load WITHOUT route — falls back to shipment origin/destination
// ---------------------------------------------------------------------------

describe('buildBolData — no route (fallback to shipment locations)', () => {
  const fixture = {
    carrier: null,
    driver: null,
    vehicle: null,
    trailer: null,
    notes: null,
    route: null,
    shipments: [
      {
        shipmentNumber: 'SH-000003',
        weightKg: 100,
        palletCount: 2,
        originLocation: {
          name: 'Origin Depot',
          addressLine1: '1 Start Ave',
          city: 'Quebec City',
        },
        destinationLocation: {
          name: 'End Warehouse',
          addressLine1: '9 Final Rd',
          city: 'Ottawa',
        },
        transportOrder: {
          orderNumber: 'TO-000003',
          customerReference: null,
        },
      },
    ],
  };

  const result = buildBolData(fixture, 'BOL-000002');

  it('falls back shipper to first shipment originLocation', () => {
    expect(result.shipper).toEqual({
      name: 'Origin Depot',
      address: '1 Start Ave',
      city: 'Quebec City',
    });
  });

  it('falls back consignee to first shipment destinationLocation', () => {
    expect(result.consignee).toEqual({
      name: 'End Warehouse',
      address: '9 Final Rd',
      city: 'Ottawa',
    });
  });

  it('returns null carrier, driverName and equipment when not set', () => {
    expect(result.carrier).toBeNull();
    expect(result.driverName).toBeNull();
    expect(result.equipment).toEqual({ vehicle: null, trailer: null });
  });

  it('totals for single shipment', () => {
    expect(result.totals).toEqual({ weightKg: 100, units: 2 });
  });
});
