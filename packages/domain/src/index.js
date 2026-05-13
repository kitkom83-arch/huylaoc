import { z } from "zod";
export const betTypeCodes = [
    "ONE_DIGIT",
    "TWO_STRAIGHT",
    "THREE_STRAIGHT",
    "FOUR_STRAIGHT",
    "FIVE_STRAIGHT",
    "SIX_STRAIGHT"
];
export const betTypeDigits = {
    ONE_DIGIT: 1,
    TWO_STRAIGHT: 2,
    THREE_STRAIGHT: 3,
    FOUR_STRAIGHT: 4,
    FIVE_STRAIGHT: 5,
    SIX_STRAIGHT: 6
};
export function isTicketEligibleForSettlement(ticket) {
    return (ticket.status === "CONFIRMED" &&
        ticket.settlement_status === "PENDING" &&
        (ticket.funding_status === "DEBITED" || ticket.funding_status === "SUCCEEDED"));
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
export const patchRoundSchema = z
    .object({
    opens_at: z.string().datetime().optional(),
    closes_at: z.string().datetime().optional(),
    draws_at: z.string().datetime().optional(),
    status: z.enum(["DRAFT", "OPEN", "CLOSED", "CANCELLED"]).optional()
})
    .strict();
export const postResultSchema = z
    .object({
    round_id: z.string().min(1),
    result_6d: result6dSchema
})
    .strict();
export const createManualUserSchema = z
    .object({
    username: z.string().min(3).max(64),
    display_name: z.string().min(1).max(128),
    password: z.string().min(10).max(256)
})
    .strict();
export const manualCreditChangeSchema = z
    .object({
    manual_user_id: z.string().min(1),
    amount: z.number().positive(),
    reason: z.string().min(1).max(256)
})
    .strict();
export const quoteItemSchema = z
    .object({
    bet_type: z.enum(betTypeCodes),
    selection: z.string().min(1).max(6),
    stake: z.number().positive()
})
    .strict();
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
export const confirmTicketSchema = z
    .object({
    quote_id: z.string().min(1)
})
    .strict();
export const checkTicketSchema = z
    .object({
    ticket_no: z.string().min(1),
    public_check_token: z.string().min(1)
})
    .strict();
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
export function assertRoundTimeOrder(opensAt, closesAt, drawsAt) {
    if (!(Date.parse(opensAt) < Date.parse(closesAt) && Date.parse(closesAt) <= Date.parse(drawsAt))) {
        throw new Error("round time order must be opens_at < closes_at <= draws_at");
    }
}
//# sourceMappingURL=index.js.map