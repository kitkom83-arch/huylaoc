import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AppModule } from "./modules/app.module.js";
import { GlobalErrorFilter } from "./modules/common/global-error.filter.js";
import { RequestIdMiddleware } from "./modules/common/request-id.middleware.js";
import { loadConfig } from "./modules/config/config.js";

export async function createNestApp(): Promise<NestFastifyApplication> {
  const config = loadConfig();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: config.mode === "test" ? false : ["error", "warn", "log"]
  });

  app.use(new RequestIdMiddleware().use);
  app.useGlobalFilters(new GlobalErrorFilter());

  const openApi = new DocumentBuilder()
    .setTitle("Lottery Game Engine API")
    .setDescription("Safe P0 lottery engine foundation")
    .setVersion("0.1.0")
    .build();
  SwaggerModule.setup("/api/docs", app, SwaggerModule.createDocument(app, openApi));

  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

const executedPath = process.argv[1] ?? "";

if (executedPath.endsWith("services/lottery-api/src/main.ts") || executedPath.endsWith("services\\lottery-api\\src\\main.ts") || executedPath.endsWith("services/lottery-api/dist/main.js") || executedPath.endsWith("services\\lottery-api\\dist\\main.js")) {
  const config = loadConfig();
  const app = await createNestApp();
  await app.listen(config.port, "0.0.0.0");
}
