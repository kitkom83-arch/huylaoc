import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException
} from "@nestjs/common";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { betTypeDigits, type AdminManualTicketDto, type BetTypeCatalogEntry, type BetTypeCode, type CheckTicketDto, type ConfirmTicketDto, type CreateQuoteDto, type QuoteItemDto } from "@lottery/domain";
import { Prisma, type Quote, type Ticket, type TicketItem } from "@prisma/client";
import { AuditLogRepository } from "../audit/audit-log.repository.js";
import { CreditLedgerRepository } from "../manual-credit/credit-ledger.repository.js";
import { PrismaRepository, type DbClient } from "../store/prisma.repository.js";

type QuoteItemInput = QuoteItemDto;
type CreateQuoteInput = CreateQuoteDto;

type NormalizedQuoteItem = {
  line_no: number;
  bet_type: BetTypeCode;
  selection_raw: string;
  selection_norm: string;
  stake: number;
  odds: number;
  potential_payout: number;
  rule_snapshot: {
    outcome_rule: string;
    digits: number;
    default_odds: string;
    source: "round.paytable_snapshot" | "bet_type_catalog";
  };
};

type QuoteSnapshot = {
  round_id: string;
  payment_mode: "MANUAL_CREDIT" | "EXTERNAL_WALLET";
  currency_code: string;
  customer_ref?: string;
  user_manual_id?: string;
  wallet_account_ref?: string;
  external_txn_ref?: string;
  items: NormalizedQuoteItem[];
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function money(value: number): number {
  return Number(value.toFixed(2));
}

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}

function decimal4(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(4));
}

function iso(date: Date): string {
  return date.toISOString();
}

function ticketTokenHash(token: string): string {
  return sha256(`ticket-check:${token}`);
}

const publicCheckTokenVersion = "v1";

function publicCheckTokenSecret(): string {
  if (process.env.PUBLIC_CHECK_TOKEN_SECRET) {
    return process.env.PUBLIC_CHECK_TOKEN_SECRET;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("PUBLIC_CHECK_TOKEN_SECRET is required in production");
  }
  return "dev-only-public-check-token-secret";
}

function publicCheckToken(ticket: Pick<Ticket, "id" | "ticket_no">): string {
  const digest = createHmac("sha256", publicCheckTokenSecret())
    .update(`${publicCheckTokenVersion}:${ticket.id}:${ticket.ticket_no}`)
    .digest("base64url");
  return `pct_${publicCheckTokenVersion}_${digest}`;
}

function safeEqualHash(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function parseSnapshot(value: Prisma.JsonValue): QuoteSnapshot {
  return value as unknown as QuoteSnapshot;
}

function quoteResponse(quote: Quote, snapshot = parseSnapshot(quote.quote_snapshot)): Record<string, unknown> {
  return {
    quote_id: quote.id,
    status: quote.status,
    round_id: quote.round_id,
    payment_mode: quote.mode,
    currency_code: quote.currency.trim(),
    stake_total: money(Number(quote.stake_total)),
    potential_payout_total: money(Number(quote.potential_payout_total)),
    expires_at: iso(quote.expires_at),
    items: snapshot.items.map(({ rule_snapshot: _ruleSnapshot, ...item }) => item)
  };
}

function safeTicketResponse(
  ticket: Ticket & { round?: { round_code: string }; items?: TicketItem[] },
  plaintextToken?: string,
  options: { includeInternalRefs?: boolean } = { includeInternalRefs: true }
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    ticket_no: ticket.ticket_no,
    round_code: ticket.round?.round_code,
    status: ticket.status,
    payment_mode: ticket.mode,
    funding_status: ticket.funding_status,
    settlement_status: ticket.settlement_status,
    payout_status: ticket.payout_status,
    stake_total: money(Number(ticket.stake_total)),
    potential_payout_total: money(Number(ticket.potential_payout_total)),
    payout_total: money(Number(ticket.actual_payout_total)),
    items: (ticket.items ?? []).map((item) => ({
      line_no: item.line_no,
      bet_type: item.bet_type_code,
      selection_raw: item.selection_raw,
      selection_norm: item.number,
      stake: money(Number(item.stake)),
      odds: Number(Number(item.odds_value).toFixed(4)),
      potential_payout: money(Number(item.potential_payout)),
      win_status: item.win_status,
      payout_amount: money(Number(item.payout_amount))
    }))
  };
  if (plaintextToken) {
    body.public_check_token = plaintextToken;
  }
  if (options.includeInternalRefs) {
    body.round_id = ticket.round_id;
    body.customer_ref = ticket.customer_ref ?? undefined;
    body.user_manual_id = ticket.manual_user_id ?? undefined;
  }
  return body;
}

