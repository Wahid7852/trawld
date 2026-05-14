import crypto from "crypto";
import dotenv from "dotenv";
import express from "express";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import { MongoClient } from "mongodb";
import path from "path";
import semver from "semver";
import { WebSocketServer } from "ws";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const IS_DIRECT_RUN = process.argv[1] ? path.resolve(process.argv[1]) === __filename : false;
const IS_VERCEL = ["1", "true"].includes(String(process.env.VERCEL || "").toLowerCase());

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "127.0.0.1";
const WS_PATH = "/agents";
const REALTIME_MODE = process.env.REALTIME_MODE || (IS_VERCEL ? "http" : "websocket");
const MONGODB_URI = process.env.MONGODB_URI || "";
const DATABASE_NAME = process.env.DATABASE_NAME || "sentry";
const PUBLIC_DIR = path.join(__dirname, "public");
const PUBLIC_INDEX = path.join(PUBLIC_DIR, "index.html");
const PUBLIC_CLOUD_URL = process.env.PUBLIC_CLOUD_URL || `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`;
const OSV_QUERY_CACHE_TTL_MS = Number(process.env.OSV_QUERY_CACHE_TTL_MS || 24 * 60 * 60 * 1000);

const app = express();
app.use(express.json({ limit: "2mb" }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} ${res.statusCode} - ${duration}ms`);
  });
  next();
});

let db = null;
let stateLoadPromise = null;

function wantsHtml(req) {
  return req.method === "GET" && (req.headers.accept || "").includes("text/html");
}

const state = {
  machines: new Map(),
  projects: new Map(),
  projectPackages: new Map(),
  projectSnapshots: new Map(),
  alerts: [],
  alertIndex: new Map(),
  agentSockets: new Map(),
  dashboardSockets: new Set(),
  enrolledAgents: new Map(),
  vulnCache: new Map(),
  packageQueryCache: new Map(),
  lastModifiedSeen: null,
  stateVersion: 1,
  lastUpdated: new Date().toISOString()
};

async function connectDB() {
  if (!MONGODB_URI) {
    console.log("MongoDB URI not configured");
    return null;
  }

  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db(DATABASE_NAME);
    await ensureIndexes();
    console.log("Connected to MongoDB");
    return db;
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    return null;
  }
}

async function ensureIndexes() {
  if (!db) return;
  try {
    await Promise.all([
      db.collection("osv_query_cache").createIndex({ key: 1 }, { unique: true }),
      db.collection("osv_query_cache").createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
      db.collection("project_snapshots").createIndex({ machine_id: 1, project_id: 1, snapshot_hash: 1 })
    ]);
  } catch (error) {
    console.error("Failed to ensure MongoDB indexes:", error.message);
  }
}

async function ensureStateLoaded() {
  if (!stateLoadPromise) {
    stateLoadPromise = loadState();
  }
  return stateLoadPromise;
}

function markStateChanged() {
  state.stateVersion += 1;
  state.lastUpdated = new Date().toISOString();
}

function getStateMeta() {
  return {
    state_version: state.stateVersion,
    last_updated: state.lastUpdated
  };
}

function withStateMeta(payload = {}) {
  return {
    ...payload,
    ...getStateMeta()
  };
}

function createProjectId(machineId, projectRoot) {
  return crypto.createHash("sha1").update(`${machineId}:${projectRoot}`).digest("hex");
}

function normalizeVersion(version) {
  if (!version) return "";
  return String(version)
    .trim()
    .replace(/^[=~^><\s]+/, "")
    .replace(/^[vV]/, "");
}

function normalizePackage(pkg, projectId, machineId, projectMeta, observedAt, source) {
  return {
    machine_id: machineId,
    project_id: projectId,
    project_name: projectMeta?.label || projectMeta?.name || "",
    project_root: projectMeta?.root || "",
    ecosystem: pkg.ecosystem,
    name: pkg.name,
    version: normalizeVersion(pkg.version),
    source: source || "unknown",
    last_seen: observedAt
  };
}

function dedupePackages(packages) {
  const seen = new Map();
  for (const pkg of packages) {
    if (!pkg?.name || !pkg?.version || !pkg?.ecosystem) continue;
    const key = `${pkg.ecosystem}:${pkg.name}@${pkg.version}`;
    seen.set(key, pkg);
  }
  return Array.from(seen.values()).sort((left, right) => {
    return `${left.ecosystem}:${left.name}@${left.version}`.localeCompare(
      `${right.ecosystem}:${right.name}@${right.version}`
    );
  });
}

function getPackageAlertKey(projectId, pkg, vulnId) {
  return `${projectId}:${pkg.ecosystem}:${pkg.name}@${pkg.version}:${vulnId}`;
}

function isValidAlertRecord(alert) {
  return Boolean(
    alert?.id &&
      alert.project_id &&
      alert.cve_id &&
      alert.package?.ecosystem &&
      alert.package?.name &&
      alert.package?.version
  );
}

function normalizeSeverity(severityEntries) {
  if (!severityEntries || severityEntries.length === 0) return "low";
  const cvssEntry = severityEntries.find((entry) => (entry.type || "").toLowerCase().includes("cvss"));
  if (!cvssEntry) return "medium";
  const score = parseFloat(cvssEntry.score || "0");
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
}

function findAffectedEntry(record, pkg) {
  return (record.affected || []).find(
    (entry) =>
      entry.package?.ecosystem?.toLowerCase() === pkg.ecosystem?.toLowerCase() &&
      entry.package?.name?.toLowerCase() === pkg.name?.toLowerCase()
  );
}

function findFixedVersion(affectedEntry, pkgVersion) {
  if (!affectedEntry?.ranges) return "";
  const current = semver.coerce(pkgVersion);
  let fallback = "";

  for (const range of affectedEntry.ranges) {
    if (!Array.isArray(range.events)) continue;
    for (const event of range.events) {
      if (!event.fixed) continue;
      const fixed = event.fixed;
      const fixedCoerced = semver.coerce(fixed);
      if (!fallback) fallback = fixed;
      if (current && fixedCoerced && semver.major(current) === semver.major(fixedCoerced)) {
        return fixed;
      }
    }
  }

  return fallback;
}

function versionMatches(pkgVersion, affectedEntries) {
  const target = semver.coerce(pkgVersion);
  if (!target) return false;

  for (const affected of affectedEntries || []) {
    if (affected.versions?.includes(pkgVersion)) return true;
    for (const range of affected.ranges || []) {
      if (!Array.isArray(range.events)) continue;
      let introduced = null;
      for (const event of range.events) {
        if (event.introduced) introduced = semver.coerce(event.introduced);
        if (event.fixed) {
          const fixed = semver.coerce(event.fixed);
          if (introduced && fixed && semver.gte(target, introduced) && semver.lt(target, fixed)) {
            return true;
          }
          introduced = null;
        }
        if (event.last_affected) {
          const lastAffected = semver.coerce(event.last_affected);
          if (introduced && lastAffected && semver.gte(target, introduced) && semver.lte(target, lastAffected)) {
            return true;
          }
        }
      }
      if (introduced && semver.gte(target, introduced)) {
        return true;
      }
    }
  }

  return false;
}

function buildMachineSummary(machineId) {
  const machine = state.machines.get(machineId);
  if (!machine) return null;

  const projects = Array.from(state.projects.values()).filter((project) => project.machine_id === machineId);
  const projectIds = new Set(projects.map((project) => project.id));
  const packages = Array.from(projectIds).flatMap((projectId) => state.projectPackages.get(projectId) || []);
  const alerts = state.alerts.filter((alert) => alert.machine_id === machineId && alert.status !== "ack");

  return {
    ...machine,
    project_count: projects.length,
    package_count: packages.length,
    alert_count: alerts.length,
    critical_count: alerts.filter((alert) => alert.severity === "critical").length
  };
}

function buildProjectPackages(projectId) {
  const project = state.projects.get(projectId);
  const packages = state.projectPackages.get(projectId) || [];
  const projectAlerts = state.alerts.filter((alert) => alert.project_id === projectId && alert.status !== "ack");

  return packages
    .map((pkg) => {
      const matchingAlerts = projectAlerts.filter(
        (alert) =>
          alert.package?.ecosystem === pkg.ecosystem &&
          alert.package?.name === pkg.name &&
          alert.package?.version === pkg.version
      );

      const severityRank = { critical: 4, high: 3, medium: 2, low: 1 };
      const highestSeverity = matchingAlerts.reduce((best, alert) => {
        if (!best) return alert.severity;
        return severityRank[alert.severity] > severityRank[best] ? alert.severity : best;
      }, "");

      return {
        ...pkg,
        project_label: project?.label || project?.name || "",
        vulnerability_count: matchingAlerts.length,
        highest_severity: highestSeverity || "none",
        fixes: Array.from(new Set(matchingAlerts.map((alert) => alert.fix).filter(Boolean))),
        osv_ids: matchingAlerts.map((alert) => alert.cve_id),
        alert_ids: matchingAlerts.map((alert) => alert.id),
        remediation_alert_id: matchingAlerts.find((alert) => alert.fix)?.id || matchingAlerts[0]?.id || ""
      };
    })
    .sort((left, right) => {
      if (right.vulnerability_count !== left.vulnerability_count) {
        return right.vulnerability_count - left.vulnerability_count;
      }
      return `${left.name}`.localeCompare(`${right.name}`);
    });
}

function buildProjectSummary(projectId) {
  const project = state.projects.get(projectId);
  if (!project) return null;
  const packages = buildProjectPackages(projectId);
  const alerts = state.alerts.filter((alert) => alert.project_id === projectId && alert.status !== "ack");

  return {
    ...project,
    package_count: packages.length,
    alert_count: alerts.length,
    critical_count: alerts.filter((alert) => alert.severity === "critical").length,
    ecosystems: project.ecosystems || [],
    package_manager: project.package_manager || "unknown"
  };
}

function deriveState({ machineId = "", projectId = "" } = {}) {
  const machineList = Array.from(state.machines.keys())
    .filter((candidate) => !machineId || candidate === machineId)
    .map((candidate) => buildMachineSummary(candidate))
    .filter(Boolean);

  const projectList = Array.from(state.projects.keys())
    .filter((candidate) => {
      const project = state.projects.get(candidate);
      if (!project) return false;
      if (projectId && candidate !== projectId) return false;
      if (machineId && project.machine_id !== machineId) return false;
      return true;
    })
    .map((candidate) => buildProjectSummary(candidate))
    .filter(Boolean)
    .sort((left, right) => new Date(right.last_seen).getTime() - new Date(left.last_seen).getTime());

  const projectIds = new Set(projectList.map((project) => project.id));
  const packages = Array.from(projectIds)
    .flatMap((candidate) => buildProjectPackages(candidate))
    .sort((left, right) => {
      if (right.vulnerability_count !== left.vulnerability_count) {
        return right.vulnerability_count - left.vulnerability_count;
      }
      return `${left.project_label}:${left.name}`.localeCompare(`${right.project_label}:${right.name}`);
    });

  const alerts = state.alerts
    .filter((alert) => {
      if (machineId && alert.machine_id !== machineId) return false;
      if (projectId && alert.project_id !== projectId) return false;
      return true;
    })
    .slice()
    .sort((left, right) => new Date(right.updated_at || right.created_at) - new Date(left.updated_at || left.created_at));

  return {
    machines: machineList,
    projects: projectList,
    packages,
    alerts,
    agents: Array.from(state.enrolledAgents.values())
      .filter((agent) => !machineId || agent.machine_id === machineId)
      .map(sanitizeAgent),
    ...getStateMeta()
  };
}

function broadcastDashboard(message) {
  markStateChanged();
  const payload = JSON.stringify(message);
  for (const socket of state.dashboardSockets) {
    if (socket.readyState === 1) {
      socket.send(payload);
    }
  }
}

function sendAlertToAgent(machineId, alertPayload) {
  const socket = state.agentSockets.get(machineId);
  if (socket && socket.readyState === 1) {
    socket.send(JSON.stringify({ type: "CVE_ALERT", ...alertPayload }));
  }
}

function sendCommandToAgent(machineId, payload) {
  const socket = state.agentSockets.get(machineId);
  if (!socket || socket.readyState !== 1) {
    throw new Error("owning agent is offline");
  }
  socket.send(JSON.stringify(payload));
}

async function storeVulnerability(record) {
  if (!record?.id) return;
  state.vulnCache.set(record.id, record);

  if (!db) return;
  try {
    await db.collection("cves").updateOne(
      { id: record.id },
      {
        $set: {
          id: record.id,
          modified: record.modified || null,
          published: record.published || null,
          summary: record.summary || "",
          raw: record
        }
      },
      { upsert: true }
    );
  } catch (error) {
    console.error("Failed to store vulnerability:", error.message);
  }
}

async function getVulnerability(id) {
  if (state.vulnCache.has(id)) return state.vulnCache.get(id);

  if (db) {
    const cached = await db.collection("cves").findOne({ id });
    if (cached?.raw) {
      state.vulnCache.set(id, cached.raw);
      return cached.raw;
    }
  }

  const response = await fetch(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`failed to hydrate vulnerability ${id}`);
  const record = await response.json();
  await storeVulnerability(record);
  return record;
}

async function queryOSVBatch(packages) {
  const freshResults = new Map();
  const queries = [];
  const queryPackages = [];

  for (const pkg of packages) {
    const key = `${pkg.ecosystem}:${pkg.name}@${pkg.version}`;
    const cached = await getCachedOSVQuery(key);
    if (cached) {
      freshResults.set(key, cached.vulns);
      continue;
    }

    queries.push({
      package: {
        ecosystem: pkg.ecosystem,
        name: pkg.name
      },
      version: pkg.version
    });
    queryPackages.push(pkg);
  }

  if (queries.length > 0) {
    const response = await fetch("https://api.osv.dev/v1/querybatch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ queries })
    });
    if (!response.ok) {
      throw new Error(`OSV querybatch failed: ${response.statusText}`);
    }

    const json = await response.json();
    const results = json.results || [];
    for (let index = 0; index < queryPackages.length; index += 1) {
      const pkg = queryPackages[index];
      const key = `${pkg.ecosystem}:${pkg.name}@${pkg.version}`;
      const vulns = results[index]?.vulns || [];
      await storeOSVQueryCache(key, vulns);
      freshResults.set(key, vulns);
    }
  }

  return freshResults;
}

async function getCachedOSVQuery(key) {
  const now = Date.now();
  const cached = state.packageQueryCache.get(key);
  if (cached && now - cached.cachedAt < OSV_QUERY_CACHE_TTL_MS) {
    return cached;
  }

  if (!db) return null;

  try {
    const record = await db.collection("osv_query_cache").findOne({
      key,
      expires_at: { $gt: new Date() }
    });
    if (!record) return null;
    const next = {
      vulns: record.vulns || [],
      cachedAt: new Date(record.cached_at || Date.now()).getTime()
    };
    state.packageQueryCache.set(key, next);
    return next;
  } catch (error) {
    console.error("Failed to read OSV query cache:", error.message);
    return null;
  }
}

async function storeOSVQueryCache(key, vulns) {
  const cachedAt = new Date();
  const cacheRecord = {
    vulns,
    cachedAt: cachedAt.getTime()
  };
  state.packageQueryCache.set(key, cacheRecord);

  if (!db) return;
  try {
    await db.collection("osv_query_cache").updateOne(
      { key },
      {
        $set: {
          key,
          vulns,
          cached_at: cachedAt,
          expires_at: new Date(cachedAt.getTime() + OSV_QUERY_CACHE_TTL_MS)
        }
      },
      { upsert: true }
    );
  } catch (error) {
    console.error("Failed to persist OSV query cache:", error.message);
  }
}

async function persistProjectState(projectId) {
  if (!db) return;

  const project = state.projects.get(projectId);
  if (!project) return;

  const packages = state.projectPackages.get(projectId) || [];
  const snapshot = state.projectSnapshots.get(projectId);

  try {
    await db.collection("projects").updateOne(
      { id: projectId },
      {
        $set: {
          ...project,
          updated_at: new Date().toISOString()
        }
      },
      { upsert: true }
    );

    await db.collection("project_packages").deleteMany({ project_id: projectId });
    if (packages.length > 0) {
      await db.collection("project_packages").insertMany(packages);
    }

    if (snapshot) {
      await db.collection("project_snapshots").updateOne(
        { project_id: projectId },
        {
          $set: {
            project_id: projectId,
            machine_id: project.machine_id,
            snapshot_hash: snapshot.snapshot_hash,
            observed_at: snapshot.observed_at,
            source: snapshot.source
          }
        },
        { upsert: true }
      );
    }
  } catch (error) {
    console.error("Failed to persist project state:", error.message);
  }
}

async function persistAlert(alert) {
  if (!db) return;
  try {
    await db.collection("alerts").updateOne(
      { id: alert.id },
      { $set: alert },
      { upsert: true }
    );
  } catch (error) {
    console.error("Failed to persist alert:", error.message);
  }
}

async function createOrUpdateAlert(machineId, project, pkg, record) {
  const affectedEntry = findAffectedEntry(record, pkg);
  const severity = normalizeSeverity(record.severity || affectedEntry?.severity);
  const fix = findFixedVersion(affectedEntry, pkg.version);
  const key = getPackageAlertKey(project.id, pkg, record.id);
  const existingAlertId = state.alertIndex.get(key);
  const now = new Date().toISOString();

  if (existingAlertId) {
    const existing = state.alerts.find((alert) => alert.id === existingAlertId);
    if (existing) {
      existing.updated_at = now;
      existing.fix = fix || existing.fix;
      existing.severity = severity;
      existing.status = "open";
      await persistAlert(existing);
      broadcastDashboard({ type: "ALERT_UPDATE", alert: existing });
      return existing;
    }
  }

  const alert = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    machine_id: machineId,
    project_id: project.id,
    project_name: project.label || project.name,
    project_root: project.root,
    created_at: now,
    updated_at: now,
    status: "open",
    severity,
    source: "osv.dev",
    cve_id: record.id,
    package: {
      ecosystem: pkg.ecosystem,
      name: pkg.name,
      version: pkg.version
    },
    fix
  };

  state.alerts.push(alert);
  state.alertIndex.set(key, alert.id);
  await persistAlert(alert);
  sendAlertToAgent(machineId, alert);
  broadcastDashboard({ type: "ALERT_UPDATE", alert });
  return alert;
}

async function evaluateProjectSnapshot(projectId) {
  const project = state.projects.get(projectId);
  const packages = state.projectPackages.get(projectId) || [];
  if (!project || packages.length === 0) {
    return { vulnerabilitiesFound: 0 };
  }

  const batchResults = await queryOSVBatch(packages);
  const uniqueVulnerabilityIds = new Set();

  for (const pkg of packages) {
    const key = `${pkg.ecosystem}:${pkg.name}@${pkg.version}`;
    const vulns = batchResults.get(key) || [];
    for (const vuln of vulns) {
      uniqueVulnerabilityIds.add(vuln.id);
    }
  }

  const hydrated = new Map();
  await Promise.all(
    Array.from(uniqueVulnerabilityIds).map(async (id) => {
      try {
        const record = await getVulnerability(id);
        hydrated.set(id, record);
      } catch (error) {
        console.error("Failed to hydrate vulnerability:", id, error.message);
      }
    })
  );

  let vulnerabilitiesFound = 0;
  for (const pkg of packages) {
    const key = `${pkg.ecosystem}:${pkg.name}@${pkg.version}`;
    const vulns = batchResults.get(key) || [];

    for (const summary of vulns) {
      const record = hydrated.get(summary.id);
      if (!record) continue;

      const affectedEntries = (record.affected || []).filter(
        (entry) =>
          entry.package?.ecosystem?.toLowerCase() === pkg.ecosystem?.toLowerCase() &&
          entry.package?.name?.toLowerCase() === pkg.name?.toLowerCase()
      );

      if (!versionMatches(pkg.version, affectedEntries)) continue;
      await createOrUpdateAlert(project.machine_id, project, pkg, record);
      vulnerabilitiesFound += 1;
    }
  }

  return { vulnerabilitiesFound };
}

function upsertMachine(machineId, payload = {}) {
  const existing = state.machines.get(machineId) || {};
  const machine = {
    ...existing,
    uuid: machineId,
    user_id: payload.user_id || existing.user_id || null,
    os: payload.os || existing.os || "",
    hostname: payload.hostname || existing.hostname || "",
    last_seen: new Date().toISOString()
  };
  state.machines.set(machineId, machine);
  return machine;
}

async function persistMachine(machine) {
  if (!db || !machine) return;
  try {
    await db.collection("machines").updateOne({ id: machine.uuid }, { $set: { ...machine, id: machine.uuid } }, { upsert: true });
  } catch (error) {
    console.error("Failed to persist machine:", error.message);
  }
}

function sanitizeAgent(agent) {
  if (!agent) return null;
  const { agent_token_hash: _hash, ...safeAgent } = agent;
  return safeAgent;
}

async function persistAgent(agent) {
  state.enrolledAgents.set(agent.machine_id, agent);
  if (!db) return;

  try {
    await db.collection("agents").updateOne(
      { machine_id: agent.machine_id },
      { $set: agent },
      { upsert: true }
    );
  } catch (error) {
    console.error("Failed to persist agent:", error.message);
  }
}

async function enrollAgent(payload = {}) {
  const machine = payload.machine || {};
  const machineId = payload.machine_id || payload.uuid || machine.machine_id || machine.uuid || crypto.randomUUID();
  const now = new Date().toISOString();
  const existing = state.enrolledAgents.get(machineId) || {};
  const sessionId = existing.agent_session_id || crypto.randomBytes(24).toString("base64url");
  const agent = {
    ...existing,
    id: existing.id || machineId,
    machine_id: machineId,
    hostname: payload.hostname || machine.hostname || existing.hostname || "",
    os: payload.os || machine.os || existing.os || "",
    label: payload.label || existing.label || payload.hostname || machine.hostname || machineId,
    agent_session_id: sessionId,
    created_at: existing.created_at || now,
    last_seen: now,
    revoked: false
  };

  await persistAgent(agent);
  return {
    agent: sanitizeAgent(agent),
    agentSessionId: sessionId
  };
}

async function touchAgent(machineId, updates = {}) {
  const agent = state.enrolledAgents.get(machineId);
  if (!agent) return null;
  const next = {
    ...agent,
    ...updates,
    last_seen: new Date().toISOString()
  };
  await persistAgent(next);
  return next;
}

async function updateAgentRealtimeStatus(machineId, payload = {}) {
  if (!machineId) return null;
  if (!state.enrolledAgents.has(machineId)) {
    await persistAgent({
      id: machineId,
      machine_id: machineId,
      hostname: payload.hostname || "",
      os: payload.os || "",
      created_at: new Date().toISOString(),
      revoked: false
    });
  }

  const updates = {
    hostname: payload.hostname || undefined,
    os: payload.os || undefined,
    status: {
      ...(state.enrolledAgents.get(machineId)?.status || {}),
      ...(payload.status || {}),
      ws_connected: payload.status?.ws_connected ?? true,
      observed_at: payload.status?.observed_at || new Date().toISOString()
    },
    automation: payload.automation || state.enrolledAgents.get(machineId)?.automation,
    last_export_at: payload.status?.last_export_at || payload.last_export_at || state.enrolledAgents.get(machineId)?.last_export_at,
    last_automation_run_at:
      payload.status?.last_automation_run_at || state.enrolledAgents.get(machineId)?.last_automation_run_at,
    last_automation_reason:
      payload.status?.last_automation_reason || state.enrolledAgents.get(machineId)?.last_automation_reason
  };

  const cleanUpdates = Object.fromEntries(
    Object.entries(updates).filter(([_key, value]) => value !== undefined)
  );
  const agent = await touchAgent(machineId, cleanUpdates);
  if (agent) {
    broadcastDashboard({ type: "AGENT_STATUS_UPDATE", agent: sanitizeAgent(agent) });
  }
  return agent;
}

async function resolveAgentSession(machineId) {
  if (!machineId) return null;
  const agent = state.enrolledAgents.get(machineId);
  if (!agent || agent.revoked) return null;
  return touchAgent(machineId);
}

async function attachAgentSession(req, res, next) {
  const machineId = req.body?.machine?.uuid || req.body?.uuid || req.body?.machine_id || req.query?.machine_id;
  if (!machineId) {
    res.status(400).json({ error: "machine id is required" });
    return;
  }

  const existing = state.enrolledAgents.get(machineId);
  if (existing?.revoked) {
    res.status(403).json({ error: "agent revoked" });
    return;
  }

  const agent = existing ? await touchAgent(machineId) : (await enrollAgent({ machine_id: machineId })).agent;
  req.agent = agent;
  next();
}

async function ingestProjectInventory(payload) {
  const machineId = payload.machine?.uuid || payload.uuid || payload.machine_id;
  if (!machineId) {
    throw new Error("machine id is required");
  }

  const machine = upsertMachine(machineId, payload.machine || payload);
  await persistMachine(machine);

  const projectRoot = path.resolve(payload.project?.root || "");
  const projectId = payload.project?.id || createProjectId(machineId, projectRoot);
  const project = {
    id: projectId,
    machine_id: machineId,
    root: projectRoot,
    name: payload.project?.name || path.basename(projectRoot) || "Unnamed Project",
    label: payload.project?.label || payload.project?.name || path.basename(projectRoot) || "Unnamed Project",
    ecosystems: payload.project?.ecosystems || [],
    manifest_paths: payload.project?.manifest_paths || [],
    package_manager: payload.project?.package_manager || "unknown",
    last_seen: payload.observed_at || new Date().toISOString(),
    last_source: payload.source || "unknown"
  };

  const normalizedPackages = dedupePackages(
    (payload.packages || []).map((pkg) =>
      normalizePackage(pkg, projectId, machineId, project, payload.observed_at || new Date().toISOString(), payload.source)
    )
  );

  const previousSnapshot = state.projectSnapshots.get(projectId);
  const snapshotHash =
    payload.snapshot_hash ||
    crypto
      .createHash("sha256")
      .update(JSON.stringify({ projectRoot, packages: normalizedPackages }))
      .digest("hex");

  if (previousSnapshot?.snapshot_hash === snapshotHash) {
    return {
      deduped: true,
      project_id: projectId,
      vulnerabilities_found: 0
    };
  }

  project.package_count = normalizedPackages.length;
  project.last_snapshot_hash = snapshotHash;
  state.projects.set(projectId, project);
  state.projectPackages.set(projectId, normalizedPackages);
  state.projectSnapshots.set(projectId, {
    project_id: projectId,
    machine_id: machineId,
    snapshot_hash: snapshotHash,
    observed_at: payload.observed_at || new Date().toISOString(),
    source: payload.source || "unknown"
  });

  await persistProjectState(projectId);

  broadcastDashboard({ type: "MACHINE_UPDATE", machine: buildMachineSummary(machineId) });
  broadcastDashboard({ type: "PROJECT_UPDATE", project: buildProjectSummary(projectId) });
  broadcastDashboard({ type: "INVENTORY_UPDATE", project_id: projectId, packages: buildProjectPackages(projectId) });

  const evaluation = await evaluateProjectSnapshot(projectId);
  broadcastDashboard({ type: "PROJECT_UPDATE", project: buildProjectSummary(projectId) });
  broadcastDashboard({ type: "INVENTORY_UPDATE", project_id: projectId, packages: buildProjectPackages(projectId) });
  broadcastDashboard({ type: "MACHINE_UPDATE", machine: buildMachineSummary(machineId) });

  return {
    deduped: false,
    project_id: projectId,
    vulnerabilities_found: evaluation.vulnerabilitiesFound
  };
}

async function loadState() {
  await connectDB();
  if (!db) return;

  try {
    const [machines, projects, packages, alerts, vulnerabilities, snapshots, agents] = await Promise.all([
      db.collection("machines").find({}).toArray(),
      db.collection("projects").find({}).toArray(),
      db.collection("project_packages").find({}).toArray(),
      db.collection("alerts").find({}).sort({ updated_at: -1, created_at: -1 }).limit(1000).toArray(),
      db.collection("cves").find({}).toArray(),
      db.collection("project_snapshots").find({}).toArray(),
      db.collection("agents").find({}).toArray()
    ]);

    machines.forEach((machine) => {
      const machineId = machine.id || machine.uuid;
      if (machineId) state.machines.set(machineId, { ...machine, uuid: machineId });
    });
    projects.forEach((project) => {
      if (project.id) state.projects.set(project.id, project);
    });
    packages.forEach((pkg) => {
      if (!pkg.project_id) return;
      if (!state.projectPackages.has(pkg.project_id)) state.projectPackages.set(pkg.project_id, []);
      state.projectPackages.get(pkg.project_id).push(pkg);
    });
    alerts.forEach((alert) => {
      if (!isValidAlertRecord(alert)) {
        console.warn(`Skipping malformed alert record id=${alert?.id || "unknown"}`);
        return;
      }
      state.alerts.push(alert);
      state.alertIndex.set(getPackageAlertKey(alert.project_id, alert.package, alert.cve_id), alert.id);
    });
    vulnerabilities.forEach((record) => {
      if (record.raw?.id) state.vulnCache.set(record.raw.id, record.raw);
    });
    snapshots.forEach((snapshot) => state.projectSnapshots.set(snapshot.project_id, snapshot));
    agents.forEach((agent) => {
      if (agent.machine_id) state.enrolledAgents.set(agent.machine_id, agent);
    });
    const timestamps = [
      ...machines.map((machine) => machine.last_seen || machine.updated_at),
      ...projects.map((project) => project.last_seen || project.updated_at),
      ...alerts.map((alert) => alert.updated_at || alert.created_at),
      ...agents.map((agent) => agent.last_seen || agent.updated_at)
    ]
      .filter(Boolean)
      .map((value) => new Date(value).getTime())
      .filter(Number.isFinite);
    if (timestamps.length > 0) {
      state.lastUpdated = new Date(Math.max(...timestamps)).toISOString();
    }

    console.log(
      `Loaded ${state.machines.size} machines, ${state.projects.size} projects, ${state.alerts.length} alerts, ${state.enrolledAgents.size} agents from MongoDB`
    );
  } catch (error) {
    console.error("Failed to load persisted state:", error.message);
  }
}

app.use(async (_req, res, next) => {
  try {
    await ensureStateLoaded();
    next();
  } catch (error) {
    console.error("Failed to initialize cloud state:", error.message);
    res.status(500).json({ error: "cloud state initialization failed" });
  }
});

app.get("/api/system/info", (_req, res) => {
  res.json(withStateMeta({
    ok: true,
    public_cloud_url: PUBLIC_CLOUD_URL,
    open_agent_enrollment: true,
    realtime_mode: REALTIME_MODE,
    osv_query_cache_ttl_ms: OSV_QUERY_CACHE_TTL_MS
  }));
});

app.post("/api/agents/enroll", async (req, res) => {
  const body = req.body || {};
  const machine = body.machine || {};
  const machineId = body.machine_id || body.uuid || machine.machine_id || machine.uuid || "";
  if (machineId && state.enrolledAgents.get(machineId)?.revoked) {
    res.status(403).json({ error: "agent revoked" });
    return;
  }

  const result = await enrollAgent(body);
  res.json({
    ok: true,
    ...result,
    cloud: {
      http: PUBLIC_CLOUD_URL,
      ws: REALTIME_MODE === "websocket" ? PUBLIC_CLOUD_URL.replace(/^http/i, "ws").replace(/\/$/, "") + WS_PATH : ""
    }
  });
});

app.get("/api/agents", (_req, res) => {
  res.json({
    agents: Array.from(state.enrolledAgents.values()).map(sanitizeAgent),
    ...getStateMeta()
  });
});

app.get("/api/agents/me", attachAgentSession, (req, res) => {
  res.json({ ok: true, agent: sanitizeAgent(req.agent) });
});

app.post("/api/agents/heartbeat", attachAgentSession, async (req, res) => {
  const machineId = req.body?.machine_id || req.body?.uuid || req.agent?.machine_id;
  const payload = req.body || {};
  const machine = upsertMachine(machineId, {
    hostname: payload.hostname || req.agent?.hostname,
    os: payload.os || req.agent?.os
  });
  await persistMachine(machine);
  const agent = await updateAgentRealtimeStatus(machineId, {
    ...payload,
    status: {
      ...(payload.status || {}),
      ws_connected: false,
      http_heartbeat: true,
      observed_at: payload.status?.observed_at || new Date().toISOString()
    }
  });
  broadcastDashboard({ type: "MACHINE_UPDATE", machine: buildMachineSummary(machineId) });
  res.json({ ok: true, agent: sanitizeAgent(agent) });
});

app.post("/api/agents/:id/revoke", async (req, res) => {
  const agent = state.enrolledAgents.get(req.params.id);
  if (!agent) {
    res.status(404).json({ error: "agent not found" });
    return;
  }

  const next = {
    ...agent,
    revoked: true,
    revoked_at: new Date().toISOString()
  };
  await persistAgent(next);
  const socket = state.agentSockets.get(agent.machine_id);
  if (socket && socket.readyState === 1) socket.close(1008, "agent revoked");
  broadcastDashboard({ type: "AGENT_STATUS_UPDATE", agent: sanitizeAgent(next) });
  res.json({ ok: true, agent: sanitizeAgent(next) });
});

app.post("/register", attachAgentSession, async (req, res) => {
  const { uuid, user_id, os, hostname } = req.body || {};
  if (!uuid) return res.status(400).json({ error: "uuid required" });

  const machine = upsertMachine(uuid, { user_id, os, hostname });
  await persistMachine(machine);
  if (req.agent?.machine_id === uuid) {
    await touchAgent(uuid, { hostname, os });
  }
  broadcastDashboard({ type: "MACHINE_UPDATE", machine: buildMachineSummary(uuid) });
  res.json({ ok: true });
});

async function ingestInventoryRequest(body = {}) {
  const snapshots = Array.isArray(body.snapshots) ? body.snapshots : null;
  if (!snapshots) {
    return ingestProjectInventory(body);
  }

  const results = [];
  for (const snapshot of snapshots) {
    results.push(await ingestProjectInventory({
      ...snapshot,
      uuid: snapshot.uuid || body.uuid,
      machine: snapshot.machine || body.machine
    }));
  }
  return {
    batch: true,
    received: snapshots.length,
    results,
    deduped: results.filter((result) => result.deduped).length,
    vulnerabilities_found: results.reduce((total, result) => total + (result.vulnerabilities_found || 0), 0)
  };
}

app.post("/project-inventory", attachAgentSession, async (req, res) => {
  try {
    const result = await ingestInventoryRequest(req.body || {});
    res.json(withStateMeta({ ok: true, ...result }));
  } catch (error) {
    console.error("project-inventory failed:", error.message);
    res.status(400).json({ error: error.message });
  }
});

app.post("/inventory", attachAgentSession, async (req, res) => {
  try {
    const result = await ingestInventoryRequest(req.body || {});
    res.json(withStateMeta({ ok: true, ...result }));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/project-inventory-batch", attachAgentSession, async (req, res) => {
  try {
    const result = await ingestInventoryRequest({ ...(req.body || {}), snapshots: req.body?.snapshots || [] });
    res.json(withStateMeta({ ok: true, ...result }));
  } catch (error) {
    console.error("project-inventory-batch failed:", error.message);
    res.status(400).json({ error: error.message });
  }
});

app.get("/state", (req, res) => {
  const { machine_id: machineId = "", project_id: projectId = "" } = req.query || {};
  res.json(deriveState({ machineId, projectId }));
});

app.get("/machines", (req, res) => {
  if (wantsHtml(req)) {
    res.sendFile(PUBLIC_INDEX);
    return;
  }

  const { machine_id: machineId = "" } = req.query || {};
  res.json(withStateMeta({ machines: deriveState({ machineId }).machines }));
});

app.get("/projects", (req, res) => {
  const { machine_id: machineId = "", project_id: projectId = "" } = req.query || {};
  res.json(withStateMeta({ projects: deriveState({ machineId, projectId }).projects }));
});

app.get("/inventory", (req, res) => {
  const { machine_id: machineId = "", project_id: projectId = "" } = req.query || {};
  res.json(withStateMeta({
    packages: deriveState({ machineId, projectId }).packages
  }));
});

app.get("/alerts", (req, res) => {
  if (wantsHtml(req)) {
    res.sendFile(PUBLIC_INDEX);
    return;
  }

  const { machine_id: machineId = "", project_id: projectId = "", status = "" } = req.query || {};
  let alerts = deriveState({ machineId, projectId }).alerts;
  if (status) {
    alerts = alerts.filter((alert) => alert.status === status);
  }
  res.json(withStateMeta({ alerts }));
});

app.post("/alerts/:id/ack", async (req, res) => {
  const alert = state.alerts.find((candidate) => candidate.id === req.params.id);
  if (!alert) return res.status(404).json({ error: "alert not found" });

  alert.status = "ack";
  alert.updated_at = new Date().toISOString();
  await persistAlert(alert);

  broadcastDashboard({ type: "ALERT_UPDATE", alert });
  broadcastDashboard({ type: "PROJECT_UPDATE", project: buildProjectSummary(alert.project_id) });
  broadcastDashboard({ type: "INVENTORY_UPDATE", project_id: alert.project_id, packages: buildProjectPackages(alert.project_id) });
  broadcastDashboard({ type: "MACHINE_UPDATE", machine: buildMachineSummary(alert.machine_id) });

  res.json({ ok: true, alert });
});

app.post("/alerts/:id/remediate", async (req, res) => {
  const alert = state.alerts.find((candidate) => candidate.id === req.params.id);
  if (!alert) return res.status(404).json({ error: "alert not found" });
  if (!alert.fix) return res.status(400).json({ error: "no fix version is available for this alert" });

  try {
    sendCommandToAgent(alert.machine_id, {
      type: "REMEDIATE_PACKAGE",
      project_id: alert.project_id,
      package: alert.package,
      fix_version: alert.fix,
      alert_id: alert.id
    });

    alert.remediation_requested_at = new Date().toISOString();
    alert.updated_at = alert.remediation_requested_at;
    await persistAlert(alert);
    broadcastDashboard({ type: "ALERT_UPDATE", alert });
    res.json({ ok: true, queued: true, alert });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/scan-project/:id", async (req, res) => {
  const projectId = req.params.id;
  if (!state.projects.has(projectId)) return res.status(404).json({ error: "project not found" });
  const result = await evaluateProjectSnapshot(projectId);
  broadcastDashboard({ type: "PROJECT_UPDATE", project: buildProjectSummary(projectId) });
  broadcastDashboard({ type: "INVENTORY_UPDATE", project_id: projectId, packages: buildProjectPackages(projectId) });
  res.json({ ok: true, vulnerabilities_found: result.vulnerabilitiesFound });
});

app.post("/scan-machine/:id", async (req, res) => {
  const machineId = req.params.id;
  const projectIds = Array.from(state.projects.values())
    .filter((project) => project.machine_id === machineId)
    .map((project) => project.id);

  if (projectIds.length === 0) return res.status(404).json({ error: "machine or projects not found" });

  let total = 0;
  for (const projectId of projectIds) {
    const result = await evaluateProjectSnapshot(projectId);
    total += result.vulnerabilitiesFound;
  }

  broadcastDashboard({ type: "MACHINE_UPDATE", machine: buildMachineSummary(machineId) });
  res.json({ ok: true, vulnerabilities_found: total });
});

app.post("/check-package", async (req, res) => {
  const { ecosystem, name } = req.body || {};
  if (!ecosystem || !name) {
    return res.status(400).json({ error: "ecosystem and name required" });
  }

  let total = 0;
  for (const projectId of state.projects.keys()) {
    const matches = (state.projectPackages.get(projectId) || []).some(
      (pkg) => pkg.ecosystem === ecosystem && pkg.name === name
    );
    if (!matches) continue;
    const result = await evaluateProjectSnapshot(projectId);
    total += result.vulnerabilitiesFound;
  }

  res.json({ ok: true, vulnerabilities_found: total });
});

app.post("/verify-remediation", async (_req, res) => {
  let updated = 0;
  for (const alert of state.alerts.filter((candidate) => !candidate.fix)) {
    try {
      const record = await getVulnerability(alert.cve_id);
      const affectedEntry = findAffectedEntry(record, alert.package);
      const fix = findFixedVersion(affectedEntry, alert.package.version);
      if (fix) {
        alert.fix = fix;
        alert.updated_at = new Date().toISOString();
        await persistAlert(alert);
        updated += 1;
      }
    } catch {}
  }

  res.json({ ok: true, updated });
});

async function ingestModifiedCSV() {
  try {
    const response = await fetch("https://storage.googleapis.com/osv-vulnerabilities/modified_id.csv");
    if (!response.ok) throw new Error(`failed to fetch modified_id.csv: ${response.statusText}`);
    const text = await response.text();
    const lines = text.trim().split("\n");
    let processed = 0;

    for (const line of lines) {
      const [modified, objectPath] = line.split(",");
      if (state.lastModifiedSeen && modified <= state.lastModifiedSeen) break;

      const [ecosystem, id] = objectPath.split("/");
      if (!["npm", "PyPI"].includes(ecosystem) || !id) continue;

      try {
        const recordResponse = await fetch(`https://storage.googleapis.com/osv-vulnerabilities/${ecosystem}/${id}.json`);
        if (!recordResponse.ok) continue;
        const record = await recordResponse.json();
        await storeVulnerability(record);

        for (const [projectId, packages] of state.projectPackages.entries()) {
          const matched = packages.filter((pkg) => {
            const affectedEntries = (record.affected || []).filter(
              (entry) =>
                entry.package?.ecosystem?.toLowerCase() === pkg.ecosystem?.toLowerCase() &&
                entry.package?.name?.toLowerCase() === pkg.name?.toLowerCase()
            );
            return versionMatches(pkg.version, affectedEntries);
          });

          if (matched.length === 0) continue;
          const project = state.projects.get(projectId);
          for (const pkg of matched) {
            await createOrUpdateAlert(project.machine_id, project, pkg, record);
          }
        }

        processed += 1;
        state.lastModifiedSeen = modified;
        if (processed >= 100) break;
      } catch (error) {
        console.error("Failed to process modified record:", id, error.message);
      }
    }

    return { ok: true, count: processed };
  } catch (error) {
    console.error("OSV ingestion failed:", error.message);
    return { error: error.message };
  }
}

