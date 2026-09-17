import { Reflector } from '@nestjs/core';
import { PortalController } from './portal-controller.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';

describe('@PortalController', () => {
  it('applies both the public metadata and the PortalGuard', () => {
    @PortalController()
    class Dummy {}

    const reflector = new Reflector();
    expect(reflector.get(IS_PUBLIC_KEY, Dummy)).toBe(true);
    const guards = Reflect.getMetadata('__guards__', Dummy);
    expect(guards?.some((g: unknown) => (g as { name?: string }).name === 'PortalGuard')).toBe(
      true,
    );
  });
});