@Injectable()
export class TicketsService {
  constructor(
    private readonly repo: PrismaRepository,
    private readonly ledger: CreditLedgerRepository,
    private readonly audit: AuditLogRepository
  ) {}

  async createQuote(input: CreateQuoteInput, db: Prisma.TransactionClient): Promise<Record<string, unknown>> {
    const quote = await this.createQuoteRecord(input, db);
    return quoteResponse(quote);
  }

  async confirmTicket(input: ConfirmTicketDto, idempotency: { scope: string; key: string }, db: Prisma.TransactionClient): Promise<Record<string, unknown>> {
    return this.confirmQuote(input.quote_id, idempotency, { actor_type: "CUSTOMER", actor_id: "public" }, db);
  }

  async createManualTicket(input: AdminManualTicketDto, actorId: string, idempotency: { scope: string; key: string }, db: Prisma.TransactionClient): Promise<Record<string, unknown>> {
    const quote = await this.createQuoteRecord(
      {
        round_id: input.round_id,
        payment_mode: "MANUAL_CREDIT",
        currency_code: input.currency_code,
        user_manual_id: input.user_manual_id,
        customer_ref: input.customer_ref,
        items: input.items
      },
      db
    );
    const response = await this.confirmQuote(quote.id, idempotency, { actor_type: "ADMIN", actor_id: actorId, note: input.note }, db);
    await this.audit.append(
      {
        actor_type: "ADMIN",
        actor_id: actorId,
        action: "ADMIN_MANUAL_TICKET_ENTRY",
        resource_type: "tickets",
        resource_id: String(response.ticket_no),
        after: { ticket_no: response.ticket_no, note: input.note }
      },
      db
    );
    return response;
  }

  async checkTicket(input: CheckTicketDto): Promise<Record<string, unknown>> {
    const ticket = await this.repo.client().ticket.findUnique({
      where: { ticket_no: input.ticket_no },
      include: { round: { select: { round_code: true } }, items: { orderBy: { line_no: "asc" } } }
    });
    if (!ticket || !safeEqualHash(ticket.public_check_token_hash, ticketTokenHash(input.public_check_token))) {
      throw new UnauthorizedException("ticket not found");
    }
    return safeTicketResponse(ticket, undefined, { includeInternalRefs: false });
  }

  async restorePublicTokenForStoredResponse(response: unknown, db: DbClient): Promise<Record<string, unknown>> {
    if (!response || typeof response !== "object") {
      return response as Record<string, unknown>;
    }
    const body = response as Record<string, unknown>;
    if (typeof body.ticket_no !== "string") {
      return body;
    }
    const ticket = await db.ticket.findUnique({ where: { ticket_no: body.ticket_no }, select: { id: true, ticket_no: true } });
    if (!ticket) {
      return body;
    }
    return { ...body, public_check_token: publicCheckToken(ticket) };
  }

