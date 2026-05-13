import { z } from "zod";

export const betTypeCodes = [
  "ONE_DIGIT",
  "TWO_STRAIGHT",
  "THREE_STRAIGHT",
  "FOUR_STRAIGHT",
  "FIVE_STRAIGHT",
  "SIX_STRAIGHT"
] as const;

export type BetTypeCode = (typeof betTypeCodes)[number];

export const betTypeDigits: Record<BetTypeCode, number> = {
  ONE_DIGIT: 1,
  TWO_STRAIGHT: 2,
  THREE_STRAIGHT: 3,
  FOUR_STRAIGHT: 4,
  FIVE_STRAIGHT: 5,
  SIX_STRAIGHT: 6
};

export type RoundStatus = "DRAFT" | "OPEN" | "CLOSED" | "RESULT_POSTED" | "CANCELLED";
export type GameMode = "EXTERNAL_WALLET" | "MANUAL_CREDIT";
export type LedgerType = "TOPUP" | "DEDUCT" | "BET_DEBIT" | "BET_PAYOUT" | "ADJUSTMENT" | "REVERSAL";
export type TicketLifecycleStatus = "PENDING_FUNDING" | "CONFIRMED" | "REJECTED" | "SETTLED" | "CANCELLED";
export type FundingStatus = "NOT_REQUIRED" | "PENDING" | "DEBITED" | "SUCCEEDED" | "FAILED" | "UNKNOWN" | "REVERSED";
export type SettlementStatus = "PENDING" | "SETTLED" | "CANCELLED";

export interface BetTypeCatalogEntry {
  code: BetTypeCode;
  display_name: string;
  digits: number;
  outcome_rule: `tail${1 | 2 | 3 | 4 | 5 | 6}`;
  default_odds: string;
  min_stake: string;
  max_stake: string;
  enabled: boolean;
}

export interface SettlementEligibilityTicket {
  status: TicketLifecycleStatus | string;
  settlement_status: SettlementStatus | string;
  funding_status: FundingStatus | string;
}

export function isTicketEligibleForSettlement(ticket: SettlementEligibilityTicket): boolean {
  return (
    ticket.status === "CONFIRMED" &&
    ticket.settlement_status === "PENDING" &&
    (ticket.funding_status === "DEBITED" || ticket.funding_status === "SUCCEEDED")
  );
}

export const result6dSchema = z.string().regex(/^\d{6}$/, "result_6d must be exactly 6 digits");

export const createRoundSchema = z
  .object({
    round_code: z.string().min(1).max(64),
    opens_at: z.string().datetime(),
    closes_at: z.string().datetime(),
    draws_at: z.string().datetime(),
    status: z.enum(["DRAFT", "OPEN"]).default("DRAFT")
  })
  .strict();

export type CreateRoundDto = z.infer<typeof createRoundSchema>;

export const patchRoundSchema = z
  .object({
    opens_at: z.string().datetime().optional(),
    closes_at: z.string().datetime().optional(),
    draws_at: z.string().datetime().optional(),
    status: z.enum(["DRAFT", "OPEN", "CLOSED", "CANCELLED"]).optional()
  })
  .strict();

export type PatchRoundDto = z.infer<typeof patchRoundSchema>;

export const postResultSchema = z
  .object({
    round_id: z.string().min(1),
    result_6d: result6dSchema
  })
  .strict();

export type PostResultDto = z.infer<typeof postResultSchema>;

export const createManualUserSchema = z
  .object({
    username: z.string().min(3).max(64),
    display_name: z.string().min(1).max(128),
    password: z.string().min(10).max(256)
  })
  .strict();

export type CreateManualUserDto = z.infer<typeof createManualUserSchema>;

export const manualCreditChangeSchema = z
  .object({
    manual_user_id: z.string().min(1),
    amount: z.number().positive(),
    reason: z.string().min(1).max(256)
  })
  .strict();

export type ManualCreditChangeDto = z.infer<typeof manualCreditChangeSchema>;

export const quoteItemSchema = z
  .object({
    bet_type: z.enum(betTypeCodes),
    selection: z.string().min(1).max(6),
    stake: z.number().positive()
  })
  .strict();

export type QuoteItemDto = z.infer<typeof quoteItemSchema>;

export const createQuoteSchema = z
  .object({
    round_id: z.string().min(1),
    payment_mode: z.enum(["MANUAL_CREDIT", "EXTERNAL_WALLET"]),
    currency_code: z.string().regex(/^[A-Z]{3}$/).default("THB"),
    user_manual_id: z.string().min(1).optional(),
    customer_ref: z.string().min(1).max(128).optional(),
    wallet_account_ref: z.string().min(1).max(128).optional(),
    external_txn_ref: z.string().min(1).max(128).optional(),
    items: z.array(quoteItemSchema).min(1).max(100)
  })
  .strict();

export type CreateQuoteDto = z.infer<typeof createQuoteSchema>;

export const confirmTicketSchema = z
  .object({
    quote_id: z.string().min(1)
  })
  .strict();

export type ConfirmTicketDto = z.infer<typeof confirmTicketSchema>;

export const checkTicketSchema = z
  .object({
    ticket_no: z.string().min(1),
    public_check_token: z.string().min(1)
  })
  .strict();

export type CheckTicketDto = z.infer<typeof checkTicketSchema>;

export const adminManualTicketSchema = z
  .object({
    user_manual_id: z.string().min(1),
    round_id: z.string().min(1),
    currency_code: z.string().regex(/^[A-Z]{3}$/).default("THB"),
    customer_ref: z.string().min(1).max(128).optional(),
    items: z.array(quoteItemSchema).min(1).max(100),
    note: z.string().min(1).max(512).optional()
  })
  .strict();

export type AdminManualTicketDto = z.infer<typeof adminManualTicketSchema>;

export function assertRoundTimeOrder(opensAt: string, closesAt: string, drawsAt: string): void {
  if (!(Date.parse(opensAt) < Date.parse(closesAt) && Date.parse(closesAt) <= Date.parse(drawsAt))) {
    throw new Error("round time order must be opens_at < closes_at <= draws_at");
  }
}
