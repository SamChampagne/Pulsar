import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { PlatformController } from './platform-controller.decorator';

describe('@PlatformController', () => {
  it('applies both the public metadata and the PlatformGuard', () => {
    @PlatformController()
    class Dummy {}

    const reflector = new Reflector();
    expect(reflector.get(IS_PUBLIC_KEY, Dummy)).toBe(true);
    const guards = Reflect.getMetadata('__guards__', Dummy);
    expect(
      guards?.some(
        (g: unknown) => (g as { name?: string }).name === 'PlatformGuard',
      ),
    ).toBe(true);
  });
});