  async listAdminTickets(filters: {
    round_id?: string;
    ticket_no?: string;
    payment_mode?: "MANUAL_CREDIT" | "EXTERNAL_WALLET";
    funding_status?: string;
    settlement_status?: string;
    payout_status?: string;
    user_manual_id?: string;
    customer_ref?: string;
    limit?: number;
    cursor?: string;
    page?: number;
  }): Promise<Record<string, unknown>> {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
    const page = Math.max(filters.page ?? 1, 1);
    const where: Prisma.TicketWhereInput = {
      ...(filters.round_id ? { round_id: filters.round_id } : {}),
      ...(filters.ticket_no ? { ticket_no: filters.ticket_no } : {}),
      ...(filters.payment_mode ? { mode: filters.payment_mode } : {}),
      ...(filters.funding_status ? { funding_status: filters.funding_status as never } : {}),
      ...(filters.settlement_status ? { settlement_status: filters.settlement_status } : {}),
      ...(filters.payout_status ? { payout_status: filters.payout_status as never } : {}),
      ...(filters.user_manual_id ? { manual_user_id: filters.user_manual_id } : {}),
      ...(filters.customer_ref ? { customer_ref: filters.customer_ref } : {})
    };
    const tickets = await this.repo.client().ticket.findMany({
      where,
      include: { round: { select: { round_code: true } }, items: { orderBy: { line_no: "asc" } } },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      take: limit,
      ...(filters.cursor ? { skip: 1, cursor: { id: filters.cursor } } : { skip: (page - 1) * limit })
    });
    return {
      tickets: tickets.map((ticket) => safeTicketResponse(ticket)),
      limit,
      page: filters.cursor ? undefined : page,
      next_cursor: tickets.length === limit ? tickets[tickets.length - 1]?.id : undefined
    };
  }

  private async createQuoteRecord(input: CreateQuoteInput, db: Prisma.TransactionClient): Promise<Quote> {
    if (input.payment_mode === "MANUAL_CREDIT" && !input.user_manual_id) {
      throw new BadRequestException("user_manual_id is required for MANUAL_CREDIT");
    }
    const round = await db.round.findUnique({ where: { id: input.round_id } });
    if (!round) {
      throw new NotFoundException("round not found");
    }
    if (round.status !== "OPEN") {
      throw new ConflictException("round is not open");
    }
    if (input.user_manual_id) {
      const user = await db.manualUser.findUnique({ where: { id: input.user_manual_id } });
      if (!user || user.status !== "ENABLED") {
        throw new NotFoundException("manual user not found");
      }
    }

    const snapshotItems = await this.normalizeItems(input.items, round.paytable_snapshot as Prisma.JsonValue, db);
    const stakeTotal = money(snapshotItems.reduce((sum, item) => sum + item.stake, 0));
    const potentialPayoutTotal = money(snapshotItems.reduce((sum, item) => sum + item.potential_payout, 0));
    const snapshot: QuoteSnapshot = {
      round_id: input.round_id,
      payment_mode: input.payment_mode,
      currency_code: input.currency_code,
      customer_ref: input.customer_ref,
      user_manual_id: input.user_manual_id,
      wallet_account_ref: input.wallet_account_ref,
      external_txn_ref: input.external_txn_ref,
      items: snapshotItems
    };

    return db.quote.create({
      data: {
        quote_no: `Q-${randomUUID()}`,
        round_id: input.round_id,
        mode: input.payment_mode,
        customer_ref: input.customer_ref,
        manual_user_id: input.user_manual_id,
        wallet_account_ref: input.wallet_account_ref,
        external_txn_ref: input.external_txn_ref,
        stake_total: decimal(stakeTotal),
        potential_payout_total: decimal(potentialPayoutTotal),
        currency: input.currency_code,
        status: "CREATED",
        expires_at: new Date(Date.now() + 5 * 60 * 1000),
        request_hash: sha256(stableStringify(input)),
        quote_snapshot: snapshot as unknown as Prisma.InputJsonValue
      }
    });
  }

