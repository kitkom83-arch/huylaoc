import { Body, Controller, Get, Headers, HttpCode, Post, Query } from "@nestjs/common";
import { adminManualTicketSchema, checkTicketSchema, confirmTicketSchema, createQuoteSchema } from "@lottery/domain";
import { parseBody } from "../common/zod.js";
import { IdempotencyService } from "../idempotency/idempotency.service.js";
import { TicketsService } from "./tickets.service.js";

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function withoutPlaintextCheckToken(response: unknown): unknown {
  if (!response || typeof response !== "object") {
    return response;
  }
  const { public_check_token: _publicCheckToken, ...safe } = response as Record<string, unknown>;
  return safe;
}

@Controller("/v1")
export class TicketsController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly idempotency: IdempotencyService
  ) {}

  @Post("/quotes")
  createQuote(@Body() body: unknown, @Headers("idempotency-key") key: string | undefined) {
    const parsed = parseBody(createQuoteSchema, body);
    const dto = { ...parsed, currency_code: parsed.currency_code ?? "THB" };
    return this.idempotency.run({
      scope: "quotes:create",
      actorRef: dto.user_manual_id ?? dto.wallet_account_ref ?? dto.customer_ref ?? "public",
      key,
      body: dto,
      successStatus: 201,
      handler: (tx) => this.tickets.createQuote(dto, tx)
    });
  }

  @Post("/tickets/confirm")
  confirm(@Body() body: unknown, @Headers("idempotency-key") key: string | undefined) {
    const dto = parseBody(confirmTicketSchema, body);
    return this.idempotency.run({
      scope: "tickets:confirm",
      actorRef: "public",
      key,
      body: dto,
      successStatus: 201,
      storedResponse: withoutPlaintextCheckToken,
      replayResponse: (storedResponse, tx) => this.tickets.restorePublicTokenForStoredResponse(storedResponse, tx),
      handler: (tx) => this.tickets.confirmTicket(dto, { scope: "tickets:confirm", key: key! }, tx)
    });
  }

  @Post("/tickets/check")
  @HttpCode(200)
  check(@Body() body: unknown) {
    const dto = parseBody(checkTicketSchema, body);
    return this.tickets.checkTicket(dto);
  }

  @Get("/admin/tickets")
  adminTickets(@Query() query: Record<string, unknown>) {
    return this.tickets.listAdminTickets({
      round_id: typeof query.round_id === "string" ? query.round_id : undefined,
      ticket_no: typeof query.ticket_no === "string" ? query.ticket_no : undefined,
      payment_mode: query.payment_mode === "MANUAL_CREDIT" || query.payment_mode === "EXTERNAL_WALLET" ? query.payment_mode : undefined,
      funding_status: typeof query.funding_status === "string" ? query.funding_status : undefined,
      settlement_status: typeof query.settlement_status === "string" ? query.settlement_status : undefined,
      payout_status: typeof query.payout_status === "string" ? query.payout_status : undefined,
      user_manual_id: typeof query.user_manual_id === "string" ? query.user_manual_id : undefined,
      customer_ref: typeof query.customer_ref === "string" ? query.customer_ref : undefined,
      cursor: typeof query.cursor === "string" ? query.cursor : undefined,
      limit: optionalNumber(query.limit),
      page: optionalNumber(query.page)
    });
  }

  @Post("/admin/manual/tickets")
  manualTicket(@Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Headers("x-admin-id") actorId: string) {
    const parsed = parseBody(adminManualTicketSchema, body);
    const dto = { ...parsed, currency_code: parsed.currency_code ?? "THB" };
    return this.idempotency.run({
      scope: "admin:manual:tickets",
      actorRef: actorId,
      key,
      body: dto,
      successStatus: 201,
      storedResponse: withoutPlaintextCheckToken,
      replayResponse: (storedResponse, tx) => this.tickets.restorePublicTokenForStoredResponse(storedResponse, tx),
      handler: (tx) => this.tickets.createManualTicket(dto, actorId, { scope: "admin:manual:tickets", key: key! }, tx)
    });
  }
}
