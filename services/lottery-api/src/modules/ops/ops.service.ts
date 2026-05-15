import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

type StatusSummary = Record<string, number>;
type WorkerSectionReport = Record<string, unknown>;

export interface OperationalRunReport {
  wallet_recovery: WorkerSectionReport;
  wallet_processing: WorkerSectionReport;
  wallet_reconciliation: WorkerSectionReport;
  settlement_recovery: WorkerSectionReport;
  settlement_processing: WorkerSectionReport;
  started_at: string;
  finished_at: string;
  duration_ms: number;
}

export interface WorkerSchedulerStatus {
  enabled: boolean;
  running: boolean;
  interval_ms: number;
  last_error?: string;
}

interface SchedulerOptions {
  runImmediately?: boolean;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value.toLowerCase() === "true";
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function emptySettlementProcessingReport(): WorkerSectionReport {
  return {
    settlement_job_id: null,
    round_id: null,
    status: "IDLE",
    scanned_count: 0,
    claimed_count: 0,
    processed_count: 0,
    succeeded_count: 0,
    failed_count: 0,
    unknown_count: 0,
    retried_count: 0,
    skipped_count: 0,
    stale_recovered_count: 0,
    tickets_total: 0,
    tickets_done: 0,
    winners_found: 0,
    payouts_succeeded: 0,
    payouts_failed: 0
  };
}

function sanitizeError(error: unknown): string {
  return (error instanceof Error ? error.message : "worker scheduler failed").slice(0, 500);
}

const walletWorkerModulePath = "../../../../wallet-outbox-worker/dist/main.js";
const settlementWorkerModulePath = "../../../../settlement-worker/dist/main.js";

@Injectable()
export class OpsService implements OnModuleInit, OnModuleDestroy {
  private readonly schedulerEnabled: boolean;
  private readonly schedulerIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private tickInFlight = false;
  private lastError: string | undefined;
  private lastRun: OperationalRunReport | null = null;

  constructor(private readonly prisma: PrismaService) {
    this.schedulerEnabled = parseBoolean(process.env.WORKER_SCHEDULER_ENABLED, false);
    this.schedulerIntervalMs = parsePositiveInteger(process.env.WORKER_INTERVAL_MS, 30_000);
  }

  onModuleInit(): void {
    if (this.schedulerEnabled) {
      this.startScheduler();
    }
  }

  onModuleDestroy(): void {
    this.stopScheduler();
  }

  async runOneCycle(): Promise<OperationalRunReport> {
    const started = new Date();
    const { WalletOutboxWorkerService } = await import(walletWorkerModulePath);
    const { SettlementWorkerService } = await import(settlementWorkerModulePath);
    const walletWorker = new WalletOutboxWorkerService(this.prisma);
    const settlementWorker = new SettlementWorkerService(this.prisma);

    const walletRecovery = await walletWorker.recoverStaleProcessingRows();
    const walletProcessing = await walletWorker.processPendingOutboxRows();
    const walletReconciliation = await walletWorker.reconcileUnknownOutboxRows();
    const settlementRecovery = await settlementWorker.recoverStaleProcessingJobs();
    let settlementProcessing: WorkerSectionReport;
    try {
      settlementProcessing = await settlementWorker.settleQueuedJob();
    } catch (error) {
      if (error instanceof Error && error.message === "queued settlement job not found") {
        settlementProcessing = emptySettlementProcessingReport();
      } else {
        throw error;
      }
    }

    const finished = new Date();
    this.lastError = undefined;
    this.lastRun = {
      wallet_recovery: walletRecovery,
      wallet_processing: walletProcessing,
      wallet_reconciliation: walletReconciliation,
      settlement_recovery: settlementRecovery,
      settlement_processing: settlementProcessing,
      started_at: started.toISOString(),
      finished_at: finished.toISOString(),
      duration_ms: Math.max(0, finished.getTime() - started.getTime())
    };
    return this.lastRun;
  }

  startScheduler(options: SchedulerOptions = {}): WorkerSchedulerStatus {
    if (this.timer) {
      return this.getSchedulerStatus();
    }

    const runTick = (): void => {
      if (this.tickInFlight) {
        return;
      }
      this.tickInFlight = true;
      this.runOneCycle()
        .catch((error) => {
          this.lastError = sanitizeError(error);
        })
        .finally(() => {
          this.tickInFlight = false;
        });
    };

    this.timer = setInterval(runTick, this.schedulerIntervalMs);
    this.timer.unref?.();
    if (options.runImmediately) {
      runTick();
    }
    return this.getSchedulerStatus();
  }

  stopScheduler(): WorkerSchedulerStatus {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    return this.getSchedulerStatus();
  }

  getSchedulerStatus(): WorkerSchedulerStatus {
    return {
      enabled: this.schedulerEnabled,
      running: this.timer !== undefined,
      interval_ms: this.schedulerIntervalMs,
      ...(this.lastError ? { last_error: this.lastError } : {})
    };
  }

  getLastRun(): OperationalRunReport | null {
    return this.lastRun;
  }

  async getWalletOutboxSummaryByStatus(): Promise<StatusSummary> {
    const rows = await this.prisma.walletOutbox.groupBy({
      by: ["status"],
      _count: { _all: true }
    });
    return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
  }

  async getSettlementJobSummaryByStatus(): Promise<StatusSummary> {
    const rows = await this.prisma.settlementJob.groupBy({
      by: ["status"],
      _count: { _all: true }
    });
    return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
  }

  async walletOutboxSummary() {
    return {
      status_counts: await this.getWalletOutboxSummaryByStatus(),
      last_run: this.lastRun,
      scheduler: this.getSchedulerStatus()
    };
  }

  async settlementJobsSummary() {
    return {
      status_counts: await this.getSettlementJobSummaryByStatus(),
      last_run: this.lastRun,
      scheduler: this.getSchedulerStatus()
    };
  }

  workerLastRun() {
    return {
      last_run: this.lastRun,
      scheduler: this.getSchedulerStatus()
    };
  }
}
