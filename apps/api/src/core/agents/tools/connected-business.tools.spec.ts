import { RiskTier, PERMISSIONS } from '@pulsar/shared';
import { connectedBusinessTools } from './connected-business.tools';
describe('Connected business agent tools', () => {
  it('exposes only two guarded mutations, no HR decisions or invoice writes', () => {
    expect(
      connectedBusinessTools.filter((t) => t.tier === RiskTier.MUTATING).map((t) => t.name),
    ).toEqual(['services_schedule_job', 'support_set_followup']);
    expect(
      connectedBusinessTools.find((t) => t.name === 'services_billable_context')
        ?.additionalPermissions,
    ).toContain(PERMISSIONS.BILLING.CUSTOMER_INVOICES_READ);
    expect(
      connectedBusinessTools.find((t) => t.name === 'services_schedule_job')?.additionalPermissions,
    ).toContain(PERMISSIONS.HR.AVAILABILITY_READ);
  });
  it('requires a bounded duration and source version', () => {
    const schema = connectedBusinessTools.find(
      (t) => t.name === 'services_schedule_job',
    )!.inputSchema;
    expect(
      schema.safeParse({
        jobId: 'job',
        assigneeUserId: 'user',
        plannedMinutes: 0,
        localStart: '2026-09-22T09:00',
      }).success,
    ).toBe(false);
  });
  it('passes the principal to existing services, never a request tenant', async () => {
    const planning = jest.fn().mockResolvedValue({});
    const principal = { user: { id: 'service-user', tenantId: 'tenant' } };
    await connectedBusinessTools
      .find((t) => t.name === 'services_planning')!
      .run({ date: '2026-09-22' }, {
        principal,
        services: { connectedBusiness: { planning } },
      } as never);
    expect(planning).toHaveBeenCalledWith(principal.user, { date: '2026-09-22' });
  });
});
