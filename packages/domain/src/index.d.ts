import { z } from "zod";
export declare const betTypeCodes: readonly ["ONE_DIGIT", "TWO_STRAIGHT", "THREE_STRAIGHT", "FOUR_STRAIGHT", "FIVE_STRAIGHT", "SIX_STRAIGHT"];
export type BetTypeCode = (typeof betTypeCodes)[number];
export declare const betTypeDigits: Record<BetTypeCode, number>;
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
export declare function isTicketEligibleForSettlement(ticket: SettlementEligibilityTicket): boolean;
export declare const result6dSchema: z.ZodString;
export declare const createRoundSchema: z.ZodObject<{
    round_code: z.ZodString;
    opens_at: z.ZodString;
    closes_at: z.ZodString;
    draws_at: z.ZodString;
    status: z.ZodDefault<z.ZodEnum<["DRAFT", "OPEN"]>>;
}, "strict", z.ZodTypeAny, {
    round_code: string;
    opens_at: string;
    closes_at: string;
    draws_at: string;
    status: "DRAFT" | "OPEN";
}, {
    round_code: string;
    opens_at: string;
    closes_at: string;
    draws_at: string;
    status?: "DRAFT" | "OPEN" | undefined;
}>;
export declare const patchRoundSchema: z.ZodObject<{
    opens_at: z.ZodOptional<z.ZodString>;
    closes_at: z.ZodOptional<z.ZodString>;
    draws_at: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<["DRAFT", "OPEN", "CLOSED", "CANCELLED"]>>;
}, "strict", z.ZodTypeAny, {
    opens_at?: string | undefined;
    closes_at?: string | undefined;
    draws_at?: string | undefined;
    status?: "DRAFT" | "OPEN" | "CLOSED" | "CANCELLED" | undefined;
}, {
    opens_at?: string | undefined;
    closes_at?: string | undefined;
    draws_at?: string | undefined;
    status?: "DRAFT" | "OPEN" | "CLOSED" | "CANCELLED" | undefined;
}>;
export declare const postResultSchema: z.ZodObject<{
    round_id: z.ZodString;
    result_6d: z.ZodString;
}, "strict", z.ZodTypeAny, {
    round_id: string;
    result_6d: string;
}, {
    round_id: string;
    result_6d: string;
}>;
export declare const createManualUserSchema: z.ZodObject<{
    username: z.ZodString;
    display_name: z.ZodString;
    password: z.ZodString;
}, "strict", z.ZodTypeAny, {
    username: string;
    display_name: string;
    password: string;
}, {
    username: string;
    display_name: string;
    password: string;
}>;
export declare const manualCreditChangeSchema: z.ZodObject<{
    manual_user_id: z.ZodString;
    amount: z.ZodNumber;
    reason: z.ZodString;
}, "strict", z.ZodTypeAny, {
    manual_user_id: string;
    amount: number;
    reason: string;
}, {
    manual_user_id: string;
    amount: number;
    reason: string;
}>;
export declare const quoteItemSchema: z.ZodObject<{
    bet_type: z.ZodEnum<["ONE_DIGIT", "TWO_STRAIGHT", "THREE_STRAIGHT", "FOUR_STRAIGHT", "FIVE_STRAIGHT", "SIX_STRAIGHT"]>;
    selection: z.ZodString;
    stake: z.ZodNumber;
}, "strict", z.ZodTypeAny, {
    bet_type: "ONE_DIGIT" | "TWO_STRAIGHT" | "THREE_STRAIGHT" | "FOUR_STRAIGHT" | "FIVE_STRAIGHT" | "SIX_STRAIGHT";
    selection: string;
    stake: number;
}, {
    bet_type: "ONE_DIGIT" | "TWO_STRAIGHT" | "THREE_STRAIGHT" | "FOUR_STRAIGHT" | "FIVE_STRAIGHT" | "SIX_STRAIGHT";
    selection: string;
    stake: number;
}>;
export declare const createQuoteSchema: z.ZodObject<{
    round_id: z.ZodString;
    payment_mode: z.ZodEnum<["MANUAL_CREDIT", "EXTERNAL_WALLET"]>;
    currency_code: z.ZodDefault<z.ZodString>;
    user_manual_id: z.ZodOptional<z.ZodString>;
    customer_ref: z.ZodOptional<z.ZodString>;
    wallet_account_ref: z.ZodOptional<z.ZodString>;
    external_txn_ref: z.ZodOptional<z.ZodString>;
    items: z.ZodArray<z.ZodObject<{
        bet_type: z.ZodEnum<["ONE_DIGIT", "TWO_STRAIGHT", "THREE_STRAIGHT", "FOUR_STRAIGHT", "FIVE_STRAIGHT", "SIX_STRAIGHT"]>;
        selection: z.ZodString;
        stake: z.ZodNumber;
    }, "strict", z.ZodTypeAny, {
        bet_type: "ONE_DIGIT" | "TWO_STRAIGHT" | "THREE_STRAIGHT" | "FOUR_STRAIGHT" | "FIVE_STRAIGHT" | "SIX_STRAIGHT";
        selection: string;
        stake: number;
    }, {
        bet_type: "ONE_DIGIT" | "TWO_STRAIGHT" | "THREE_STRAIGHT" | "FOUR_STRAIGHT" | "FIVE_STRAIGHT" | "SIX_STRAIGHT";
        selection: string;
        stake: number;
    }>, "many">;
}, "strict", z.ZodTypeAny, {
    round_id: string;
    payment_mode: "MANUAL_CREDIT" | "EXTERNAL_WALLET";
    currency_code: string;
    items: {
        bet_type: "ONE_DIGIT" | "TWO_STRAIGHT" | "THREE_STRAIGHT" | "FOUR_STRAIGHT" | "FIVE_STRAIGHT" | "SIX_STRAIGHT";
        selection: string;
        stake: number;
    }[];
    user_manual_id?: string | undefined;
    customer_ref?: string | undefined;
    wallet_account_ref?: string | undefined;
    external_txn_ref?: string | undefined;
}, {
    round_id: string;
    payment_mode: "MANUAL_CREDIT" | "EXTERNAL_WALLET";
    items: {
        bet_type: "ONE_DIGIT" | "TWO_STRAIGHT" | "THREE_STRAIGHT" | "FOUR_STRAIGHT" | "FIVE_STRAIGHT" | "SIX_STRAIGHT";
        selection: string;
        stake: number;
    }[];
    currency_code?: string | undefined;
    user_manual_id?: string | undefined;
    customer_ref?: string | undefined;
    wallet_account_ref?: string | undefined;
    external_txn_ref?: string | undefined;
}>;
export declare const confirmTicketSchema: z.ZodObject<{
    quote_id: z.ZodString;
}, "strict", z.ZodTypeAny, {
    quote_id: string;
}, {
    quote_id: string;
}>;
export declare const checkTicketSchema: z.ZodObject<{
    ticket_no: z.ZodString;
    public_check_token: z.ZodString;
}, "strict", z.ZodTypeAny, {
    ticket_no: string;
    public_check_token: string;
}, {
    ticket_no: string;
    public_check_token: string;
}>;
export declare const adminManualTicketSchema: z.ZodObject<{
    user_manual_id: z.ZodString;
    round_id: z.ZodString;
    currency_code: z.ZodDefault<z.ZodString>;
    customer_ref: z.ZodOptional<z.ZodString>;
    items: z.ZodArray<z.ZodObject<{
        bet_type: z.ZodEnum<["ONE_DIGIT", "TWO_STRAIGHT", "THREE_STRAIGHT", "FOUR_STRAIGHT", "FIVE_STRAIGHT", "SIX_STRAIGHT"]>;
        selection: z.ZodString;
        stake: z.ZodNumber;
    }, "strict", z.ZodTypeAny, {
        bet_type: "ONE_DIGIT" | "TWO_STRAIGHT" | "THREE_STRAIGHT" | "FOUR_STRAIGHT" | "FIVE_STRAIGHT" | "SIX_STRAIGHT";
        selection: string;
        stake: number;
    }, {
        bet_type: "ONE_DIGIT" | "TWO_STRAIGHT" | "THREE_STRAIGHT" | "FOUR_STRAIGHT" | "FIVE_STRAIGHT" | "SIX_STRAIGHT";
        selection: string;
        stake: number;
    }>, "many">;
    note: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    round_id: string;
    currency_code: string;
    user_manual_id: string;
    items: {
        bet_type: "ONE_DIGIT" | "TWO_STRAIGHT" | "THREE_STRAIGHT" | "FOUR_STRAIGHT" | "FIVE_STRAIGHT" | "SIX_STRAIGHT";
        selection: string;
        stake: number;
    }[];
    customer_ref?: string | undefined;
    note?: string | undefined;
}, {
    round_id: string;
    user_manual_id: string;
    items: {
        bet_type: "ONE_DIGIT" | "TWO_STRAIGHT" | "THREE_STRAIGHT" | "FOUR_STRAIGHT" | "FIVE_STRAIGHT" | "SIX_STRAIGHT";
        selection: string;
        stake: number;
    }[];
    currency_code?: string | undefined;
    customer_ref?: string | undefined;
    note?: string | undefined;
}>;
export declare function assertRoundTimeOrder(opensAt: string, closesAt: string, drawsAt: string): void;
