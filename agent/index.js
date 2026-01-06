#!/usr/bin/env node
import fetch from "node-fetch";
import { WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import express from "express";

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CLOUD_HTTP = process.env.CLOUD_HTTP || "http://localhost:4000";
const CLOUD_WS = process.env.CLOUD_WS || "ws://localhost:4000/agents";
const CONFIG_PATH = path.join(__dirname, "config.json");
const DATA_DIR = path.join(__dirname, "data");
const ID_PATH = path.join(DATA_DIR, "machine_id.txt");
const LOG_PATH = path.join(DATA_DIR, "actions.log");

const LOCAL_PORT = 7654;
const app = express();
app.use(express.json());

// State
const managedProcesses = new Map(); // pid -> { packages: [], ... }
const cveCache = new Map(); // pkgKey -> [{ cve, severity, fix }]

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function logAction(msg) {
  ensureDataDir();
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(LOG_PATH, line);
  console.log(line.trim());
}

function loadOrCreateId() {
  ensureDataDir();
  try {
    const id = fs.readFileSync(ID_PATH, "utf-8").trim();
    if (id) return id;
  } catch {}
  const id = uuidv4();
  fs.writeFileSync(ID_PATH, id);
  return id;
}

function readConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { policy: { critical: "kill", high: "block", medium: "alert", low: "log" } };
  }
}

// ... Inventory helpers (parsePackageLock, pipFreeze) ...
function parsePackageLock() {
  const candidates = [
    path.join(process.cwd(), "package-lock.json"),
    path.join(process.cwd(), "..", "package-lock.json"),
    path.join(process.cwd(), "..", "..", "package-lock.json")
  ];
  for (const lockPath of candidates) {
    try {
      const raw = fs.readFileSync(lockPath, "utf-8");
      const json = JSON.parse(raw);
      const deps = [];
      const entries = json.packages || {};
      for (const [key, val] of Object.entries(entries)) {
        let name = val.name;
        if (!name && key.startsWith("node_modules/")) {
          name = key.replace("node_modules/", "");
        }
        if (!name || !val.version) continue;
        deps.push({ ecosystem: "npm", name, version: val.version });
      }
      if (deps.length) return deps;
    } catch {}
  }
  return [];
}

function pipFreeze() {
  try {
    const r = spawnSync("python", ["-m", "pip", "freeze"], { encoding: "utf-8" });
    if (r.status !== 0) return [];
    const lines = r.stdout.split("\n").map(l => l.trim()).filter(Boolean);
    const deps = [];
    for (const line of lines) {
      const parts = line.split("==");
      if (parts.length === 2) deps.push({ ecosystem: "PyPI", name: parts[0], version: parts[1] });
    }
    return deps;
  } catch {
    return [];
  }
}

async function register(machineId) {
  const payload = { uuid: machineId, user_id: null, os: os.platform(), hostname: os.hostname() };
  try {
    await fetch(`${CLOUD_HTTP}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    logAction(`registered ${machineId}`);
    return true;
  } catch {
    logAction(`register failed`);
    return false;
  }
}

async function sendInventory(machineId, packages) {
  try {
    await fetch(`${CLOUD_HTTP}/inventory`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uuid: machineId, packages })
    });
    logAction(`inventory sent ${packages.length} packages`);
  } catch {}
}

function enforce(pid, alert) {
  const config = readConfig();
  const policy = config.policy || {};
  const action = policy[alert.severity] || "log";

  logAction(`ENFORCE: PID=${pid} Sev=${alert.severity} Action=${action} Pkg=${alert.package?.name}`);

  if (action === "kill") {
    try {
      process.kill(pid, "SIGKILL");
      logAction(`KILLED PID ${pid}`);
    } catch (e) {
      logAction(`Failed to kill PID ${pid}: ${e.message}`);
    }
  }
}

// Local Control Plane
app.post("/register", async (req, res) => {
  const { pid, packages, cwd } = req.body;
  if (!pid || !packages) return res.status(400).json({ error: "Missing pid or packages" });

  logAction(`HOOK: Process registered PID=${pid} CWD=${cwd} Pkgs=${packages.length}`);
  managedProcesses.set(pid, { packages, cwd, registeredAt: new Date() });

  // 1. Check against local CVE cache immediately
  for (const pkg of packages) {
    const key = `${pkg.ecosystem}:${pkg.name}@${pkg.version}`;
    if (cveCache.has(key)) {
      const alerts = cveCache.get(key);
      for (const alert of alerts) {
         enforce(pid, alert);
      }
    }
  }

  // 2. Send to Cloud for authoritative check
  const machineId = loadOrCreateId();
  await sendInventory(machineId, packages); 

  res.json({ status: "monitored" });
});

app.post("/event", (req, res) => {
  const { pid, type, detail } = req.body;
  logAction(`EVENT: PID=${pid} Type=${type} Detail=${JSON.stringify(detail)}`);
  res.json({ ok: true });
});

async function main() {
  const machineId = loadOrCreateId();
  logAction(`Agent starting. Machine ID: ${machineId}`);

  await register(machineId);
  
  // Start Local Server
  app.listen(LOCAL_PORT, "127.0.0.1", () => {
    logAction(`System Agent listening on 127.0.0.1:${LOCAL_PORT}`);
  });

  // Initial full scan (legacy support)
  const npmDeps = parsePackageLock();
  const pyDeps = pipFreeze();
  const allDeps = [...npmDeps, ...pyDeps];
  if (allDeps.length) {
    await sendInventory(machineId, allDeps);
  }

  // Connect WS
  function connectWs() {
    const ws = new WebSocket(`${CLOUD_WS}?machine_id=${machineId}`);
    ws.on("open", () => logAction("WS Connected"));
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === "CVE_ALERT") {
          logAction(`ALERT: ${msg.package.name} (${msg.severity}) - ${msg.cve_id}`);
          
          // Update Cache
          const pkg = msg.package;
          const key = `${pkg.ecosystem}:${pkg.name}@${pkg.version}`; 
          
          if (!cveCache.has(key)) cveCache.set(key, []);
          cveCache.get(key).push(msg);

          // Find affected PIDs
          for (const [pid, proc] of managedProcesses.entries()) {
             const hasPkg = proc.packages.find(p => p.name === pkg.name && p.ecosystem === pkg.ecosystem); 
             if (hasPkg) {
                enforce(pid, msg);
             }
          }
        }
      } catch (e) {
        console.error("WS Error", e);
      }
    });
    ws.on("close", () => setTimeout(connectWs, 5000));
    ws.on("error", () => {});
  }
  connectWs();
}

main().catch(() => {});
