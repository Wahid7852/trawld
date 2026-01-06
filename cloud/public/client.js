async function refresh() {
  const alertsRes = await fetch("/alerts");
  const alertsJson = await alertsRes.json();
  const alerts = alertsJson.alerts || [];
  const tbodyA = document.querySelector("#alerts tbody");
  tbodyA.innerHTML = alerts.map(a => {
    const sevClass = `sev-${a.severity || "low"}`;
    return `<tr>
      <td>${a.machine_id}</td>
      <td>${a.package?.ecosystem || ""}:${a.package?.name || ""}@${a.package?.version || ""}</td>
      <td><span class="${sevClass}">${a.severity}</span></td>
      <td>${a.cve_id || ""}</td>
      <td>${a.fix || ""}</td>
      <td>${new Date(a.created_at).toLocaleString()}</td>
    </tr>`;
  }).join("");
  const machinesRes = await fetch("/machines");
  const machinesJson = await machinesRes.json();
  const machines = machinesJson.machines || [];
  const tbodyM = document.querySelector("#machines tbody");
  tbodyM.innerHTML = machines.map(m => {
    return `<tr>
      <td>${m.uuid}</td>
      <td>${m.hostname}</td>
      <td>${m.os}</td>
      <td>${m.last_seen}</td>
    </tr>`;
  }).join("");
}

async function init() {
  setInterval(refresh, 5000);
  refresh();
}
init();
