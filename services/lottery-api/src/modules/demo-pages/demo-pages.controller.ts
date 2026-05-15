import { Controller, Get, Header } from "@nestjs/common";
import { CatalogService } from "../catalog/catalog.service.js";
import { ResultsService } from "../results/results.service.js";
import { RoundsService } from "../rounds/rounds.service.js";
import type { RoundRecord } from "../store/records.js";

const prismaStudioCommand = "pnpm exec prisma studio --schema services/lottery-api/prisma/schema.prisma";
const workspacePath = String.raw`C:\Users\ADMIN\OneDrive\ผัวคนลาว`;

const p0BetTypes = [
  { code: "ONE_DIGIT", th: "1 ตัวท้าย", la: "1 ໂຕທ້າຍ" },
  { code: "TWO_STRAIGHT", th: "2 ตัวตรง", la: "2 ໂຕກົງ" },
  { code: "THREE_STRAIGHT", th: "3 ตัวตรง", la: "3 ໂຕກົງ" },
  { code: "FOUR_STRAIGHT", th: "4 ตัวตรง", la: "4 ໂຕກົງ" },
  { code: "FIVE_STRAIGHT", th: "5 ตัวตรง", la: "5 ໂຕກົງ" },
  { code: "SIX_STRAIGHT", th: "6 ตัวตรง", la: "6 ໂຕກົງ" }
];

const backofficeCards = ["งวดหวย", "ผลรางวัล", "Manual Users", "Topup / Deduct", "Tickets", "Wallet Outbox", "Settlement Preflight", "Audit Logs"];

const adminEndpoints = [
  "POST /v1/admin/rounds",
  "PATCH /v1/admin/rounds/:round_id",
  "POST /v1/admin/results",
  "POST /v1/admin/manual/users",
  "PATCH /v1/admin/manual/users/:user_id/status",
  "POST /v1/admin/manual/credits/topup",
  "POST /v1/admin/manual/credits/deduct",
  "GET /v1/admin/manual/credits/ledger",
  "POST /v1/admin/manual/tickets",
  "GET /v1/admin/tickets",
  "GET /v1/admin/audit-logs"
];

const publicEndpoints = [
  "GET /api/health",
  "GET /v1/catalog/bet-types",
  "GET /v1/rounds/current",
  "GET /v1/results/latest",
  "POST /v1/quotes",
  "POST /v1/tickets/confirm",
  "POST /v1/tickets/check"
];

const completedPhases = [
  {
    title: "Phase 0 — Project Foundation",
    status: "Done",
    items: [
      "Monorepo structure",
      "NestJS lottery-api service",
      "PostgreSQL / Redis Docker setup",
      "Prisma schema",
      "Initial migrations",
      "Seed P0 bet types",
      "Health endpoint",
      "Basic docs",
      "Basic tests"
    ]
  },
  {
    title: "Phase 0.5 — Persistence & Transaction Hardening",
    status: "Done",
    items: [
      "Replaced in-memory runtime repository with Prisma/PostgreSQL",
      "DB-backed idempotency",
      "Manual credit transaction handling",
      "SELECT FOR UPDATE row locking",
      "credit_ledger append-only repository",
      "audit_logs append-only repository",
      "topup/deduct transaction tests",
      "migration/seed tests"
    ]
  },
  {
    title: "Phase 1.0 — Quote + Ticket Lifecycle",
    status: "Done",
    items: [
      "POST /v1/quotes",
      "POST /v1/tickets/confirm",
      "POST /v1/tickets/check",
      "GET /v1/admin/tickets",
      "POST /v1/admin/manual/tickets",
      "Manual credit ticket debit via BET_DEBIT",
      "External wallet WALLET_DEBIT outbox creation",
      "Ticket items persistence",
      "public_check_token check flow",
      "ticket lifecycle tests"
    ]
  },
  {
    title: "Phase 1.1 — Token Replay + Settlement Preconditions",
    status: "Done",
    items: [
      "deterministic HMAC public_check_token",
      "idempotency replay can reconstruct usable token",
      "wrong token does not leak ticket details",
      "isTicketEligibleForSettlement",
      "wallet outbox state transitions",
      "WALLET_DEBIT SUCCEEDED updates ticket funding_status",
      "WALLET_DEBIT FAILED/UNKNOWN keeps ticket ineligible",
      "settlement preflight eligible/skipped counts",
      "tests passed: 41 tests"
    ]
  }
];