  private async normalizeItems(items: QuoteItemInput[], paytableSnapshot: Prisma.JsonValue, db: DbClient): Promise<NormalizedQuoteItem[]> {
    const paytable = Array.isArray(paytableSnapshot) ? (paytableSnapshot as unknown as BetTypeCatalogEntry[]) : [];
    const catalog = await db.betTypeCatalog.findMany({ where: { code: { in: items.map((item) => item.bet_type) } } });
    const catalogByCode = new Map(catalog.map((entry) => [entry.code, entry]));
    return items.map((item, index) => {
      const catalogEntry = catalogByCode.get(item.bet_type);
      if (!catalogEntry || !catalogEntry.enabled) {
        throw new BadRequestException("bet_type is invalid or disabled");
      }
      const expectedDigits = betTypeDigits[item.bet_type];
      const selectionRaw = item.selection;
      const selectionNorm = item.selection.trim();
      if (!new RegExp(`^\\d{${expectedDigits}}$`).test(selectionNorm)) {
        throw new BadRequestException("selection length does not match bet_type");
      }
      const snapshotEntry = paytable.find((entry) => entry.code === item.bet_type);
      const odds = Number(snapshotEntry?.default_odds ?? catalogEntry.default_odds);
      const stake = money(item.stake);
      const potentialPayout = money(stake * odds);
      return {
        line_no: index + 1,
        bet_type: item.bet_type,
        selection_raw: selectionRaw,
        selection_norm: selectionNorm,
        stake,
        odds,
        potential_payout: potentialPayout,
        rule_snapshot: {
          outcome_rule: snapshotEntry?.outcome_rule ?? catalogEntry.outcome_rule,
          digits: expectedDigits,
          default_odds: (snapshotEntry?.default_odds ?? catalogEntry.default_odds.toFixed(4)).toString(),
          source: snapshotEntry ? "round.paytable_snapshot" : "bet_type_catalog"
        }
      };
    });
  }

  private async confirmQuote(
    quoteId: string,
    idempotency: { scope: string; key: string },
    actor: { actor_type: string; actor_id: string; note?: string },
    db: Prisma.TransactionClient
  ): Promise<Record<string, unknown>> {
    const quoteRows = await db.$queryRaw<Array<Quote>>`
      SELECT * FROM quotes WHERE id = CAST(${quoteId} AS uuid) FOR UPDATE
    `;
    const quote = quoteRows[0];
    if (!quote) {
      throw new NotFoundException("quote not found");
    }
    if (quote.expires_at.getTime() <= Date.now()) {
      throw new ConflictException("quote expired");
    }
    if (quote.status !== "CREATED") {
      throw new ConflictException("quote already used");
    }

    const round = await db.round.findUnique({ where: { id: quote.round_id } });
    if (!round || round.status !== "OPEN") {
      throw new ConflictException("round is not open");
    }

    if (quote.mode === "MANUAL_CREDIT") {
      return this.confirmManualCreditTicket(quote, idempotency, actor, db);
    }
    return this.confirmExternalWalletTicket(quote, idempotency, actor, db);
  }

  private async confirmManualCreditTicket(
    quote: Quote,
    idempotency: { scope: string; key: string },
    actor: { actor_type: string; actor_id: string; note?: string },
    db: Prisma.TransactionClient
  ): Promise<Record<string, unknown>> {
    if (!quote.manual_user_id) {
      throw new BadRequestException("quote has no manual user");
    }
    const account = await this.repo.lockCreditAccountByManualUserId(quote.manual_user_id, db);
    if (!account) {
      throw new NotFoundException("credit account not found");
    }
    const stakeTotal = money(Number(quote.stake_total));
    if (account.balance < stakeTotal) {
      throw new UnprocessableEntityException("insufficient credit");
    }

    const ticket = await this.createTicketFromQuote(quote, {
      status: "CONFIRMED",
      funding_status: "DEBITED",
      idempotency
    }, db);
    const balanceAfter = money(account.balance - stakeTotal);
    await this.ledger.append(
      {
        credit_account_id: account.id,
        manual_user_id: quote.manual_user_id,
        type: "BET_DEBIT",
        amount_delta: -stakeTotal,
        balance_before: account.balance,
        balance_after: balanceAfter,
        reason: actor.note ?? `ticket stake ${ticket.ticket_no}`,
        admin_id: actor.actor_type === "ADMIN" ? actor.actor_id : ""
      },
      db
    );
    await this.repo.updateCreditAccountBalance(account.id, balanceAfter, db);
    await db.quote.update({ where: { id: quote.id }, data: { status: "USED" } });
    await this.audit.append(
      {
        actor_type: actor.actor_type,
        actor_id: actor.actor_id,
        action: "TICKET_CONFIRM",
        resource_type: "tickets",
        resource_id: ticket.id,
        after: { ticket_no: ticket.ticket_no, mode: ticket.mode, funding_status: ticket.funding_status }
      },
      db
    );
    const reloaded = await this.loadTicket(ticket.id, db);
    return safeTicketResponse(reloaded, publicCheckToken(ticket));
  }