app.post("/ingest-now", async (_req, res) => {
  const result = await ingestModifiedCSV();
  if (result.error) return res.status(500).json(result);
  broadcastDashboard({ type: "STATE_SYNC", state: deriveState() });
  res.json(result);
});

app.get("/", (_req, res) => {
  res.sendFile(PUBLIC_INDEX);
});

app.use(express.static(PUBLIC_DIR));

app.get("*", (req, res, next) => {
  if (!wantsHtml(req) || path.extname(req.path)) {
    next();
    return;
  }

  res.sendFile(PUBLIC_INDEX);
});

function attachWebSocketServer(server) {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    if (req.url?.startsWith(WS_PATH)) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", async (ws, req) => {
  const ip = req.socket.remoteAddress;
  const url = new URL(req.url || WS_PATH, `http://${req.headers.host || "localhost"}`);
  let role = url.searchParams.get("role") || "dashboard";
  let machineId = url.searchParams.get("machine_id") || "";
  let agentSession = null;

  if (role === "agent" || machineId) {
    role = "agent";
    agentSession = await resolveAgentSession(machineId);
    if (!agentSession) {
      ws.close(1008, "agent revoked or unknown");
      return;
    }
    state.agentSockets.set(machineId, ws);
    const machine = upsertMachine(machineId, {
      hostname: agentSession.hostname,
      os: agentSession.os
    });
    await persistMachine(machine);
    await updateAgentRealtimeStatus(machineId, {
      hostname: agentSession.hostname,
      os: agentSession.os,
      status: {
        ws_connected: true,
        connected_at: new Date().toISOString()
      }
    });
    broadcastDashboard({ type: "MACHINE_UPDATE", machine: buildMachineSummary(machineId) });
  } else {
    role = "dashboard";
    state.dashboardSockets.add(ws);
    ws.send(JSON.stringify({ type: "STATE_SYNC", state: deriveState() }));
  }

  console.log(`[${new Date().toISOString()}] WebSocket connected from ${ip}`);

  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message.toString());
      if (data.type === "HELLO" && data.machine_id && role === "agent") {
        role = "agent";
        machineId = machineId || data.machine_id;
        state.dashboardSockets.delete(ws);
        state.agentSockets.set(machineId, ws);
        const machine = upsertMachine(machineId, {
          hostname: data.hostname,
          os: data.os
        });
        await persistMachine(machine);
        await updateAgentRealtimeStatus(machineId, data);
        broadcastDashboard({ type: "MACHINE_UPDATE", machine: buildMachineSummary(machineId) });
        return;
      }

      if (data.type === "DASHBOARD_HELLO" && role === "dashboard") {
        role = "dashboard";
        state.dashboardSockets.add(ws);
        ws.send(JSON.stringify({ type: "STATE_SYNC", state: deriveState() }));
        return;
      }

      if (data.type === "HEARTBEAT" && machineId) {
        const machine = upsertMachine(machineId, {
          hostname: data.hostname,
          os: data.os
        });
        await persistMachine(machine);
        await updateAgentRealtimeStatus(machineId, data);
        broadcastDashboard({ type: "MACHINE_UPDATE", machine: buildMachineSummary(machineId) });
      }
    } catch (error) {
      console.error("WebSocket message error:", error.message);
    }
  });

  ws.on("close", () => {
    state.dashboardSockets.delete(ws);
    if (role === "agent" && machineId) {
      state.agentSockets.delete(machineId);
      updateAgentRealtimeStatus(machineId, {
        status: {
          ws_connected: false,
          disconnected_at: new Date().toISOString()
        }
      }).catch(() => {});
    }
  });
  });
}

function startStandaloneServer() {
  const server = app.listen(PORT, HOST, async () => {
    await ensureStateLoaded();
    console.log(`Cloud CVE Brain listening on http://${HOST}:${PORT}`);
    console.log("Cloud Brain open mode enabled");
    console.log(`Realtime mode ${REALTIME_MODE}`);
  });

  if (REALTIME_MODE === "websocket") {
    attachWebSocketServer(server);
  }

  setInterval(() => {
    ingestModifiedCSV().catch(() => {});
  }, 60 * 1000);
}

if (IS_DIRECT_RUN) {
  startStandaloneServer();
}

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

export default app;
