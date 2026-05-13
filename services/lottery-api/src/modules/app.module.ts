import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuditLogRepository } from "./audit/audit-log.repository.js";
import { CatalogController } from "./catalog/catalog.controller.js";
import { CatalogService } from "./catalog/catalog.service.js";
import { AdminGuard } from "./common/admin.guard.js";
import { DemoPagesController } from "./demo-pages/demo-pages.controller.js";
import { IdempotencyService } from "./idempotency/idempotency.service.js";
import { ManualCreditController } from "./manual-credit/manual-credit.controller.js";
import { ManualCreditService } from "./manual-credit/manual-credit.service.js";
import { CreditLedgerRepository } from "./manual-credit/credit-ledger.repository.js";
import { HealthController } from "./health/health.controller.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { ResultsController } from "./results/results.controller.js";
import { ResultsService } from "./results/results.service.js";
import { RoundsController } from "./rounds/rounds.controller.js";
import { RoundsService } from "./rounds/rounds.service.js";
import { PrismaRepository } from "./store/prisma.repository.js";
import { RequestIdMiddleware } from "./common/request-id.middleware.js";
import { TicketsController } from "./tickets/tickets.controller.js";
import { TicketsService } from "./tickets/tickets.service.js";

@Module({
  imports: [PrismaModule],
  controllers: [HealthController, DemoPagesController, CatalogController, RoundsController, ResultsController, ManualCreditController, TicketsController],
  providers: [
    PrismaRepository,
    CatalogService,
    RoundsService,
    ResultsService,
    ManualCreditService,
    TicketsService,
    IdempotencyService,
    AuditLogRepository,
    CreditLedgerRepository,
    { provide: APP_GUARD, useClass: AdminGuard }
  ],
  exports: [PrismaRepository, AuditLogRepository, CreditLedgerRepository]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}
