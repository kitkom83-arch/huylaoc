const app = document.querySelector<HTMLDivElement>("#app")!;

const round = { code: "DEMO-OPEN", closesAt: "18:00 ICT" };
const result = { result6d: "255480", tail1: "0", tail2: "80", tail3: "480" };

app.innerHTML = `
  <section class="shell">
    <header>
      <h1>สลาก 6 หลัก</h1>
      <p>เดโมลูกค้า ภาษาไทย สำหรับตรวจรอบ ผลล่าสุด และตัวอย่างโพย</p>
    </header>
    <div class="notice">สำหรับผู้มีอายุ 18 ปีขึ้นไปเท่านั้น</div>
    <section class="grid">
      <article>
        <h2>รอบเปิด</h2>
        <p class="large">${round.code}</p>
        <p>ปิดรับ: ${round.closesAt}</p>
      </article>
      <article>
        <h2>ผลล่าสุด</h2>
        <p class="large">${result.result6d}</p>
        <dl>
          <dt>ท้าย 1</dt><dd>${result.tail1}</dd>
          <dt>ท้าย 2</dt><dd>${result.tail2}</dd>
          <dt>ท้าย 3</dt><dd>${result.tail3}</dd>
        </dl>
      </article>
      <article>
        <h2>ตรวจโพย</h2>
        <input placeholder="เลขที่โพย" />
        <input placeholder="รหัสตรวจโพย" />
        <button>ตรวจสอบ</button>
      </article>
      <article>
        <h2>ตัวอย่างโพย</h2>
        <p>สองตัวตรง 80 x 10 THB</p>
        <p>สามตัวตรง 480 x 5 THB</p>
      </article>
    </section>
  </section>
`;
