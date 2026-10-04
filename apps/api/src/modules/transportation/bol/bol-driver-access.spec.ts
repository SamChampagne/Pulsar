import { BolService } from './bol.service';
import { DriverAccessService } from '../public/driver-access.service';

describe('Driver BOL access', () => {
  it('never serves historical generic PDFs that may contain private load notes', async () => {
    const prisma = { document: { findFirst: jest.fn() } },
      documents = { download: jest.fn() };
    const access = {
      resolve: jest.fn(async () => ({ status: 'IN_TRANSIT' })),
      assertMutable: jest.fn(),
    };
    const service = new BolService(
      prisma as any,
      {} as any,
      documents as any,
      {} as any,
      access as any,
    );
    await expect(service.driverBol('token')).rejects.toThrow(
      'not been qualified for external sharing',
    );
    expect(access.resolve).toHaveBeenCalledWith('token');
    expect(access.assertMutable).toHaveBeenCalledWith('IN_TRANSIT');
    expect(prisma.document.findFirst).not.toHaveBeenCalled();
    expect(documents.download).not.toHaveBeenCalled();
  });
  it('rejects closed-load BOL access before resolving any document', async () => {
    const guard = new DriverAccessService({} as any);
    const access = {
      resolve: jest.fn(async () => ({ status: 'COMPLETED' })),
      assertMutable: (status: string) => guard.assertMutable(status),
    };
    const service = new BolService({} as any, {} as any, {} as any, {} as any, access as any);
    await expect(service.driverBol('token')).rejects.toThrow('closed');
  });
});
