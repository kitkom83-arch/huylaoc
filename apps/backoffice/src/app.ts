const app = document.querySelector<HTMLDivElement>("#app")!;

const panels = [
  ["Dashboard", "Open rounds, ticket exposure, settlement queue"],
  ["Manual Users", "Create users and enable or disable access"],
  ["Topup / Deduct", "Ledger-backed credit changes only"],
  ["Manual Bet Entry", "Create manual tickets using the engine quote flow"],
  ["Ticket List", "Search by ticket number, customer ref, or round"],
  ["Result & Settlement", "Post 6D result and inspect settlement job"],
  ["Audit Logs", "Review admin and manual credit actions"]
];

app.innerHTML = `
  <section class="layout">
    <aside>
      <h1>Backoffice</h1>
      ${panels.map(([title]) => `<button>${title}</button>`).join("")}
    </aside>
    <section class="content">
      <header>
        <h2>Lottery Operations</h2>
        <p>Demo UI using API stubs and mock operational data.</p>
      </header>
      <section class="grid">
        ${panels
          .map(
            ([title, text]) => `
              <article>
                <h3>${title}</h3>
                <p>${text}</p>
              </article>
            `
          )
          .join("")}
      </section>
    </section>
  </section>
`;
