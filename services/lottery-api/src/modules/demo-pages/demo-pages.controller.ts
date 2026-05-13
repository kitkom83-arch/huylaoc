import { Controller, Get, Header } from "@nestjs/common";

const prismaStudioCommand = "pnpm exec prisma studio --schema services/lottery-api/prisma/schema.prisma";

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #111827; color: #f9fafb; }
    main { max-width: 980px; margin: 0 auto; padding: 40px 20px 56px; }
    h1 { margin: 0 0 16px; font-size: 34px; line-height: 1.15; letter-spacing: 0; }
    h2 { margin: 28px 0 12px; font-size: 22px; letter-spacing: 0; }
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
  </style>
</head>
<body>
  <main>${body}</main>
</body>
</html>`;
}

@Controller()
export class DemoPagesController {
  @Get("/")
  @Header("content-type", "text/html; charset=utf-8")
  root(): string {
    return page(
      "Lottery Game Engine Demo",
      `<h1>Lottery Game Engine Demo</h1>
      <p class="muted">หน้าเริ่มต้นสำหรับทดสอบ API และหน้าเดโมในเครื่อง</p>
      <div class="grid">
        <a class="tile" href="/api/health">/api/health</a>
        <a class="tile" href="/v1/catalog/bet-types">/v1/catalog/bet-types</a>
        <a class="tile" href="/v1/rounds/current">/v1/rounds/current</a>
        <a class="tile" href="/v1/results/latest">/v1/results/latest</a>
        <a class="tile" href="/demo/customer-th">/demo/customer-th</a>
        <a class="tile" href="/demo/customer-la">/demo/customer-la</a>
        <a class="tile" href="/demo/backoffice">/demo/backoffice</a>
        <a class="tile" href="/demo/project-overview">/demo/project-overview</a>
      </div>
      <h2>Prisma Studio</h2>
      <code>${prismaStudioCommand}</code>`
    );
  }

  @Get("/demo/project-overview")
  @Header("content-type", "text/html; charset=utf-8")
  projectOverview(): string {
    return page(
      "ภาพรวมโปรเจกต์ Lottery Game Engine",
      `<h1>ภาพรวมโปรเจกต์ Lottery Game Engine</h1>
      <p class="muted">Phase 1.2 overview page for local review. This page summarizes current scope without adding payment, wallet, payout, settlement, or new bet-type behavior.</p>

      <h2>Current System Status</h2>
      <div class="phase-list">
        <div class="phase"><strong>Phase 0</strong><span class="badge done">Done</span></div>
        <div class="phase"><strong>Phase 0.5</strong><span class="badge done">Done</span></div>
        <div class="phase"><strong>Phase 1.0</strong><span class="badge done">Done</span></div>
        <div class="phase"><strong>Phase 1.1</strong><span class="badge done">Done</span></div>
        <div class="phase"><strong>Phase 1.2</strong><span class="badge current">Current</span></div>
        <div class="phase"><strong>Phase 1.5</strong><span class="badge remaining">Remaining</span></div>
        <div class="phase"><strong>Phase 1.6</strong><span class="badge remaining">Remaining</span></div>
        <div class="phase"><strong>Phase 2.0</strong><span class="badge remaining">Remaining</span></div>
        <div class="phase"><strong>Phase 2.1</strong><span class="badge remaining">Remaining</span></div>
        <div class="phase"><strong>Phase 2.2</strong><span class="badge remaining">Remaining</span></div>
        <div class="phase"><strong>Phase 3.0</strong><span class="badge remaining">Remaining</span></div>
      </div>

      <h2>Completed Work</h2>
      <ul>
        <li>Static demo pages for customer, Lao customer, and backoffice review.</li>
        <li>Health endpoint and P0 catalog visibility.</li>
        <li>Round, result, manual credit, quote, ticket, audit, and idempotency foundations.</li>
        <li>Manual-credit ticket lifecycle and settlement preflight boundaries.</li>
      </ul>

      <h2>Remaining Work</h2>
      <ul>
        <li>Finish later phase work only after Phase 1.2 acceptance.</li>
        <li>Keep real payment, real wallet integration, payout, full settlement, and extra bet types out of Phase 1.2.</li>
      </ul>

      <h2>API Inventory</h2>
      <ul>
        <li>GET /api/health</li>
        <li>GET /v1/catalog/bet-types</li>
        <li>GET /v1/rounds/current</li>
        <li>GET /v1/results/latest</li>
        <li>POST /v1/admin/rounds</li>
        <li>PATCH /v1/admin/rounds/:round_id</li>
        <li>POST /v1/admin/results</li>
        <li>POST /v1/admin/manual/users</li>
        <li>POST /v1/admin/manual/credits/topup</li>
        <li>POST /v1/admin/manual/credits/deduct</li>
        <li>POST /v1/quotes</li>
        <li>POST /v1/tickets/confirm</li>
        <li>POST /v1/tickets/check</li>
        <li>GET /v1/admin/tickets</li>
        <li>POST /v1/admin/manual/tickets</li>
      </ul>

      <h2>Local Commands</h2>
      <code>pnpm build
