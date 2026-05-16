import { Body, Controller, Get, Headers, Param, Patch, Post } from "@nestjs/common";
import { createManualUserSchema, manualCreditChangeSchema, type CreateManualUserDto, type ManualCreditChangeDto } from "@lottery/domain";
import { z } from "zod";
import { parseBody } from "../common/zod.js";
import { IdempotencyService } from "../idempotency/idempotency.service.js";
import { ManualCreditService } from "./manual-credit.service.js";

const updateManualUserStatusSchema = z
  .object({
    status: z.enum(["ACTIVE", "SUSPENDED", "CLOSED"]),
    reason_code: z.string().min(1).max(64).optional(),
    note: z.string().min(1).max(512).optional()
  })
  .strict();

type UpdateManualUserStatusDto = z.infer<typeof updateManualUserStatusSchema>;

@Controller("/v1/admin/manual")
export class ManualCreditController {
  constructor(
    private readonly manual: ManualCreditService,
    private readonly idempotency: IdempotencyService
  ) {}

  @Post("/users")
  createUser(@Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Headers("x-admin-id") actorId: string) {
    const dto: CreateManualUserDto = parseBody(createManualUserSchema, body);
    return this.idempotency.run({
      scope: "admin:manual-users:create",
      actorRef: actorId,
      key,
      body: dto,
      successStatus: 201,
      handler: (tx) => this.manual.createUser(dto, actorId, tx)
    });
  }

  @Patch("/users/:user_id/status")
  updateUserStatus(@Param("user_id") userId: string, @Body() body: unknown, @Headers("x-admin-id") actorId: string) {
    const dto: UpdateManualUserStatusDto = parseBody(updateManualUserStatusSchema, body);
    return this.manual.updateUserStatus({ user_id: userId, ...dto }, actorId);
  }

  @Post("/credits/topup")
  topup(@Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Headers("x-admin-id") actorId: string) {
    const dto: ManualCreditChangeDto = parseBody(manualCreditChangeSchema, body);
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
    const dto: ManualCreditChangeDto = parseBody(manualCreditChangeSchema, body);
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
