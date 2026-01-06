import express from "express";
import { WebSocketServer } from "ws";
import fetch from "node-fetch";
import semver from "semver";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 4000;
const WS_PATH = "/agents";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY || "";
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const state = {
  machines: new Map(),
  packagesByMachine: new Map(),
  agentSockets: new Map(),
  alerts: [],
  lastModifiedSeen: null
};

async function notifyAll(message, payload) {
  const webhook = process.env.WEBHOOK_URL || "";
  const slackWebhook = process.env.SLACK_WEBHOOK_URL || "";
  if (webhook) {
    try {
      await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, payload }) });
    } catch {}
  }
  if (slackWebhook) {
    try {
      const text = `${message}: ${payload.package?.ecosystem || ""}:${payload.package?.name || ""} ${payload.severity || ""} ${payload.cve_id || ""}`;
      await fetch(slackWebhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    } catch {}
  }
}

function normalizeSeverity(sev) {
  if (!sev || !sev.length) return "low";
  const cvss = sev.find(s => (s.type || "").toLowerCase().includes("cvss"));
  if (!cvss) return "medium";
  const score = parseFloat(cvss.score || "0");
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
}

function versionMatches(pkgVersion, affected) {
  if (!affected) return false;
  for (const a of affected) {
    if (!a.package || !a.package.name) continue;
    const versions = a.versions || [];
    if (versions.includes(pkgVersion)) return true;
    const ranges = a.ranges || [];
    for (const r of ranges) {
      if (r.type === "SEMVER" && Array.isArray(r.events)) {
        let introduced = null;
        let fixed = null;
        for (const e of r.events) {
          if (e.introduced) introduced = e.introduced;
          if (e.fixed) fixed = e.fixed;
          if (e.last_affected) fixed = e.last_affected;
        }
        const range = [];
        if (introduced) range.push(`>=${introduced}`);
        if (fixed) range.push(`<${fixed}`);
        if (range.length && semver.valid(pkgVersion)) {
          if (semver.satisfies(pkgVersion, range.join(" "))) return true;
        }
      }
    }
  }
  return false;
}

async function storeCVE(record) {
  if (supabase) {
    await supabase.from("cves").upsert({
      id: record.id,
      summary: record.summary || "",
      modified: record.modified || null,
      published: record.published || null,
      raw: record
    }, { onConflict: "id" });
    for (const a of record.affected || []) {
      const eco = a.package?.ecosystem || "";
      const name = a.package?.name || "";
      await supabase.from("cve_package_map").insert({
        cve_id: record.id,
        ecosystem: eco,
        name
      }).select().single().catch(() => {});
    }
  }
}

async function createAlert(machineId, payload) {
  const alert = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    machine_id: machineId,
    created_at: new Date().toISOString(),
    ...payload
  };
  state.alerts.push(alert);
  const sock = state.agentSockets.get(machineId);
  if (sock && sock.readyState === 1) {
    sock.send(JSON.stringify({ type: "CVE_ALERT", ...payload }));
  }
  if (supabase) {
    await supabase.from("alerts").insert({
      machine_id: machineId,
      type: "CVE_ALERT",
      severity: payload.severity,
      package_name: payload.package?.name || "",
      ecosystem: payload.package?.ecosystem || "",
      cve_id: payload.cve_id || "",
      fix: payload.fix || ""
    });
  }
  await notifyAll("CVE Alert", payload);
}

async function ingestModifiedCSV() {
  const url = "https://storage.googleapis.com/osv-vulnerabilities/modified_id.csv";
  const res = await fetch(url);
  if (!res.ok) return;
  const text = await res.text();
  const lines = text.trim().split("\n");
  for (const line of lines) {
    const [modified, path] = line.split(",");
    if (state.lastModifiedSeen && modified <= state.lastModifiedSeen) break;
    const [eco, id] = path.split("/");
    if (!eco || !id) continue;
    if (eco !== "npm" && eco !== "PyPI") continue;
    const recUrl = `https://storage.googleapis.com/osv-vulnerabilities/${eco}/${id}.json`;
    try {
      const r = await fetch(recUrl);
      if (!r.ok) continue;
      const record = await r.json();
      await storeCVE(record);
      for (const [machineId, pkgs] of state.packagesByMachine.entries()) {
        for (const p of pkgs) {
          const affectedEntries = (record.affected || []).filter(a => a.package?.ecosystem === p.ecosystem && a.package?.name === p.name);
          if (!affectedEntries.length) continue;
          const match = versionMatches(p.version, affectedEntries);
          if (match) {
            const sev = normalizeSeverity(record.severity || affectedEntries[0]?.severity);
            const fixEvent = affectedEntries[0]?.ranges?.find(r => r.type === "SEMVER")?.events?.find(e => e.fixed)?.fixed || "";
            await createAlert(machineId, {
              severity: sev,
              package: { ecosystem: p.ecosystem, name: p.name, version: p.version },
              cve_id: record.id,
              fix: fixEvent
            });
          }
        }
      }
    } catch {}
    state.lastModifiedSeen = modified;
  }
}

