import { Body, Controller, Get, Headers, Post } from "@nestjs/common";
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
}
