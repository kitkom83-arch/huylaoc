import { Body, Controller, Get, Headers, Post } from "@nestjs/common";
import { createManualUserSchema, manualCreditChangeSchema } from "@lottery/domain";
import { parseBody } from "../common/zod.js";
import { IdempotencyService } from "../idempotency/idempotency.service.js";
import { ManualCreditService } from "./manual-credit.service.js";

@Controller("/v1/admin/manual")
export class ManualCreditController {
  constructor(
    private readonly manual: ManualCreditService,
    private readonly idempotency: IdempotencyService
  ) {}

  @Post("/users")
  createUser(@Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Headers("x-admin-id") actorId: string) {
    const dto = parseBody(createManualUserSchema, body);
    return this.idempotency.run({
      scope: "admin:manual-users:create",
      actorRef: actorId,
      key,
      body: dto,
      successStatus: 201,
      handler: (tx) => this.manual.createUser(dto, actorId, tx)
    });
  }

  @Post("/credits/topup")
  topup(@Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Headers("x-admin-id") actorId: string) {
    const dto = parseBody(manualCreditChangeSchema, body);
    return this.idempotency.run({
      scope: "admin:manual-credits:topup",
      actorRef: actorId,
      key,
      body: dto,
      successStatus: 201,
      handler: (tx) => this.manual.topup(dto, actorId, tx)
    });
  }

  @Post("/credits/deduct")
  deduct(@Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Headers("x-admin-id") actorId: string) {
    const dto = parseBody(manualCreditChangeSchema, body);
    return this.idempotency.run({
      scope: "admin:manual-credits:deduct",
      actorRef: actorId,
      key,
      body: dto,
      successStatus: 201,
      handler: (tx) => this.manual.deduct(dto, actorId, tx)
    });
  }

  @Get("/credits/ledger")
  async ledger() {
    return { ledger: await this.manual.listLedger() };
  }
}