pnpm check
pnpm test
pnpm -w run dev:api
${prismaStudioCommand}</code>

      <h2>Important Safety Notes</h2>
      <ul>
        <li>Do not add real credentials, hardcoded secrets, or production payment behavior.</li>
        <li>Do not log plaintext tokens, passwords, secrets, or check-token values.</li>
        <li>Do not add deposit, withdraw, payout, full settlement, real wallet integration, TWO_BOX, THREE_BOX, HIGH_LOW, or ODD_EVEN in Phase 1.2.</li>
      </ul>`
    );
  }

  @Get("/demo/customer-th")
  @Header("content-type", "text/html; charset=utf-8")
  customerThai(): string {
    return page(
      "หน้าเดโมลูกค้า หวยลาว",
      `<h1>หน้าเดโมลูกค้า หวยลาว</h1>
      <span class="badge">18+</span>
      <div class="grid">
        <section class="tile"><h2>งวดที่เปิดอยู่</h2><p>พื้นที่ mock สำหรับแสดงงวดปัจจุบันจาก /v1/rounds/current</p></section>
        <section class="tile"><h2>ผลล่าสุด</h2><p>พื้นที่ mock สำหรับแสดงผลจาก /v1/results/latest</p></section>
        <section class="tile"><h2>ประเภทหวย P0</h2><p>ONE_DIGIT, TWO_STRAIGHT, THREE_STRAIGHT, FOUR_STRAIGHT, FIVE_STRAIGHT, SIX_STRAIGHT</p></section>
        <section class="tile"><h2>ตัวอย่างบิล</h2><p>เลข 12, เดิมพัน 10 THB, สถานะรอผล</p></section>
        <section class="tile"><h2>ช่องตรวจบิล mock</h2><p>กรอกเลขบิลและ public check token ในระบบจริง</p></section>
      </div>`
    );
  }

  @Get("/demo/customer-la")
  @Header("content-type", "text/html; charset=utf-8")
  customerLao(): string {
    return page(
      "ໜ້າສາທິດລູກຄ້າ ຫວຍລາວ",
      `<h1>ໜ້າສາທິດລູກຄ້າ ຫວຍລາວ</h1>
      <span class="badge">18+</span>
      <div class="grid">
        <section class="tile"><h2>ງວດທີ່ເປີດ</h2><p>ພື້ນທີ່ mock ສໍາລັບງວດປັດຈຸບັນ</p></section>
        <section class="tile"><h2>ຜົນລ່າສຸດ</h2><p>ພື້ນທີ່ mock ສໍາລັບຜົນຫວຍລ່າສຸດ</p></section>
        <section class="tile"><h2>ເຊັກບິນ</h2><p>ໃສ່ເລກບິນ ແລະ token ໃນລະບົບຈິງ</p></section>
      </div>`
    );
  }

  @Get("/demo/backoffice")
  @Header("content-type", "text/html; charset=utf-8")
  backoffice(): string {
    return page(
      "Backoffice Demo",
      `<h1>Backoffice Demo</h1>
      <div class="grid">
        <section class="tile">งวดหวย</section>
        <section class="tile">ผลรางวัล</section>
        <section class="tile">Manual Users</section>
        <section class="tile">Topup / Deduct</section>
        <section class="tile">Tickets</section>
        <section class="tile">Wallet Outbox</section>
        <section class="tile">Settlement Preflight</section>
        <section class="tile">Audit Logs</section>
      </div>
      <h2>Important Endpoints</h2>
      <ul>
        <li>POST /v1/admin/rounds</li>
        <li>POST /v1/admin/results</li>
        <li>POST /v1/admin/manual/users</li>
        <li>POST /v1/admin/manual/credits/topup</li>
        <li>POST /v1/admin/manual/credits/deduct</li>
        <li>GET /v1/admin/tickets</li>
        <li>GET /v1/admin/audit-logs</li>
      </ul>`
    );
  }
}