const remainingPhases = [
  {
    title: "Phase 1.2 — Local Demo Runner + Browser Pages",
    status: "Current",
    items: [
      "Fix dev:api startup",
      "Add GET /",
      "Add /demo/customer-th",
      "Add /demo/customer-la",
      "Add /demo/backoffice",
      "Add /demo/project-overview",
      "Add tests for demo pages"
    ]
  },
  {
    title: "Phase 1.5 — Actual Settlement Worker",
    status: "Remaining",
    items: [
      "Load settlement job",
      "Load eligible tickets only",
      "Compare ticket_items against result outcomes",
      "Mark ticket_items win/loss",
      "Update ticket settlement_status WON/LOST",
      "Calculate payout_total",
      "Manual credit winners receive PAYOUT_CREDIT ledger",
      "External wallet winners create WALLET_CREDIT outbox",
      "Prevent duplicate payout",
      "Retry safely"
    ]
  },
  {
    title: "Phase 1.6 — Wallet Outbox Worker Hardening",
    status: "Remaining",
    items: [
      "Process WALLET_DEBIT outbox with external wallet interface mock",
      "Process WALLET_CREDIT outbox with external wallet interface mock",
      "Reconciliation for UNKNOWN status",
      "Retry/backoff rules",
      "No real wallet calls yet unless explicitly requested later"
    ]
  },
  {
    title: "Phase 2.0 — Backoffice UI MVP",
    status: "Remaining",
    items: [
      "Login page placeholder",
      "Dashboard",
      "Round management",
      "Result posting",
      "Manual user management",
      "Topup / Deduct form",
      "Manual ticket entry form",
      "Ticket search",
      "Ledger viewer",
      "Audit log viewer"
    ]
  },
  {
    title: "Phase 2.1 — P1 Bet Types",
    status: "Remaining",
    items: ["TWO_BOX", "THREE_BOX", "HIGH_LOW", "ODD_EVEN", "Rule plugin implementation", "New validations", "New settlement logic", "New tests"]
  },
  {
    title: "Phase 2.2 — Reports",
    status: "Remaining",
    items: ["Round summary", "Ticket summary", "Manual credit report", "Wallet outbox report", "Win/loss report", "Export CSV"]
  },
  {
    title: "Phase 3.0 — Production Hardening",
    status: "Remaining",
    items: [
      "Real auth flow",
      "MFA for high-risk admin actions",
      "Rate limiting",
      "Secrets management",
      "Token secret rotation",
      "Deployment config",
      "Observability/logging dashboard",
      "Backup/restore plan",
      "Security review"
    ]
  }
];

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function list(items: string[]): string {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function endpointList(items: string[]): string {
  return `<ul class="endpoint-list">${items.map((item) => `<li><code>${escapeHtml(item)}</code></li>`).join("")}</ul>`;
}

function statusBadge(status: string): string {
  return `<span class="badge ${status.toLowerCase()}">${escapeHtml(status)}</span>`;
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #0f172a; color: #f8fafc; }
    main { max-width: 1160px; margin: 0 auto; padding: 40px 20px 56px; }
    h1 { margin: 0 0 16px; font-size: 34px; line-height: 1.15; letter-spacing: 0; }
    h2 { margin: 30px 0 12px; font-size: 22px; letter-spacing: 0; }
    h3 { margin: 0 0 10px; font-size: 17px; letter-spacing: 0; }
    p { color: #d1d5db; line-height: 1.7; }
    a { color: #93c5fd; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin: 18px 0; }
    .tile { border: 1px solid #374151; background: #1f2937; border-radius: 8px; padding: 14px 16px; min-height: 44px; }
    .muted { color: #9ca3af; }
    .badge { display: inline-block; border: 1px solid #f59e0b; color: #fbbf24; border-radius: 999px; padding: 4px 10px; font-weight: 700; }
    .badge.done { border-color: #22c55e; color: #86efac; }
    .badge.current { border-color: #38bdf8; color: #7dd3fc; }
    .badge.remaining { border-color: #f59e0b; color: #fbbf24; }
    .phase-list { display: grid; gap: 10px; margin: 18px 0; }
    .phase { display: flex; align-items: center; justify-content: space-between; gap: 12px; border: 1px solid #374151; background: #1f2937; border-radius: 8px; padding: 12px 14px; }
    .phase strong { font-size: 16px; }
    code { display: block; white-space: pre-wrap; overflow-wrap: anywhere; background: #030712; border: 1px solid #374151; border-radius: 8px; padding: 14px; color: #e5e7eb; }
    ul { padding-left: 20px; line-height: 1.9; }
    table { width: 100%; border-collapse: collapse; overflow: hidden; border-radius: 8px; border: 1px solid #334155; }
    th, td { text-align: left; border-bottom: 1px solid #334155; padding: 12px; vertical-align: top; }
    th { background: #1e293b; color: #e2e8f0; }
    tr:last-child td { border-bottom: 0; }
    input { width: 100%; margin-top: 8px; padding: 10px 12px; border-radius: 8px; border: 1px solid #475569; background: #020617; color: #e2e8f0; }
    label { display: block; margin-top: 10px; color: #cbd5e1; }
  </style>
</head>
<body>
  <main>${body}</main>
</body>
</html>`;
}

function formatRound(round: RoundRecord | null, emptyText: string): string {
  if (!round) {
    return `<p>${escapeHtml(emptyText)}</p>`;
  }
  return `<table>
    <tbody>
      <tr><th>Round</th><td>${escapeHtml(round.round_code)}</td></tr>
      <tr><th>Status</th><td>${escapeHtml(round.status)}</td></tr>
      <tr><th>Open</th><td>${escapeHtml(round.opens_at)}</td></tr>
      <tr><th>Close</th><td>${escapeHtml(round.closes_at)}</td></tr>
      <tr><th>Draw</th><td>${escapeHtml(round.draws_at)}</td></tr>
    </tbody>
  </table>`;
}

function formatResult(result: { result_6d?: unknown; created_at?: unknown } | null, emptyText: string): string {
  if (!result) {
    return `<p>${escapeHtml(emptyText)}</p>`;
  }
  return `<table>
    <tbody>
      <tr><th>Result</th><td>${escapeHtml(result.result_6d ?? "-")}</td></tr>
      <tr><th>Posted</th><td>${escapeHtml(result.created_at ?? "-")}</td></tr>
    </tbody>
  </table>`;
}

function phaseCard(phase: { title: string; status: string; items: string[] }): string {
  return `<section class="card">
    <div class="topbar"><h3>${escapeHtml(phase.title)}</h3>${statusBadge(phase.status)}</div>
    ${list(phase.items)}
  </section>`;
}

@Controller()
export class DemoPagesController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly rounds: RoundsService,
    private readonly results: ResultsService
  ) {}

  @Get("/")
  @Header("content-type", "text/html; charset=utf-8")
  root(): string {
    return page(
      "Lottery Game Engine Demo",
      `<h1>Lottery Game Engine Demo</h1>
      <p class="muted">หน้าเริ่มต้นภาษาไทยสำหรับทดสอบระบบ Lottery Game Engine API-first ในเครื่อง</p>
      <h2>API Status</h2>
      <div class="grid">${["/api/health", "/v1/catalog/bet-types", "/v1/rounds/current", "/v1/results/latest"].map((href) => `<a class="tile" href="${href}">${href}</a>`).join("")}</div>
      <h2>Demo Pages</h2>
      <div class="grid">
        <a class="tile" href="/demo/customer-th">/demo/customer-th</a>
        <a class="tile" href="/demo/customer-la">/demo/customer-la</a>
        <a class="tile" href="/demo/backoffice">/demo/backoffice</a>
        <a class="tile" href="/demo/project-overview">/demo/project-overview</a>
        <a class="tile" href="/demo/settlement-center">/demo/settlement-center</a>
      </div>
      <h2>Prisma Studio</h2>
      <p class="muted">ใช้คำสั่งนี้เพื่อเปิดดูข้อมูลในฐานข้อมูลระหว่างทดสอบ</p>
      <code>${prismaStudioCommand}</code>`
    );
  }

  @Get("/demo/customer-th")
  @Header("content-type", "text/html; charset=utf-8")
  async customerThai(): Promise<string> {
    const { round, result } = await this.loadDemoData();
    return page(
      "หน้าเดโมลูกค้า หวยลาว",
      `<h1>หน้าเดโมลูกค้า หวยลาว</h1>
      <span class="badge notice">18+</span>
      <div class="grid">
        <section class="card"><h2>งวดที่เปิดอยู่</h2>${formatRound(round, "ยังไม่พบงวดที่เปิดอยู่")}</section>
        <section class="card"><h2>ผลล่าสุด</h2>${formatResult(result, "ยังไม่พบผลล่าสุด")}</section>
      </div>
      <section class="card">
        <h2>ประเภทหวย P0</h2>
        <div class="grid">${p0BetTypes.map((item) => `<div class="tile"><strong>${escapeHtml(item.th)}</strong><p class="muted">${escapeHtml(item.code)}</p></div>`).join("")}</div>
      </section>
      <div class="two-col">
        <section class="card"><h2>ตัวอย่างบิล</h2><p>เลขบิล DEMO-0001</p><p>รายการ: 2 ตัวตรง 12, เดิมพัน 10 THB, สถานะรอผล</p></section>
        <section class="card">
          <h2>ช่องตรวจบิล mock</h2>
          <label>เลขบิล<input placeholder="DEMO-0001" readonly /></label>
          <label>public_check_token<input placeholder="mock field only, never display real tokens" readonly /></label>
        </section>
      </div>
      <p><a href="/">กลับหน้าแรก</a></p>`
    );
  }

  @Get("/demo/customer-la")
  @Header("content-type", "text/html; charset=utf-8")
  async customerLao(): Promise<string> {
    const { round, result } = await this.loadDemoData();
    return page(
      "ໜ້າສາທິດລູກຄ້າ ຫວຍລາວ",
      `<h1>ໜ້າສາທິດລູກຄ້າ ຫວຍລາວ</h1>
      <span class="badge notice">18+</span>
      <div class="grid">
        <section class="card"><h2>ງວດທີ່ເປີດ</h2>${formatRound(round, "ຍັງບໍ່ມີງວດທີ່ເປີດ")}</section>
        <section class="card"><h2>ຜົນລ່າສຸດ</h2>${formatResult(result, "ຍັງບໍ່ມີຜົນລ່າສຸດ")}</section>
      </div>
      <section class="card">
        <h2>ປະເພດຫວຍ</h2>
        <div class="grid">${p0BetTypes.map((item) => `<div class="tile"><strong>${escapeHtml(item.la)}</strong><p class="muted">${escapeHtml(item.code)}</p></div>`).join("")}</div>
      </section>
      <div class="two-col">
        <section class="card"><h2>ຕົວຢ່າງບິນ</h2><p>ເລກບິນ DEMO-0001</p><p>ລາຍການ: 2 ໂຕກົງ 12, ເດີມພັນ 10 THB</p></section>
        <section class="card">
          <h2>ເຊັກບິນ</h2>
          <label>ເລກບິນ<input placeholder="DEMO-0001" readonly /></label>
          <label>public_check_token<input placeholder="mock field only, never display real tokens" readonly /></label>
        </section>
      </div>
      <p><a href="/">ກັບໜ້າຫຼັກ</a></p>`
    );
  }

  @Get("/demo/backoffice")
  @Header("content-type", "text/html; charset=utf-8")
  backoffice(): string {
    return page(
      "Backoffice Demo",
      `<h1>Backoffice Demo</h1>
      <p class="muted">หน้าเดโมสำหรับอธิบาย Manual Backoffice เท่านั้น ยังไม่มี login UI หรือปุ่ม mutation</p>
      <div class="grid">${backofficeCards.map((card) => `<section class="tile">${escapeHtml(card)}</section>`).join("")}</div>
      <h2>Important Admin Endpoints</h2>
      ${endpointList(adminEndpoints)}
      <h2>Links</h2>
      <div class="grid">
        <a class="tile" href="/demo/settlement-center">/demo/settlement-center</a>
      </div>
      <p><a href="/">Back to /</a></p>`
    );
  }

  @Get("/demo/settlement-center")
  @Header("content-type", "text/html; charset=utf-8")
  settlementCenter(): string {
    return page(
      "Settlement Center Demo",
      `<h1>ศูนย์ตรวจผลและจ่ายรางวัล</h1>
      <p class="muted">Settlement Center Demo</p>

      <h2>Summary Cards</h2>
      <div class="grid">
        <section class="card"><h3>Eligible Tickets</h3><p class="metric">Tickets that passed funding and preflight checks.</p></section>
        <section class="card"><h3>Result Posted</h3><p class="metric">Round result is available before settlement runs.</p></section>
        <section class="card"><h3>Payout Queue</h3><p class="metric">Winning tickets are prepared for credit handling.</p></section>
      </div>

      <h2>Settlement Flow</h2>
      ${list([
        "Load the posted round result.",
        "Find Eligible Tickets for the settled round.",
        "Compare ticket items with the result outcome.",
        "Mark losing tickets closed and winning tickets ready for payout.",
        "Create the correct credit event for each winning funding mode."
      ])}

      <h2>Eligibility Rules</h2>
      ${list([
        "Ticket status must be CONFIRMED.",
        "Funding must be completed before result settlement.",
        "Tickets with failed, unknown, or pending wallet debit are skipped.",
        "Settlement should be idempotent and avoid duplicate payouts."
      ])}

      <h2>Result Example</h2>
      <table>
        <tbody>
          <tr><th>Round</th><td>DEMO-ROUND-001</td></tr>
          <tr><th>Result</th><td>123456</td></tr>
          <tr><th>Outcome</th><td>2 ตัวตรง = 56, 3 ตัวตรง = 456</td></tr>
        </tbody>
      </table>

      <h2>Ticket Settlement Example</h2>
      <table>
        <thead>
          <tr><th>Ticket</th><th>Bet Type</th><th>Pick</th><th>Status</th></tr>
        </thead>
        <tbody>
          <tr><td>DEMO-TICKET-1001</td><td>TWO_STRAIGHT</td><td>56</td><td>WON</td></tr>
          <tr><td>DEMO-TICKET-1002</td><td>THREE_STRAIGHT</td><td>111</td><td>LOST</td></tr>
        </tbody>
      </table>

      <h2>Payout Handling</h2>
      <div class="two-col">
        <section class="card"><h3>Manual Credit</h3><p>Create a <strong>PAYOUT_CREDIT</strong> ledger entry for manual-credit winners.</p></section>
        <section class="card"><h3>External Wallet</h3><p>Create a <strong>WALLET_CREDIT</strong> outbox event for external-wallet winners.</p></section>
      </div>

      <h2>Safety Notes</h2>
      ${list([
        "This page is UI-only documentation for local demo monitoring.",
        "It does not execute settlement, wallet, deposit, withdraw, or payout mutations.",
        "Use settlement and wallet workers only through their tested backend paths."
      ])}

      <h2>Links</h2>
      <div class="grid">
        <a class="tile" href="/">/</a>
        <a class="tile" href="/demo/project-overview">/demo/project-overview</a>
        <a class="tile" href="/demo/backoffice">/demo/backoffice</a>
      </div>`
    );
  }

  @Get("/demo/project-overview")
  @Header("content-type", "text/html; charset=utf-8")
  projectOverview(): string {
    return page(
      "ภาพรวมโปรเจกต์ Lottery Game Engine",
      `<h1>ภาพรวมโปรเจกต์ Lottery Game Engine</h1>
      <p class="muted">ภาพรวมสำหรับอธิบายสถานะงานให้ลูกค้าเห็นว่าอะไรเสร็จแล้ว อะไรยังเหลือ และระบบนี้ยังเป็น demo ในเครื่อง</p>

      <h2>Current System Status</h2>
      <div class="grid">
        <section class="card"><h3>Project Type</h3><p class="metric">Lottery Game Engine API-first</p></section>
        <section class="card"><h3>Wallet Mode</h3><p class="metric">EXTERNAL_WALLET + MANUAL_CREDIT</p></section>
        <section class="card"><h3>Database</h3><p class="metric">PostgreSQL / Prisma</p></section>
        <section class="card"><h3>API Status</h3><p class="metric">Ready for local testing</p></section>
        <section class="card"><h3>Worker Status</h3><p class="metric">Skeleton / Preflight only</p></section>
        <section class="card"><h3>UI Status</h3><p class="metric">Demo pages only</p></section>
        <section class="card"><h3>Test Status</h3><p class="metric">latest known 41 tests passed</p></section>
        <section class="card"><h3>Production Status</h3><p class="metric">Not production-ready yet</p></section>
      </div>

      <h2>Completed Work</h2>
      <div class="two-col">${completedPhases.map(phaseCard).join("")}</div>

      <h2>Remaining Work</h2>
      <div class="two-col">${remainingPhases.map(phaseCard).join("")}</div>

      <h2>API Inventory</h2>
      <div class="two-col">
        <section class="card"><h3>Public APIs</h3>${endpointList(publicEndpoints)}</section>
        <section class="card"><h3>Admin APIs</h3>${endpointList(["POST /v1/admin/rounds", "PATCH /v1/admin/rounds/:round_id", "POST /v1/admin/results", "GET /v1/admin/settlements/:job_id", ...adminEndpoints.slice(3)])}</section>
      </div>

      <h2>Local Commands</h2>
      <code>cd "${escapeHtml(workspacePath)}"

docker compose -p lottery-engine up -d postgres redis
pnpm prisma:generate
pnpm db:migrate
pnpm db:seed
pnpm -w run dev:api</code>
      <h3>Open</h3>
      <code>http://localhost:3000/
http://localhost:3000/demo/project-overview
http://localhost:3000/demo/customer-th
http://localhost:3000/demo/customer-la
http://localhost:3000/demo/backoffice
http://localhost:3000/demo/settlement-center</code>

      <h2>Demo Links</h2>
      <div class="grid">
        <a class="tile" href="/demo/settlement-center">/demo/settlement-center</a>
      </div>

      <h2>Important Safety Notes</h2>
      ${list([
        "This is a game engine demo.",
        "No deposit/withdraw is implemented.",
        "No real wallet call is implemented.",
        "No real payment processing is implemented.",
        "Use only where legally allowed and licensed.",
        "18+ notice."
      ])}
      <p><a href="/">กลับหน้าแรก</a></p>`
    );
  }

  private async loadDemoData(): Promise<{ round: RoundRecord | null; result: { result_6d?: unknown; created_at?: unknown } | null }> {
    try {
      await this.catalog.listBetTypes();
      const [round, result] = await Promise.all([this.rounds.current(), this.results.latest()]);
      return { round, result };
    } catch {
      return { round: null, result: null };
    }
  }
}
