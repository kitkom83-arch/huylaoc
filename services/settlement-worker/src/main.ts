import { isTicketEligibleForSettlement } from "@lottery/domain";
import { PrismaClient } from "@prisma/client";

export interface SettlementPreflightReport {
  settlement_job_id: string;
  round_id: string;
  eligible_count: number;
  skipped_count: number;
  ticket_count: number;
}

export class SettlementPreflightService {
  constructor(private readonly prisma: PrismaClient = new PrismaClient()) {}

  async preflightSettlementJob(settlementJobId: string): Promise<SettlementPreflightReport> {
    const settlementJob = await this.prisma.settlementJob.findUnique({ where: { id: settlementJobId } });
    if (!settlementJob) {
      throw new Error("settlement job not found");
    }

    const tickets = await this.prisma.ticket.findMany({
      where: { round_id: settlementJob.round_id },
      select: { id: true, status: true, settlement_status: true, funding_status: true }
    });
    const eligibleCount = tickets.filter(isTicketEligibleForSettlement).length;

    return {
      settlement_job_id: settlementJob.id,
      round_id: settlementJob.round_id,
      eligible_count: eligibleCount,
      skipped_count: tickets.length - eligibleCount,
      ticket_count: tickets.length
    };
  }
}

export function describeSettlementWorker(): string {
  return "settlement-worker skeleton: preflight counts eligible tickets only; no payout or settlement calculation";
}

const executedPath = process.argv[1] ?? "";

if (executedPath.endsWith("services/settlement-worker/src/main.ts") || executedPath.endsWith("services\\settlement-worker\\src\\main.ts") || executedPath.endsWith("services/settlement-worker/dist/main.js") || executedPath.endsWith("services\\settlement-worker\\dist\\main.js")) {
  console.log(describeSettlementWorker());
}
