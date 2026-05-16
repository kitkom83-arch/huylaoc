import { Body, Controller, Get, Headers, Param, Post } from "@nestjs/common";
import { postResultSchema, type PostResultDto } from "@lottery/domain";
import { parseBody } from "../common/zod.js";
import { IdempotencyService } from "../idempotency/idempotency.service.js";
import { ResultsService } from "./results.service.js";

@Controller()
export class ResultsController {
  constructor(
    private readonly results: ResultsService,
    private readonly idempotency: IdempotencyService
  ) {}

  @Get("/v1/results/latest")
  async latest() {
    return { result: await this.results.latest() };
  }

  @Post("/v1/admin/results")
  post(@Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Headers("x-admin-id") actorId: string) {
    const dto: PostResultDto = parseBody(postResultSchema, body);
    return this.idempotency.run({
      scope: "admin:results:post",
      actorRef: actorId,
      key,
      body: dto,
      successStatus: 201,
      handler: (tx) => this.results.post(dto, actorId, tx)
    });
  }

  @Get("/v1/admin/settlements/:job_id")
  settlementJob(@Param("job_id") jobId: string) {
    return this.results.getSettlementJob(jobId);
  }
}