  private async confirmExternalWalletTicket(
    quote: Quote,
    idempotency: { scope: string; key: string },
    actor: { actor_type: string; actor_id: string },
    db: Prisma.TransactionClient
  ): Promise<Record<string, unknown>> {
    const ticket = await this.createTicketFromQuote(quote, {
      status: "PENDING_FUNDING",
      funding_status: "PENDING",
      idempotency
    }, db);
    await db.walletOutbox.create({
      data: {
        type: "WALLET_DEBIT",
        status: "PENDING",
        ticket_id: ticket.id,
        wallet_account_ref: quote.wallet_account_ref,
        external_txn_ref: quote.external_txn_ref,
        payload: {
          ticket_no: ticket.ticket_no,
          stake_total: money(Number(ticket.stake_total)),
          currency_code: quote.currency.trim()
        } as Prisma.InputJsonValue
      }
    });
    await db.quote.update({ where: { id: quote.id }, data: { status: "USED" } });
    await this.audit.append(
      {
        actor_type: actor.actor_type,
        actor_id: actor.actor_id,
        action: "TICKET_CONFIRM",
        resource_type: "tickets",
        resource_id: ticket.id,
        after: { ticket_no: ticket.ticket_no, mode: ticket.mode, funding_status: ticket.funding_status }
      },
      db
    );
    const reloaded = await this.loadTicket(ticket.id, db);
    return safeTicketResponse(reloaded, publicCheckToken(ticket));
  }

  private async createTicketFromQuote(
    quote: Quote,
    input: {
      status: "CONFIRMED" | "PENDING_FUNDING";
      funding_status: "DEBITED" | "PENDING";
      idempotency: { scope: string; key: string };
    },
    db: Prisma.TransactionClient
  ): Promise<Ticket> {
    const snapshot = parseSnapshot(quote.quote_snapshot);
    const ticketId = randomUUID();
    const ticketNo = `T-${randomUUID()}`;
    const ticket = await db.ticket.create({
      data: {
        id: ticketId,
        ticket_no: ticketNo,
        round_id: quote.round_id,
        quote_id: quote.id,
        mode: quote.mode,
        customer_ref: quote.customer_ref,
        manual_user_id: quote.manual_user_id,
        wallet_account_ref: quote.wallet_account_ref,
        external_txn_ref: quote.external_txn_ref,
        stake_total: quote.stake_total,
        potential_payout_total: quote.potential_payout_total,
        actual_payout_total: decimal(0),
        funding_status: input.funding_status,
        settlement_status: "PENDING",
        payout_status: "NOT_REQUIRED",
        status: input.status,
        idempotency_scope: input.idempotency.scope,
        idempotency_key: input.idempotency.key,
        public_check_token_hash: ticketTokenHash(publicCheckToken({ id: ticketId, ticket_no: ticketNo }))
      }
    });
    await db.ticketItem.createMany({
      data: snapshot.items.map((item) => ({
        ticket_id: ticket.id,
        line_no: item.line_no,
        bet_type_code: item.bet_type,
        selection_raw: item.selection_raw,
        number: item.selection_norm,
        stake: decimal(item.stake),
        odds_value: decimal4(item.odds),
        potential_payout: decimal(item.potential_payout),
        rule_snapshot: item.rule_snapshot as Prisma.InputJsonValue
      }))
    });
    return ticket;
  }

  private async loadTicket(id: string, db: DbClient): Promise<Ticket & { round: { round_code: string }; items: TicketItem[] }> {
    return db.ticket.findUniqueOrThrow({
      where: { id },
      include: { round: { select: { round_code: true } }, items: { orderBy: { line_no: "asc" } } }
    });
  }
}
