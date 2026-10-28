export type DashboardCounts = {
  payments: Record<
    "received" | "claimed" | "unclaimed" | "flagged",
    { today: number; total: number }
  >;
  orders: { today: number; total: number };
  failedSms: { today: number; total: number };
};

function Row({ label, value }: { label: string; value: { today: number; total: number } }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{value.today}</td>
      <td>{value.total}</td>
    </tr>
  );
}

export function Dashboard({ counts }: { counts: DashboardCounts }) {
  const p = counts.payments;
  return (
    <section class="card stack" aria-labelledby="dash-title">
      <h1 class="card-title" id="dash-title">
        Dashboard
      </h1>
      <table class="admin-table">
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col">Today (EAT)</th>
            <th scope="col">All time</th>
          </tr>
        </thead>
        <tbody>
          <Row label="Payments received" value={p.received} />
          <Row label="Claimed" value={p.claimed} />
          <Row label="Unclaimed" value={p.unclaimed} />
          <Row label="Flagged" value={p.flagged} />
          <Row label="Orders" value={counts.orders} />
          <Row label="Failed SMS" value={counts.failedSms} />
        </tbody>
      </table>
    </section>
  );
}
