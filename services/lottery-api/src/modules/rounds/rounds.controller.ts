import { Body, Controller, Get, Headers, Param, Patch, Post } from "@nestjs/common";
import { createRoundSchema, patchRoundSchema } from "@lottery/domain";
import { parseBody } from "../common/zod.js";
import { IdempotencyService } from "../idempotency/idempotency.service.js";
import { RoundsService } from "./rounds.service.js";

@Controller()
export class RoundsController {
  constructor(
    private readonly rounds: RoundsService,
    private readonly idempotency: IdempotencyService
  ) {}

  @Get("/v1/rounds/current")
  async current() {
    return { round: await this.rounds.current() };
  }

  @Post("/v1/admin/rounds")
  create(@Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Headers("x-admin-id") actorId: string) {
    const dto = parseBody(createRoundSchema, body);
    return this.idempotency.run({
      scope: "admin:rounds:create",
      actorRef: actorId,
      key,
      body: dto,
      successStatus: 201,
      handler: async (tx) => ({ round: await this.rounds.create({ ...dto, status: dto.status ?? "DRAFT" }, actorId, tx) })
    });
  }

  @Patch("/v1/admin/rounds/:round_id")
  patch(
    @Param("round_id") roundId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Headers("x-admin-id") actorId: string
  ) {
    const dto = parseBody(patchRoundSchema, body);
    return this.idempotency.run({
      scope: `admin:rounds:patch:${roundId}`,
      actorRef: actorId,
      key,
      body: dto,
      successStatus: 200,
      handler: async (tx) => ({ round: await this.rounds.patch(roundId, dto, actorId, tx) })
    });
  }
}
