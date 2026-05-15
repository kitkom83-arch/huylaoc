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
    .hero { margin-bottom: 26px; }
    .hero .eyebrow { margin: 0 0 8px; color: #7dd3fc; font-weight: 800; text-transform: uppercase; letter-spacing: 0; }
    .hero p { max-width: 860px; margin: 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin: 18px 0; }
    .summary-grid { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
    .two-col { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin: 18px 0; }
    .card { border: 1px solid #374151; background: #111827; border-radius: 8px; padding: 16px; }
    .tile { border: 1px solid #374151; background: #1f2937; border-radius: 8px; padding: 14px 16px; min-height: 44px; }
    .metric { margin: 0; color: #f8fafc; font-size: 26px; font-weight: 800; line-height: 1.2; }
    .metric-label { margin: 0 0 10px; color: #cbd5e1; font-weight: 700; line-height: 1.35; }
    .muted { color: #9ca3af; }
    .badge { display: inline-block; border: 1px solid #f59e0b; color: #fbbf24; border-radius: 999px; padding: 4px 10px; font-weight: 700; }
    .badge.won { border-color: #22c55e; color: #86efac; }
    .badge.lost { border-color: #94a3b8; color: #cbd5e1; }
    .badge.skipped { border-color: #f59e0b; color: #fbbf24; }
    .badge.mode { border-color: #38bdf8; color: #7dd3fc; }
    .badge.pending { border-color: #f59e0b; color: #fbbf24; }
    .badge.processing { border-color: #38bdf8; color: #7dd3fc; }
    .badge.sent { border-color: #22c55e; color: #86efac; }
    .badge.failed { border-color: #ef4444; color: #fca5a5; }
    .badge.duplicate { border-color: #a855f7; color: #d8b4fe; }
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
    @media (max-width: 760px) {
      main { padding: 28px 14px 44px; }
      h1 { font-size: 28px; }
      .two-col { grid-template-columns: 1fr; }
      table { display: block; overflow-x: auto; white-space: nowrap; }
    }
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
        <a class="tile" href="/demo/wallet-outbox-monitor">/demo/wallet-outbox-monitor</a>
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
        <a class="tile" href="/demo/wallet-outbox-monitor">/demo/wallet-outbox-monitor</a>
      </div>
      <p><a href="/">Back to /</a></p>`
    );
  }

  @Get("/demo/settlement-center")
  @Header("content-type", "text/html; charset=utf-8")
  settlementCenter(): string {
    return page(
      "Settlement Center Demo",
      `<section class="hero">
        <p class="eyebrow">Settlement Center Demo</p>
        <h1>ศูนย์ตรวจผลและจ่ายรางวัล</h1>
        <p class="muted">หน้าเดโมสำหรับดูภาพรวมการตรวจบิล คัดกรองบิลที่พร้อมตรวจ และเตรียมจ่ายรางวัล</p>
      </section>

      <h2>Summary Cards</h2>
      <div class="grid summary-grid">
        <section class="card"><p class="metric-label">งาน Settlement ทั้งหมด</p><p class="metric">3</p></section>
        <section class="card"><p class="metric-label">บิลที่พร้อมตรวจ / Eligible Tickets</p><p class="metric">128</p></section>
        <section class="card"><p class="metric-label">บิลที่ถูกข้าม / Skipped Tickets</p><p class="metric">12</p></section>
        <section class="card"><p class="metric-label">บิลถูกรางวัล / Winners</p><p class="metric">9</p></section>
        <section class="card"><p class="metric-label">บิลไม่ถูกรางวัล / Losers</p><p class="metric">119</p></section>
        <section class="card"><p class="metric-label">ยอดจ่ายรวม / Payout Total</p><p class="metric">15,420.00</p></section>
        <section class="card"><p class="metric-label">Manual Payout / Manual Credit Paid</p><p class="metric">8,200.00</p></section>
        <section class="card"><p class="metric-label">Wallet Outbox Credit / Wallet Credit Pending</p><p class="metric">7,220.00</p></section>
      </div>

      <h2>Settlement Flow</h2>
      ${list([
        "รับผลรางวัล 6 หลัก",
        "แตกผลเป็น 1/2/3/4/5/6 ตัวท้าย",
        "โหลดบิลที่ funding สำเร็จเท่านั้น",
        "ตรวจ ticket_items ว่าชนะหรือแพ้",
        "จ่าย Manual Credit หรือสร้าง Wallet Credit Outbox"
      ])}

      <h2>Eligibility Rules</h2>
      <table>
        <thead>
          <tr><th>Eligible</th><th>Skipped</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>${list(["ticket.status = CONFIRMED", "settlement_status = PENDING", "funding_status = DEBITED or SUCCEEDED"])}</td>
            <td>${list(["funding_status = PENDING", "funding_status = FAILED", "funding_status = UNKNOWN", "ticket already settled", "rejected/cancelled ticket"])}</td>
          </tr>
        </tbody>
      </table>

      <h2>Result Example</h2>
      <table>
        <tbody>
          <tr><th>result_6d</th><td>255480</td></tr>
          <tr><th>1 ตัวท้าย</th><td>1 ตัวท้าย = 0</td></tr>
          <tr><th>2 ตัวตรง</th><td>2 ตัวตรง = 80</td></tr>
          <tr><th>3 ตัวตรง</th><td>3 ตัวตรง = 480</td></tr>
          <tr><th>4 ตัวตรง</th><td>4 ตัวตรง = 5480</td></tr>
          <tr><th>5 ตัวตรง</th><td>5 ตัวตรง = 55480</td></tr>
          <tr><th>6 ตัวตรง</th><td>6 ตัวตรง = 255480</td></tr>
        </tbody>
      </table>

      <h2>Ticket Settlement Example</h2>
      <table>
        <thead>
          <tr><th>ticket_no</th><th>mode</th><th>funding</th><th>selection</th><th>result</th><th>status</th><th>payout</th></tr>
        </thead>
        <tbody>
          <tr><td>L260512000123</td><td><span class="badge mode">MANUAL_CREDIT</span></td><td>DEBITED</td><td>TWO_STRAIGHT 80</td><td>tail2 80</td><td><span class="badge won">WON</span></td><td>1,200.00</td></tr>
          <tr><td>L260512000124</td><td><span class="badge mode">EXTERNAL_WALLET</span></td><td>SUCCEEDED</td><td>THREE_STRAIGHT 123</td><td>tail3 480</td><td><span class="badge lost">LOST</span></td><td>0.00</td></tr>
          <tr><td>L260512000125</td><td><span class="badge mode">EXTERNAL_WALLET</span></td><td>PENDING</td><td>TWO_STRAIGHT 80</td><td>skipped</td><td><span class="badge skipped">SKIPPED</span></td><td>-</td></tr>
        </tbody>
      </table>

      <h2>Payout Handling</h2>
      <div class="two-col">
        <section class="card"><h3>Manual Credit</h3>${list(["Insert PAYOUT_CREDIT ledger", "Increase credit_accounts.balance", "Write audit log", "Must not pay twice"])}</section>
        <section class="card"><h3>External Wallet</h3>${list(["Create WALLET_CREDIT outbox", "Do not call real wallet in this phase", "Retry safely", "Must not create duplicate outbox"])}</section>
      </div>

      <h2>Safety Notes</h2>
      ${list([
        "No real wallet call",
        "No deposit/withdraw",
        "No real payment processing",
        "Settlement must be idempotent",
        "Payout must not duplicate on retry",
        "18+ notice"
      ])}

      <h2>Links</h2>
      <div class="grid">
        <a class="tile" href="/">/</a>
        <a class="tile" href="/demo/project-overview">/demo/project-overview</a>
        <a class="tile" href="/demo/backoffice">/demo/backoffice</a>
        <a class="tile" href="/demo/wallet-outbox-monitor">/demo/wallet-outbox-monitor</a>
        <a class="tile" href="/api/health">/api/health</a>
      </div>`
    );
  }

  @Get("/demo/wallet-outbox-monitor")
  @Header("content-type", "text/html; charset=utf-8")
  walletOutboxMonitor(): string {
    return page(
      "Wallet Outbox Monitor Demo",
      `<section class="hero">
        <p class="eyebrow">Wallet Outbox Monitor Demo</p>
        <h1>ศูนย์ติดตาม Wallet Outbox</h1>
        <p class="muted">หน้าเดโมสำหรับดูสถานะรายการจ่ายรางวัลผ่าน WALLET_CREDIT outbox ก่อนส่งไปยังกระเป๋าภายนอก</p>
      </section>

      <h2>Summary Cards</h2>
      <div class="grid summary-grid">
        <section class="card"><p class="metric-label">Outbox ทั้งหมด</p><p class="metric">42</p></section>
        <section class="card"><p class="metric-label">WALLET_CREDIT Pending</p><p class="metric">7</p></section>
        <section class="card"><p class="metric-label">กำลังประมวลผล</p><p class="metric">2</p></section>
        <section class="card"><p class="metric-label">ส่งสำเร็จ / SENT</p><p class="metric">31</p></section>
        <section class="card"><p class="metric-label">ส่งไม่สำเร็จ / FAILED</p><p class="metric">2</p></section>
        <section class="card"><p class="metric-label">Retry Queue</p><p class="metric">4</p></section>
        <section class="card"><p class="metric-label">ยอดเครดิตรอส่ง</p><p class="metric">7,220.00</p></section>
        <section class="card"><p class="metric-label">Duplicate Blocked</p><p class="metric">3</p></section>
      </div>

      <h2>Wallet Outbox Flow</h2>
      ${list([
        "Settlement พบผู้ชนะ EXTERNAL_WALLET",
        "สร้าง WALLET_CREDIT outbox",
        "Worker โหลดรายการ PENDING",
        "ส่งเครดิตไป external wallet แบบ retry-safe",
        "อัปเดตสถานะ SENT หรือ FAILED"
      ])}

      <h2>Outbox Status Table</h2>
      <table>
        <thead>
          <tr><th>status</th><th>meaning</th><th>action</th></tr>
        </thead>
        <tbody>
          <tr><td><span class="badge pending">PENDING</span></td><td>รอ worker หยิบไปส่ง</td><td>wait for retry window</td></tr>
          <tr><td><span class="badge processing">PROCESSING</span></td><td>worker กำลังทำงาน</td><td>lock item</td></tr>
          <tr><td><span class="badge sent">SENT</span></td><td>ส่งสำเร็จแล้ว</td><td>no further action</td></tr>
          <tr><td><span class="badge failed">FAILED</span></td><td>ส่งไม่สำเร็จ</td><td>retry or manual review</td></tr>
          <tr><td><span class="badge duplicate">DUPLICATE_BLOCKED</span></td><td>กันรายการซ้ำ</td><td>keep audit trail</td></tr>
        </tbody>
      </table>

      <h2>Sample Outbox Items</h2>
      <table>
        <thead>
          <tr><th>outbox_id</th><th>type</th><th>ticket_no</th><th>account_ref</th><th>amount</th><th>status</th><th>retry_count</th><th>next_retry</th></tr>
        </thead>
        <tbody>
          <tr><td>out_0001</td><td>WALLET_CREDIT</td><td>L260512000124</td><td>wallet_u_10001</td><td>1,200.00</td><td><span class="badge pending">PENDING</span></td><td>0</td><td>now</td></tr>
          <tr><td>out_0002</td><td>WALLET_CREDIT</td><td>L260512000130</td><td>wallet_u_10008</td><td>5,000.00</td><td><span class="badge sent">SENT</span></td><td>1</td><td>-</td></tr>
          <tr><td>out_0003</td><td>WALLET_CREDIT</td><td>L260512000141</td><td>wallet_u_10021</td><td>720.00</td><td><span class="badge failed">FAILED</span></td><td>3</td><td>manual review</td></tr>
          <tr><td>out_0004</td><td>WALLET_CREDIT</td><td>L260512000155</td><td>wallet_u_10033</td><td>300.00</td><td><span class="badge processing">PROCESSING</span></td><td>0</td><td>locked</td></tr>
        </tbody>
      </table>

      <h2>Retry & Idempotency</h2>
      <div class="two-col">
        <section class="card"><h3>Retry Safety</h3>${list(["Retry only pending/failed items", "Use operation_ref for idempotency", "Do not create duplicate wallet credits", "Keep retry_count and last_error"])}</section>
        <section class="card"><h3>Duplicate Prevention</h3>${list(["Unique operation_ref", "One payout per winning ticket", "Do not re-credit SENT item", "Audit every retry attempt"])}</section>
      </div>

      <h2>External Wallet Safety</h2>
      ${list([
        "Demo does not call real wallet",
        "No real payment processing",
        "No deposit/withdraw",
        "No credentials shown",
        "Wallet failures must be retry-safe",
        "External wallet response can be delayed or unknown",
        "18+ notice"
      ])}

      <h2>Relationship with Settlement Center</h2>
      ${list([
        "Settlement Center decides winner/loser",
        "Manual winners get PAYOUT_CREDIT ledger",
        "External wallet winners create WALLET_CREDIT outbox",
        "Wallet Outbox Monitor tracks WALLET_CREDIT delivery status"
      ])}

      <h2>Links</h2>
      <div class="grid">
        <a class="tile" href="/">Back to /</a>
        <a class="tile" href="/demo/project-overview">/demo/project-overview</a>
        <a class="tile" href="/demo/backoffice">/demo/backoffice</a>
        <a class="tile" href="/demo/settlement-center">/demo/settlement-center</a>
        <a class="tile" href="/api/health">/api/health</a>
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
http://localhost:3000/demo/settlement-center
http://localhost:3000/demo/wallet-outbox-monitor</code>

      <h2>Demo Links</h2>
      <div class="grid">
        <a class="tile" href="/demo/settlement-center">/demo/settlement-center</a>
        <a class="tile" href="/demo/wallet-outbox-monitor">/demo/wallet-outbox-monitor</a>
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