app.post("/register", async (req, res) => {
  const { uuid, user_id, os, hostname } = req.body || {};
  if (!uuid) return res.status(400).json({ error: "uuid required" });
  state.machines.set(uuid, { uuid, user_id: user_id || null, os: os || "", hostname: hostname || "", last_seen: new Date().toISOString() });
  if (supabase) {
    await supabase.from("machines").upsert({
      id: uuid,
      user_id: user_id || null,
      os: os || "",
      hostname: hostname || "",
      last_seen: new Date().toISOString()
    }, { onConflict: "id" });
  }
  res.json({ ok: true });
  console.log(`Registered machine ${uuid}`);
});

app.post("/inventory", async (req, res) => {
  const { machine_id, packages } = req.body || {};
  if (!machine_id || !Array.isArray(packages)) return res.status(400).json({ error: "machine_id and packages required" });
  const list = packages.map(p => ({
    ecosystem: p.ecosystem,
    name: p.name,
    version: p.version
  }));
  state.packagesByMachine.set(machine_id, list);
  if (supabase) {
    for (const p of list) {
      await supabase.from("machine_packages").insert({
        machine_id,
        ecosystem: p.ecosystem,
        name: p.name,
        version: p.version
      });
    }
  }
  res.json({ ok: true });
});

app.get("/alerts", (req, res) => {
  res.json({ alerts: state.alerts.slice(-100) });
});

app.get("/machines", (req, res) => {
  const list = Array.from(state.machines.values());
  res.json({ machines: list });
});

const __dirname = process.cwd();

process.on("uncaughtException", err => {
  console.error("Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.use("/dashboard", express.static(path.join(__dirname, "public")));

const server = app.listen(PORT, () => {
  console.log(`Cloud CVE Brain listening on http://localhost:${PORT}`);
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  if (req.url === WS_PATH) {
    wss.handleUpgrade(req, socket, head, ws => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on("connection", ws => {
  let machineId = null;
  ws.on("message", msg => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type === "HELLO" && data.machine_id) {
        machineId = data.machine_id;
        state.agentSockets.set(machineId, ws);
      }
      if (data.type === "HEARTBEAT" && machineId) {
        const m = state.machines.get(machineId);
        if (m) m.last_seen = new Date().toISOString();
      }
    } catch {}
  });
  ws.on("close", () => {
    if (machineId) state.agentSockets.delete(machineId);
  });
});

setInterval(() => {
  ingestModifiedCSV().catch(() => {});
}, 60 * 1000);

app.post("/ingest-now", async (req, res) => {
  await ingestModifiedCSV().catch(() => {});
  res.json({ ok: true });
});

async function queryOSVByVersion(ecosystem, name, version) {
  const body = { version, package: { name, ecosystem } };
  const r = await fetch("https://api.osv.dev/v1/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!r.ok) return [];
  const json = await r.json();
  return json.vulns || [];
}

app.post("/check-package", async (req, res) => {
  const { ecosystem, name } = req.body || {};
  if (!ecosystem || !name) return res.status(400).json({ error: "ecosystem and name required" });
  for (const [machineId, pkgs] of state.packagesByMachine.entries()) {
    for (const p of pkgs) {
      if (p.ecosystem !== ecosystem || p.name !== name) continue;
      const vulns = await queryOSVByVersion(ecosystem, name, p.version);
      for (const v of vulns) {
        await storeCVE(v);
        const sev = normalizeSeverity(v.severity);
        const fixEvent = v.affected?.find(a => a.package?.name === name)?.ranges?.find(r => r.type === "SEMVER")?.events?.find(e => e.fixed)?.fixed || "";
        await createAlert(machineId, {
          severity: sev,
          package: { ecosystem: p.ecosystem, name: p.name, version: p.version },
          cve_id: v.id,
          fix: fixEvent
        });
      }
    }
  }
  res.json({ ok: true });
});
