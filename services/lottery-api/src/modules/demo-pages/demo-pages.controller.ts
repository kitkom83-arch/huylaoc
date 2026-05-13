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
      </div>
      <h2>Prisma Studio</h2>
      <code>${prismaStudioCommand}</code>`
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
