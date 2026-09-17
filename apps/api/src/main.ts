import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { assertProductionSecrets } from './common/boot-checks';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';

/**
 * Resolves the CORS origin option from env.
 *
 * `CORS_ORIGINS` (comma-separated allowlist) is the production-grade knob: when
 * set, ONLY those origins are allowed — `*` in the list means allow-all, used
 * deliberately (e.g. a fully public read API), never as an accidental default.
 * When unset, we keep the pre-existing dev behavior (`API_CORS_ORIGIN`, single
 * origin, defaulting to the local web dev server) so nothing already relying on
 * it regresses.
 */
function resolveCorsOrigin(config: ConfigService): boolean | string | string[] {
  const raw = config.get<string>('CORS_ORIGINS');
  if (raw && raw.trim().length > 0) {
    const origins = raw
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    if (origins.includes('*')) return true;
    return origins;
  }
  return config.get<string>('API_CORS_ORIGIN', 'http://localhost:5173');
}

async function bootstrap() {
  assertProductionSecrets(process.env);
  // rawBody: keeps the exact request bytes on `req.rawBody` so the inbound
  // webhook receiver can verify an HMAC signature over what was really sent
  // (a re-serialized body would change key order and whitespace). Additive:
  // the normal parsed `req.body` is untouched for every other route.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);

  app.use(requestIdMiddleware);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.enableCors({
    origin: resolveCorsOrigin(config),
    credentials: true,
  });
  // Let Nest run OnModuleDestroy/OnApplicationShutdown hooks on SIGTERM/SIGINT
  // (container orchestrators send SIGTERM on scale-down/redeploy) so spawned
  // child processes (Hermes agent runtime, APS engine) are terminated instead
  // of leaking as zombies.
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Pulsar API')
    .setDescription('Modular logistics platform — REST API')
    .setVersion('0.1.0')
    .addBearerAuth()
    // Machine-to-machine auth: JwtAuthGuard accepts X-Api-Key in place of a
    // bearer token (see ApiKeysService.validate) — documented as its own scheme
    // rather than folded into addBearerAuth so Swagger UI offers both.
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'api-key')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  const port = config.get<number>('API_PORT', 3000);
  await app.listen(port);
  console.log(`Pulsar API ready on http://localhost:${port}/api/v1 (docs: /api/docs)`);
}

void bootstrap();
