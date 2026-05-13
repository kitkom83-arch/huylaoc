const app = document.querySelector<HTMLDivElement>("#app")!;

const result = { result6d: "255480", tail1: "0", tail2: "80", tail3: "480" };

app.innerHTML = `
  <section class="shell">
    <header>
      <h1>ຫວຍ 6 ຫຼັກ</h1>
      <p>ໜ້າຕົວຢ່າງລູກຄ້າພາສາລາວ</p>
    </header>
    <div class="notice">ສຳລັບຜູ້ມີອາຍຸ 18+ ເທົ່ານັ້ນ</div>
    <section class="grid">
      <article>
        <h2>ຮອບທີ່ເປີດ</h2>
        <p class="large">DEMO-OPEN</p>
        <p>ປິດຮັບ: 18:00 ICT</p>
      </article>
      <article>
        <h2>ຜົນຫຼ້າສຸດ</h2>
        <p class="large">${result.result6d}</p>
        <dl>
          <dt>ທ້າຍ 1</dt><dd>${result.tail1}</dd>
          <dt>ທ້າຍ 2</dt><dd>${result.tail2}</dd>
          <dt>ທ້າຍ 3</dt><dd>${result.tail3}</dd>
        </dl>
      </article>
      <article>
        <h2>ກວດໂພຍ</h2>
        <input placeholder="ເລກໂພຍ" />
        <input placeholder="ລະຫັດກວດ" />
        <button>ກວດສອບ</button>
      </article>
      <article>
        <h2>ໂພຍຕົວຢ່າງ</h2>
        <p>ສອງໂຕກົງ 80 x 10 LAK</p>
        <p>ສາມໂຕກົງ 480 x 5 LAK</p>
      </article>
    </section>
  </section>
`;
