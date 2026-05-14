#!/usr/bin/env node
import crypto from "crypto";
import { spawn } from "child_process";
import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import os from "os";
import path, { dirname } from "path";
import { createInterface } from "readline/promises";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import { WebSocket } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const AGENT_NAME = "sentry-agent";
const DEFAULT_HOSTED_CLOUD_HTTP = process.env.SENTRY_DEFAULT_CLOUD_HTTP || "https://your-sentry-cloud.vercel.app";
const DEFAULT_CLOUD_HTTP = process.env.CLOUD_HTTP || DEFAULT_HOSTED_CLOUD_HTTP;
const DEFAULT_CLOUD_WS = process.env.CLOUD_WS || "";
const RUNTIME_PACKAGE_NAME = "@wahid7852/sentry-runtime-node";
const LEGACY_CONFIG_PATH = path.join(__dirname, "config.json");
const AGENT_HOME =
  process.env.SENTRY_AGENT_HOME ||
  (process.platform === "win32" && process.env.APPDATA
    ? path.join(process.env.APPDATA, AGENT_NAME)
    : path.join(os.homedir(), `.${AGENT_NAME}`));
const CONFIG_PATH = path.join(AGENT_HOME, "config.json");
const DATA_DIR = path.join(AGENT_HOME, "data");
const ID_PATH = path.join(DATA_DIR, "machine_id.txt");
const LOG_PATH = path.join(DATA_DIR, "actions.log");
const LOCAL_PORT = 7654;
const DEFAULT_IGNORE_PATTERNS = [
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  ".venv",
  "venv",
  "__pycache__"
];
const SERVICE_TASK_NAME = "SentryAgent";
const DEFAULT_AUTOMATION = {
  heartbeatIntervalMs: 15000,
  rescanIntervalMs: 5 * 60 * 1000,
  rescanOnStart: true
};

const MONITORED_NODE_FILES = new Set(["package.json", "package-lock.json"]);
const MONITORED_PYTHON_FILES = new Set([
  "requirements.txt",
  "pyproject.toml",
  "poetry.lock",
  "Pipfile.lock"
]);
const MONITORED_PROJECT_FILES = new Set([
  ...MONITORED_NODE_FILES,
  ...MONITORED_PYTHON_FILES
]);

const app = express();
app.use(express.json({ limit: "2mb" }));

const state = {
  machineId: "",
  cveCache: new Map(),
  managedProcesses: new Map(),
  projects: new Map(),
  projectPackages: new Map(),
  projectWatchers: new Map(),
  rootWatchers: new Map(),
  rootDiscoveryTimers: new Map(),
  lastExportAt: "",
  lastAutomationRunAt: "",
  lastAutomationReason: "",
  wsConnected: false
};

function ensureAgentHome() {
  if (!fs.existsSync(AGENT_HOME)) fs.mkdirSync(AGENT_HOME, { recursive: true });
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function safeResolve(inputPath) {
  if (!inputPath) return "";
  return path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(inputPath);
}

function uniquePaths(paths) {
  return Array.from(
    new Set(
      (paths || [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .map((value) => safeResolve(value))
    )
  );
}

function logAction(message) {
  ensureAgentHome();
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(LOG_PATH, line);
  console.log(line.trim());
}

function loadOrCreateId() {
  ensureAgentHome();
  try {
    const existing = fs.readFileSync(ID_PATH, "utf-8").trim();
    if (existing) return existing;
  } catch {}

  const created = uuidv4();
  fs.writeFileSync(ID_PATH, created);
  return created;
}

function buildDefaultConfig() {
  return {
    cloud: {
      http: DEFAULT_CLOUD_HTTP,
      ws: DEFAULT_CLOUD_WS,
      agentSessionId: process.env.SENTRY_AGENT_SESSION_ID || ""
    },
    policy: {
      critical: "kill",
      high: "kill",
      medium: "alert",
      low: "log"
    },
    watchRoots: [],
    ignorePatterns: DEFAULT_IGNORE_PATTERNS,
    automation: DEFAULT_AUTOMATION,
    monitoredProjects: []
  };
}

function normalizeAutomationConfig(rawAutomation = {}) {
  const toPositiveNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    heartbeatIntervalMs: toPositiveNumber(
      rawAutomation.heartbeatIntervalMs || rawAutomation.heartbeat_interval_ms,
      DEFAULT_AUTOMATION.heartbeatIntervalMs
    ),
    rescanIntervalMs: toPositiveNumber(
      rawAutomation.rescanIntervalMs || rawAutomation.rescan_interval_ms,
      DEFAULT_AUTOMATION.rescanIntervalMs
    ),
    rescanOnStart:
      rawAutomation.rescanOnStart ?? rawAutomation.rescan_on_start ?? DEFAULT_AUTOMATION.rescanOnStart
  };
}

function normalizeConfig(parsed = {}) {
  const defaults = buildDefaultConfig();
  return {
    ...defaults,
    ...parsed,
    cloud: {
      ...defaults.cloud,
      ...(parsed.cloud || {})
    },
    policy: {
      ...defaults.policy,
      ...(parsed.policy || {})
    },
    watchRoots: uniquePaths(parsed.watchRoots || parsed.watch_roots || []),
    ignorePatterns: Array.from(
      new Set([...(parsed.ignorePatterns || parsed.ignore_patterns || defaults.ignorePatterns || [])].filter(Boolean))
    ),
    automation: normalizeAutomationConfig(parsed.automation || {}),
    monitoredProjects: Array.isArray(parsed.monitoredProjects)
      ? parsed.monitoredProjects
      : Array.isArray(parsed.projects)
      ? parsed.projects
      : []
  };
}

function readConfig() {
  ensureAgentHome();

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
      return normalizeConfig(JSON.parse(raw));
    }

    if (fs.existsSync(LEGACY_CONFIG_PATH)) {
      const raw = fs.readFileSync(LEGACY_CONFIG_PATH, "utf-8");
      return normalizeConfig(JSON.parse(raw));
    }
  } catch {
    return buildDefaultConfig();
  }

  return buildDefaultConfig();
}

function saveConfig(nextConfig) {
  ensureAgentHome();
  const normalized = normalizeConfig(nextConfig);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(normalized, null, 2));
  return normalized;
}

function getDefaultWatchRoots() {
  const home = os.homedir();
  return uniquePaths(
    [
      path.join(home, "Desktop", "projects"),
      path.join(home, "source"),
      path.join(home, "projects")
    ].filter((candidate) => fs.existsSync(candidate))
  );
}

function parsePathInput(rawValue) {
  return uniquePaths(
    String(rawValue || "")
      .split(/[;\n,]+/)
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function shouldIgnoreDirectory(rootPath, candidatePath, ignorePatterns = []) {
  const relative = path.relative(rootPath, candidatePath);
  if (!relative || relative.startsWith("..")) return false;

  const segments = relative.split(path.sep).filter(Boolean);
  return segments.some((segment) => ignorePatterns.includes(segment));
}

function normalizeVersion(version) {
  if (!version) return "";
  return String(version)
    .trim()
    .replace(/^[=~^><\s]+/, "")
    .replace(/^[vV]/, "");
}

function dedupePackages(packages) {
  const seen = new Map();
  for (const pkg of packages) {
    if (!pkg?.name || !pkg?.version || !pkg?.ecosystem) continue;
    const key = `${pkg.ecosystem}:${pkg.name}@${pkg.version}`;
    seen.set(key, {
      ecosystem: pkg.ecosystem,
      name: pkg.name,
      version: pkg.version
    });
  }
  return Array.from(seen.values()).sort((left, right) => {
    return `${left.ecosystem}:${left.name}@${left.version}`.localeCompare(
      `${right.ecosystem}:${right.name}@${right.version}`
    );
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function parsePackageJson(projectRoot) {
  const packageJsonPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(packageJsonPath)) return { name: path.basename(projectRoot), packages: [] };

  try {
    const json = readJson(packageJsonPath);
    const sections = [
      json.dependencies || {},
      json.devDependencies || {},
      json.optionalDependencies || {},
      json.peerDependencies || {}
    ];

    const packages = sections.flatMap((section) =>
      Object.entries(section).map(([name, version]) => ({
        ecosystem: "npm",
        name,
        version: normalizeVersion(version)
      }))
    );

    return {
      name: json.name || path.basename(projectRoot),
      packages: dedupePackages(packages)
    };
  } catch {
    return { name: path.basename(projectRoot), packages: [] };
  }
}

function parsePackageLock(projectRoot) {
  const lockPath = path.join(projectRoot, "package-lock.json");
  if (!fs.existsSync(lockPath)) return [];

  try {
    const json = readJson(lockPath);
    const packages = [];

    if (json.packages && typeof json.packages === "object") {
      for (const [key, value] of Object.entries(json.packages)) {
        if (key === "" || !value?.version) continue;

        let name = value.name;
        if (!name && key.startsWith("node_modules/")) {
          name = key.replace(/^node_modules\//, "");
        }
        if (!name) continue;

        packages.push({
          ecosystem: "npm",
          name,
          version: normalizeVersion(value.version)
        });
      }
      return dedupePackages(packages);
    }

    if (json.dependencies && typeof json.dependencies === "object") {
      const walk = (deps) => {
        for (const [name, value] of Object.entries(deps)) {
          if (value?.version) {
            packages.push({
              ecosystem: "npm",
              name,
              version: normalizeVersion(value.version)
            });
          }
          if (value?.dependencies) walk(value.dependencies);
        }
      };
      walk(json.dependencies);
    }

    return dedupePackages(packages);
  } catch {
    return [];
  }
}

function parseRequirements(filePath) {
  if (!fs.existsSync(filePath)) return [];

  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
  const packages = [];
  for (const line of lines) {
    const cleaned = line.replace(/#.*/, "").trim();
    if (!cleaned) continue;
    const match = cleaned.match(/^([A-Za-z0-9._-]+)(?:\[[^\]]+\])?\s*(?:==|===|~=|>=|<=|>|<)?\s*([A-Za-z0-9+_.-]+)?/);
    if (!match?.[1]) continue;
    const version = normalizeVersion(match[2] || "");
    if (!version) continue;
    packages.push({
      ecosystem: "PyPI",
      name: match[1],
      version
    });
  }
  return dedupePackages(packages);
}

function parsePoetryLock(filePath) {
  if (!fs.existsSync(filePath)) return [];

  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
  const packages = [];
  let currentName = "";
  let currentVersion = "";

  const flush = () => {
    if (currentName && currentVersion) {
      packages.push({
        ecosystem: "PyPI",
        name: currentName,
        version: normalizeVersion(currentVersion)
      });
    }
    currentName = "";
    currentVersion = "";
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "[[package]]") {
      flush();
      continue;
    }
    if (trimmed.startsWith("name = ")) {
      currentName = trimmed.split("=").slice(1).join("=").trim().replace(/^"|"$/g, "");
    }
    if (trimmed.startsWith("version = ")) {
      currentVersion = trimmed.split("=").slice(1).join("=").trim().replace(/^"|"$/g, "");
    }
  }
  flush();

  return dedupePackages(packages);
}

function parsePipfileLock(filePath) {
  if (!fs.existsSync(filePath)) return [];

  try {
    const json = readJson(filePath);
    const packages = [];
    for (const sectionName of ["default", "develop"]) {
      const section = json[sectionName] || {};
      for (const [name, meta] of Object.entries(section)) {
        const version = normalizeVersion(typeof meta === "string" ? meta : meta?.version || "");
        if (!version) continue;
        packages.push({
          ecosystem: "PyPI",
          name,
          version
        });
      }
    }
    return dedupePackages(packages);
  } catch {
    return [];
  }
}

function parsePyprojectToml(filePath) {
  if (!fs.existsSync(filePath)) return [];

  const text = fs.readFileSync(filePath, "utf-8");
  const packages = [];

  const dependenciesBlock = text.match(/\[project\][\s\S]*?dependencies\s*=\s*\[([\s\S]*?)\]/m);
  if (dependenciesBlock?.[1]) {
    const matches = dependenciesBlock[1].matchAll(/"([^"]+)"/g);
    for (const match of matches) {
      const entry = match[1];
      const depMatch = entry.match(/^([A-Za-z0-9._-]+)(?:\[[^\]]+\])?\s*(?:==|===|~=|>=|<=|>|<)?\s*([A-Za-z0-9+_.-]+)?/);
      if (!depMatch?.[1]) continue;
      const version = normalizeVersion(depMatch[2] || "");
      if (!version) continue;
      packages.push({
        ecosystem: "PyPI",
        name: depMatch[1],
        version
      });
    }
  }

  const lines = text.split(/\r?\n/);
  let inPoetrySection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inPoetrySection = trimmed === "[tool.poetry.dependencies]";
      continue;
    }
    if (!inPoetrySection || !trimmed || trimmed.startsWith("#")) continue;
    const simpleMatch = trimmed.match(/^([A-Za-z0-9._-]+)\s*=\s*"([^"]+)"/);
    const objectMatch = trimmed.match(/^([A-Za-z0-9._-]+)\s*=\s*\{[^}]*version\s*=\s*"([^"]+)"/);
    const match = objectMatch || simpleMatch;
    if (!match?.[1]) continue;
    if (match[1] === "python") continue;
    const version = normalizeVersion(match[2]);
    if (!version) continue;
    packages.push({
      ecosystem: "PyPI",
      name: match[1],
      version
    });
  }

  return dedupePackages(packages);
}

function createProjectId(machineId, projectRoot) {
  return crypto.createHash("sha1").update(`${machineId}:${path.resolve(projectRoot)}`).digest("hex");
}

function createSnapshotHash(projectRoot, packages) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        projectRoot: path.resolve(projectRoot),
        packages
      })
    )
    .digest("hex");
}

function resolveProjectRoot(projectPath) {
  return path.isAbsolute(projectPath) ? projectPath : path.resolve(__dirname, projectPath);
}

function detectManifestPaths(projectRoot) {
  return Array.from(MONITORED_PROJECT_FILES).filter((fileName) => fs.existsSync(path.join(projectRoot, fileName)));
}

function detectPackageManager(projectRoot) {
  const root = path.resolve(projectRoot);
  const pyprojectPath = path.join(root, "pyproject.toml");

  if (fs.existsSync(path.join(root, "package-lock.json")) || fs.existsSync(path.join(root, "package.json"))) {
    return "npm";
  }

  if (fs.existsSync(path.join(root, "poetry.lock"))) {
    return "poetry";
  }

  if (fs.existsSync(path.join(root, "Pipfile.lock"))) {
    return "pipenv";
  }

  if (fs.existsSync(path.join(root, "requirements.txt"))) {
    return "requirements";
  }

  if (fs.existsSync(pyprojectPath)) {
    const text = fs.readFileSync(pyprojectPath, "utf-8");
    if (text.includes("[tool.poetry]")) return "poetry";
    if (text.includes("[project]")) return "pyproject";
  }

  return "unknown";
}

function buildProjectSnapshot(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  if (!fs.existsSync(root)) return null;

  const preferredEcosystems = new Set(options.ecosystems || []);
  const manifestPaths = detectManifestPaths(root);
  const shouldScanNode = preferredEcosystems.size === 0 || preferredEcosystems.has("npm");
  const shouldScanPython = preferredEcosystems.size === 0 || preferredEcosystems.has("PyPI");

  const nodeManifest = parsePackageJson(root);
  const nodePackages = shouldScanNode
    ? (() => {
        const lockPackages = parsePackageLock(root);
        return lockPackages.length > 0 ? lockPackages : nodeManifest.packages;
      })()
    : [];

  const pythonPackages = shouldScanPython
    ? dedupePackages([
        ...parsePoetryLock(path.join(root, "poetry.lock")),
        ...parsePipfileLock(path.join(root, "Pipfile.lock")),
        ...parseRequirements(path.join(root, "requirements.txt")),
        ...parsePyprojectToml(path.join(root, "pyproject.toml"))
      ])
    : [];

  if (manifestPaths.length === 0 && nodePackages.length === 0 && pythonPackages.length === 0) {
    return null;
  }

  const ecosystems = new Set();
  if (nodePackages.length > 0 || fs.existsSync(path.join(root, "package.json"))) ecosystems.add("npm");
  if (pythonPackages.length > 0 || manifestPaths.some((fileName) => MONITORED_PYTHON_FILES.has(fileName))) ecosystems.add("PyPI");

  const packages = dedupePackages([...nodePackages, ...pythonPackages]);
  const projectId = createProjectId(state.machineId, root);
  const name = options.name || nodeManifest.name || path.basename(root);
  const label = options.label || name;
  const snapshotHash = options.snapshotHash || createSnapshotHash(root, packages);

  return {
    project: {
      id: projectId,
      root,
      name,
      label,
      ecosystems: Array.from(ecosystems),
      manifest_paths: manifestPaths,
      package_manager: detectPackageManager(root)
    },
    packages,
    snapshotHash,
    observedAt: options.observedAt || new Date().toISOString(),
    source: options.source || "manifest-watcher",
    process: options.process || null,
    pid: options.pid || null
  };
}

function upsertProjectRecord(snapshot) {
  const existing = state.projects.get(snapshot.project.id) || {};
  const record = {
    ...existing,
    id: snapshot.project.id,
    machine_id: state.machineId,
    root: snapshot.project.root,
    name: snapshot.project.name,
    label: snapshot.project.label,
    ecosystems: snapshot.project.ecosystems,
    manifest_paths: snapshot.project.manifest_paths,
    package_manager: snapshot.project.package_manager,
    last_snapshot_hash: snapshot.snapshotHash,
    last_source: snapshot.source,
    last_seen: snapshot.observedAt,
    package_count: snapshot.packages.length
  };
  state.projects.set(record.id, record);
  return record;
}

function containsManifest(dirEntries) {
  return dirEntries.some((entry) => MONITORED_PROJECT_FILES.has(entry.name));
}

async function discoverProjectsUnderRoot(rootPath, options = {}) {
  const resolvedRoot = safeResolve(rootPath);
  const config = readConfig();
  const ignorePatterns = config.ignorePatterns || DEFAULT_IGNORE_PATTERNS;

  if (!resolvedRoot || !fs.existsSync(resolvedRoot)) {
    logAction(`watch root skipped path=${resolvedRoot || rootPath}`);
    return { root: resolvedRoot, discovered: 0 };
  }

  const queue = [resolvedRoot];
  let discovered = 0;
  const discoveredSnapshots = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || shouldIgnoreDirectory(resolvedRoot, current, ignorePatterns)) continue;

    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    if (containsManifest(entries)) {
      const snapshot = buildProjectSnapshot(current, {
        source: options.source || "root-discovery"
      });

      if (snapshot) {
        discoveredSnapshots.push(snapshot);
        discovered += 1;
      }
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (ignorePatterns.includes(entry.name)) continue;
      queue.push(path.join(current, entry.name));
    }
  }

  if (discoveredSnapshots.length > 0) {
    await ingestProjectSnapshotsBatch(discoveredSnapshots, { force: options.force === true });
  }

  logAction(`root discovery complete root=${resolvedRoot} projects=${discovered}`);
  return { root: resolvedRoot, discovered };
}

async function runAutomatedRootDiscovery(reason = "scheduled-rescan") {
  const config = readConfig();
  const watchRoots = Array.isArray(config.watchRoots) ? config.watchRoots : [];
  let discovered = 0;

  for (const watchRoot of watchRoots) {
    const result = await discoverProjectsUnderRoot(watchRoot, {
      source: reason,
      force: false
    });
    discovered += result.discovered || 0;
  }

  state.lastAutomationRunAt = new Date().toISOString();
  state.lastAutomationReason = reason;
  logAction(`automation ${reason} complete roots=${watchRoots.length} projects=${discovered}`);
  return { roots: watchRoots.length, discovered };
}

function findNodeProjectsUnderRoot(rootPath, options = {}) {
  const resolvedRoot = safeResolve(rootPath);
  const ignorePatterns = options.ignorePatterns || readConfig().ignorePatterns || DEFAULT_IGNORE_PATTERNS;
  if (!resolvedRoot || !fs.existsSync(resolvedRoot)) return [];

  const queue = [resolvedRoot];
  const projects = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || shouldIgnoreDirectory(resolvedRoot, current, ignorePatterns)) continue;

    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    if (entries.some((entry) => entry.isFile() && entry.name === "package.json")) {
      projects.push(current);
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (ignorePatterns.includes(entry.name)) continue;
      queue.push(path.join(current, entry.name));
    }
  }

  return projects;
}

function findNodeProjectsUnderRoots(rootPaths, options = {}) {
  return uniquePaths((rootPaths || []).flatMap((rootPath) => findNodeProjectsUnderRoot(rootPath, options)));
}

function detectJavaScriptPackageManager(projectRoot) {
  if (fs.existsSync(path.join(projectRoot, "pnpm-lock.yaml"))) return { command: "pnpm", args: ["add", RUNTIME_PACKAGE_NAME] };
  if (fs.existsSync(path.join(projectRoot, "yarn.lock"))) return { command: "yarn", args: ["add", RUNTIME_PACKAGE_NAME] };
  return { command: "npm", args: ["install", RUNTIME_PACKAGE_NAME] };
}

async function installRuntimeIntegration(projectRoots) {
  const installed = [];
  const failed = [];

  for (const projectRoot of projectRoots) {
    const manager = detectJavaScriptPackageManager(projectRoot);
    try {
      await runProjectCommand(manager.command, manager.args, projectRoot);
      installed.push({ root: projectRoot, command: `${manager.command} ${manager.args.join(" ")}` });
    } catch (error) {
      failed.push({ root: projectRoot, command: `${manager.command} ${manager.args.join(" ")}`, error: error.message });
    }
  }

  return { installed, failed };
}

function scheduleRootDiscovery(rootPath, reason = "root-watch") {
  const resolvedRoot = safeResolve(rootPath);
  if (!resolvedRoot) return;

  const existingTimer = state.rootDiscoveryTimers.get(resolvedRoot);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(() => {
    discoverProjectsUnderRoot(resolvedRoot, { source: reason }).catch((error) => {
      logAction(`root discovery failed root=${resolvedRoot} message=${error.message}`);
    });
  }, 800);

  state.rootDiscoveryTimers.set(resolvedRoot, timer);
}

function ensureRootWatcher(rootPath) {
  const resolvedRoot = safeResolve(rootPath);
  if (!resolvedRoot || state.rootWatchers.has(resolvedRoot) || !fs.existsSync(resolvedRoot)) return;

  try {
    const watcher = fs.watch(
      resolvedRoot,
      { persistent: true, recursive: process.platform === "win32" },
      (_eventType, fileName) => {
        if (!fileName) {
          scheduleRootDiscovery(resolvedRoot);
          return;
        }

        const baseName = path.basename(fileName.toString());
        if (MONITORED_PROJECT_FILES.has(baseName)) {
          scheduleRootDiscovery(resolvedRoot);
        }
      }
    );

    watcher.on("error", (error) => {
      logAction(`root watcher error root=${resolvedRoot} message=${error.message}`);
    });

    state.rootWatchers.set(resolvedRoot, watcher);
    logAction(`watching root ${resolvedRoot}`);
  } catch (error) {
    logAction(`failed to watch root ${resolvedRoot}: ${error.message}`);
  }
}

function getCloudConfig() {
  const config = readConfig();
  return {
    http: process.env.CLOUD_HTTP || config.cloud?.http || DEFAULT_CLOUD_HTTP,
    ws: process.env.CLOUD_WS || config.cloud?.ws || DEFAULT_CLOUD_WS,
    agentSessionId:
      process.env.SENTRY_AGENT_SESSION_ID ||
      process.env.SENTRY_AGENT_TOKEN ||
      config.cloud?.agentSessionId ||
      config.cloud?.agentToken ||
      ""
  };
}

async function enrollWithCloud({ cloudHttp, label = "" }) {
  state.machineId = state.machineId || loadOrCreateId();
  const response = await fetch(`${cloudHttp.replace(/\/$/, "")}/api/agents/enroll`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      machine_id: state.machineId,
      hostname: os.hostname(),
      os: os.platform(),
      label: label || os.hostname()
    })
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `enrollment failed with status ${response.status}`);
  }

  return response.json();
}

async function registerMachine() {
  const machinePayload = {
    uuid: state.machineId,
    user_id: null,
    os: os.platform(),
    hostname: os.hostname()
  };

  let attempts = 0;
  const cloud = getCloudConfig();
  logAction(`registering with cloud ${cloud.http}`);

  while (true) {
    try {
      const response = await fetch(`${cloud.http}/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(machinePayload)
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `cloud returned ${response.status}`);
      }
      logAction(`registered ${state.machineId}`);
      return true;
    } catch (error) {
      attempts += 1;
      const waitMs = Math.min(1000 * 2 ** attempts, 10000);
      logAction(`register failed (attempt ${attempts}, ${error.message}), retrying in ${waitMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

async function sendProjectInventory(snapshot) {
  const cloud = getCloudConfig();
  const payload = {
    uuid: state.machineId,
    machine: {
      uuid: state.machineId,
      hostname: os.hostname(),
      os: os.platform()
    },
    source: snapshot.source,
    observed_at: snapshot.observedAt,
    snapshot_hash: snapshot.snapshotHash,
    process: snapshot.process || null,
    project: snapshot.project,
    packages: snapshot.packages
  };

  try {
    const response = await fetch(`${cloud.http}/project-inventory`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `cloud returned ${response.status}`);
    }
    state.lastExportAt = new Date().toISOString();
    logAction(
      `project inventory sent id=${snapshot.project.id.slice(0, 10)} pkgs=${snapshot.packages.length} source=${snapshot.source}`
    );
  } catch (error) {
    logAction(`project inventory send failed id=${snapshot.project.id.slice(0, 10)} message=${error.message}`);
  }
}

async function sendProjectInventoryBatch(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return { ok: true, skipped: true };
  if (snapshots.length === 1) return sendProjectInventory(snapshots[0]);

  const cloud = getCloudConfig();
  const payload = {
    uuid: state.machineId,
    machine: {
      uuid: state.machineId,
      hostname: os.hostname(),
      os: os.platform()
    },
    snapshots: snapshots.map((snapshot) => ({
      source: snapshot.source,
      observed_at: snapshot.observedAt,
      snapshot_hash: snapshot.snapshotHash,
      process: snapshot.process || null,
      project: snapshot.project,
      packages: snapshot.packages
    }))
  };

  try {
    const response = await fetch(`${cloud.http}/project-inventory-batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `cloud returned ${response.status}`);
    }
    const result = await response.json().catch(() => ({}));
    state.lastExportAt = new Date().toISOString();
    logAction(`project inventory batch sent snapshots=${snapshots.length} deduped=${result.deduped || 0}`);
    return result;
  } catch (error) {
    logAction(`project inventory batch failed snapshots=${snapshots.length} message=${error.message}`);
    return { ok: false, error: error.message };
  }
}

function getAlertCacheKey(pkg) {
  return `${pkg.ecosystem}:${pkg.name}@${pkg.version}`;
}

function cacheAlert(alert) {
  const key = getAlertCacheKey(alert.package);
  const existing = state.cveCache.get(key) || [];
  if (!existing.find((entry) => entry.cve_id === alert.cve_id && entry.project_id === alert.project_id)) {
    existing.push(alert);
  }
  state.cveCache.set(key, existing);
}

function enforce(pid, alert) {
  const policy = readConfig().policy || {};
  const action = policy[alert.severity] || "log";

  logAction(
    `ENFORCE pid=${pid} project=${alert.project_id || "unknown"} severity=${alert.severity} action=${action} package=${alert.package?.name}`
  );

  if (action === "kill") {
    try {
      process.kill(pid, "SIGKILL");
      logAction(`KILLED PID ${pid}`);
    } catch (error) {
      logAction(`Failed to kill PID ${pid}: ${error.message}`);
    }
  }
}

function enforceMatchingProcesses(alert) {
  for (const [pid, processInfo] of state.managedProcesses.entries()) {
    const matchesProject = alert.project_id ? processInfo.projectId === alert.project_id : true;
    const matchesPackage = processInfo.packages.some(
      (pkg) =>
        pkg.ecosystem === alert.package?.ecosystem &&
        pkg.name === alert.package?.name &&
        pkg.version === alert.package?.version
    );
    if (matchesProject && matchesPackage) {
      enforce(pid, alert);
    }
  }
}

function evaluateLocalCacheForProcess(processInfo) {
  for (const pkg of processInfo.packages) {
    const alerts = state.cveCache.get(getAlertCacheKey(pkg)) || [];
    for (const alert of alerts) {
      enforce(processInfo.pid, alert);
    }
  }
}

function rememberManagedProcess(snapshot) {
  if (!snapshot.pid) return;
  const processInfo = {
    pid: snapshot.pid,
    projectId: snapshot.project.id,
    projectRoot: snapshot.project.root,
    packages: snapshot.packages,
    process: snapshot.process || null,
    lastSeen: snapshot.observedAt
  };
  state.managedProcesses.set(snapshot.pid, processInfo);
  evaluateLocalCacheForProcess(processInfo);
}

async function ingestProjectSnapshot(snapshot, options = {}) {
  const previous = state.projects.get(snapshot.project.id);
  upsertProjectRecord(snapshot);
  state.projectPackages.set(snapshot.project.id, snapshot.packages);

  if (snapshot.pid) {
    rememberManagedProcess(snapshot);
  }

  ensureProjectWatcher(snapshot.project);

  if (!options.force && previous?.last_snapshot_hash === snapshot.snapshotHash) {
    logAction(`snapshot deduped project=${snapshot.project.label} source=${snapshot.source}`);
    return {
      ok: true,
      deduped: true,
      project_id: snapshot.project.id
    };
  }

  await sendProjectInventory(snapshot);
  return {
    ok: true,
    deduped: false,
    project_id: snapshot.project.id
  };
}

async function ingestProjectSnapshotsBatch(snapshots, options = {}) {
  const changed = [];
  const results = [];

  for (const snapshot of snapshots) {
    const previous = state.projects.get(snapshot.project.id);
    upsertProjectRecord(snapshot);
    state.projectPackages.set(snapshot.project.id, snapshot.packages);

    if (snapshot.pid) {
      rememberManagedProcess(snapshot);
    }

    ensureProjectWatcher(snapshot.project);

    if (!options.force && previous?.last_snapshot_hash === snapshot.snapshotHash) {
      logAction(`snapshot deduped project=${snapshot.project.label} source=${snapshot.source}`);
      results.push({ ok: true, deduped: true, project_id: snapshot.project.id });
      continue;
    }

    changed.push(snapshot);
    results.push({ ok: true, deduped: false, project_id: snapshot.project.id });
  }

  if (changed.length > 0) {
    await sendProjectInventoryBatch(changed);
  }

  return {
    ok: true,
    total: snapshots.length,
    changed: changed.length,
    deduped: snapshots.length - changed.length,
    results
  };
}

function scheduleProjectRescan(projectId, reason = "watch") {
  const watchState = state.projectWatchers.get(projectId);
  const project = state.projects.get(projectId);
  if (!watchState || !project) return;

  if (watchState.timer) clearTimeout(watchState.timer);
  watchState.timer = setTimeout(() => {
    scanProjectById(projectId, reason).catch(() => {});
  }, 350);
}

function ensureProjectWatcher(project) {
  if (!project?.root || state.projectWatchers.has(project.id) || !fs.existsSync(project.root)) return;

  try {
    const watcher = fs.watch(project.root, { persistent: true }, (_eventType, fileName) => {
      if (!fileName) {
        scheduleProjectRescan(project.id, "watch");
        return;
      }

      const baseName = path.basename(fileName.toString());
      if (MONITORED_PROJECT_FILES.has(baseName)) {
        scheduleProjectRescan(project.id, "watch");
      }
    });

    watcher.on("error", (error) => {
      logAction(`watcher error project=${project.label} message=${error.message}`);
    });

    state.projectWatchers.set(project.id, { watcher, timer: null });
    logAction(`watching project ${project.label} at ${project.root}`);
  } catch (error) {
    logAction(`failed to watch project ${project.label}: ${error.message}`);
  }
}

async function scanProjectById(projectId, reason = "manual") {
  const project = state.projects.get(projectId);
  if (!project) return null;
  const snapshot = buildProjectSnapshot(project.root, {
    label: project.label,
    name: project.name,
    ecosystems: project.ecosystems,
    source: "manifest-watcher"
  });
  if (!snapshot) return null;
  logAction(`rescanning project ${project.label} reason=${reason}`);
  return ingestProjectSnapshot(snapshot);
}

async function bootstrapConfiguredProjects() {
  const config = readConfig();
  const projects = Array.isArray(config.monitoredProjects) ? config.monitoredProjects : [];

  for (const projectConfig of projects) {
    const normalized = typeof projectConfig === "string" ? { path: projectConfig } : projectConfig;
    if (!normalized?.path) continue;

    const root = resolveProjectRoot(normalized.path);
    const snapshot = buildProjectSnapshot(root, {
      label: normalized.label,
      name: normalized.name,
      ecosystems: normalized.ecosystems,
      source: "manifest-watcher"
    });

    if (!snapshot) {
      logAction(`configured project skipped path=${root}`);
      continue;
    }

    await ingestProjectSnapshot(snapshot, { force: false });
  }

  const watchRoots = Array.isArray(config.watchRoots) ? config.watchRoots : [];
  for (const watchRoot of watchRoots) {
    const resolvedRoot = safeResolve(watchRoot);
    if (!resolvedRoot) continue;
    ensureRootWatcher(resolvedRoot);
    await discoverProjectsUnderRoot(resolvedRoot, {
      source: "root-discovery",
      force: false
    });
  }
}

function runProjectCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: true,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || `command failed with exit code ${code}`));
    });
  });
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      shell: options.shell === true,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || `command failed with exit code ${code}`));
    });
  });
}

function updateRequirementsFile(projectRoot, packageName, fixVersion) {
  const requirementsPath = path.join(projectRoot, "requirements.txt");
  if (!fs.existsSync(requirementsPath)) {
    throw new Error("requirements.txt not found");
  }

  const lines = fs.readFileSync(requirementsPath, "utf-8").split(/\r?\n/);
  let updated = false;
  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const match = trimmed.match(/^([A-Za-z0-9._-]+)(?:\[[^\]]+\])?\s*(?:==|===|~=|>=|<=|>|<)\s*([A-Za-z0-9+_.-]+)?/);
    if (!match?.[1] || match[1].toLowerCase() !== packageName.toLowerCase()) {
      return line;
    }
    updated = true;
    return `${packageName}==${fixVersion}`;
  });

  if (!updated) {
    nextLines.push(`${packageName}==${fixVersion}`);
  }

  fs.writeFileSync(requirementsPath, nextLines.join("\n"));
}

function updatePyprojectDependency(projectRoot, packageName, fixVersion) {
  const pyprojectPath = path.join(projectRoot, "pyproject.toml");
  if (!fs.existsSync(pyprojectPath)) {
    throw new Error("pyproject.toml not found");
  }

  const lines = fs.readFileSync(pyprojectPath, "utf-8").split(/\r?\n/);
  let inProjectSection = false;
  let inDependenciesBlock = false;
  let updated = false;

  const nextLines = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      if (inDependenciesBlock && !updated) {
        nextLines.push(`    "${packageName}==${fixVersion}",`);
        updated = true;
      }
      inProjectSection = trimmed === "[project]";
      inDependenciesBlock = false;
      nextLines.push(line);
      continue;
    }

    if (inProjectSection && trimmed.startsWith("dependencies")) {
      inDependenciesBlock = true;
      nextLines.push(line);
      continue;
    }

    if (inDependenciesBlock) {
      if (trimmed.startsWith("]")) {
        if (!updated) {
          nextLines.push(`    "${packageName}==${fixVersion}",`);
          updated = true;
        }
        inDependenciesBlock = false;
        nextLines.push(line);
        continue;
      }

      const match = trimmed.match(/^"([A-Za-z0-9._-]+)(?:\[[^\]]+\])?\s*(?:==|===|~=|>=|<=|>|<)?\s*([A-Za-z0-9+_.-]+)?",?$/);
      if (match?.[1] && match[1].toLowerCase() === packageName.toLowerCase()) {
        nextLines.push(`    "${packageName}==${fixVersion}",`);
        updated = true;
        continue;
      }
    }

    nextLines.push(line);
  }

  if (!updated) {
    throw new Error("unable to update dependency in pyproject.toml automatically");
  }

  fs.writeFileSync(pyprojectPath, nextLines.join("\n"));
}

async function remediateProjectDependency(projectId, packageName, fixVersion) {
  const project = state.projects.get(projectId);
  if (!project) {
    throw new Error("project not found");
  }
  if (!packageName || !fixVersion) {
    throw new Error("package name and fix version are required");
  }

  const manager = project.package_manager || detectPackageManager(project.root);
  logAction(`REMEDIATE project=${project.label} manager=${manager} package=${packageName} fix=${fixVersion}`);

  if (manager === "npm") {
    await runProjectCommand("npm", ["install", `${packageName}@${fixVersion}`], project.root);
  } else if (manager === "poetry") {
    await runProjectCommand("poetry", ["add", `${packageName}@${fixVersion}`], project.root);
  } else if (manager === "pipenv") {
    await runProjectCommand("pipenv", ["install", `${packageName}==${fixVersion}`], project.root);
  } else if (manager === "requirements") {
    updateRequirementsFile(project.root, packageName, fixVersion);
  } else if (manager === "pyproject") {
    updatePyprojectDependency(project.root, packageName, fixVersion);
  } else {
    throw new Error(`automatic remediation is not supported for package manager "${manager}"`);
  }

  const scanResult = await scanProjectById(projectId, "remediation");
  return {
    ok: true,
    package_manager: manager,
    scan: scanResult
  };
}

function pruneManagedProcesses() {
  for (const [pid] of state.managedProcesses.entries()) {
    try {
      process.kill(pid, 0);
    } catch {
      state.managedProcesses.delete(pid);
    }
  }
}

function getServiceCommand() {
  return `"${process.execPath}" "${__filename}" start`;
}

async function installServiceTask() {
  if (process.platform !== "win32") {
    throw new Error("service installation is only supported on Windows in this release");
  }

  await runCommand("schtasks", [
    "/Create",
    "/TN",
    SERVICE_TASK_NAME,
    "/TR",
    getServiceCommand(),
    "/SC",
    "ONLOGON",
    "/F"
  ]);
}

async function uninstallServiceTask() {
  if (process.platform !== "win32") {
    throw new Error("service removal is only supported on Windows in this release");
  }

  await runCommand("schtasks", ["/Delete", "/TN", SERVICE_TASK_NAME, "/F"]);
}

async function isServiceInstalled() {
  if (process.platform !== "win32") return false;

  try {
    await runCommand("schtasks", ["/Query", "/TN", SERVICE_TASK_NAME]);
    return true;
  } catch {
    return false;
  }
}

async function readLocalHealth() {
  try {
    const response = await fetch(`http://127.0.0.1:${LOCAL_PORT}/health`);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function checkCloudAuth() {
  const cloud = getCloudConfig();

  try {
    const response = await fetch(`${cloud.http}/api/agents/me?machine_id=${encodeURIComponent(loadOrCreateId())}`, {
      headers: { "content-type": "application/json" }
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return { ok: false, status: response.status, reason: body.error || response.statusText };
    }
    return { ok: true, status: response.status };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

function redactCloudConfig(cloud = {}) {
  return {
    ...cloud,
    agentToken: cloud.agentToken ? "<legacy>" : "",
    agentSessionId: cloud.agentSessionId ? "<configured>" : ""
  };
}

function getAutomationConfig() {
  return readConfig().automation || DEFAULT_AUTOMATION;
}

function withJitter(ms, ratio = 0.2) {
  const base = Number(ms) || 0;
  const spread = Math.max(0, base * ratio);
  return Math.max(1000, Math.round(base - spread + Math.random() * spread * 2));
}

function buildAgentStatusPayload() {
  const config = readConfig();
  return {
    machine_id: state.machineId,
    hostname: os.hostname(),
    os: os.platform(),
    status: {
      ws_connected: state.wsConnected,
      projects: state.projects.size,
      managed_processes: state.managedProcesses.size,
      root_watchers: state.rootWatchers.size,
      project_watchers: state.projectWatchers.size,
      watch_roots: config.watchRoots || [],
      last_export_at: state.lastExportAt,
      last_automation_run_at: state.lastAutomationRunAt,
      last_automation_reason: state.lastAutomationReason,
      observed_at: new Date().toISOString()
    },
    automation: getAutomationConfig()
  };
}

async function sendHttpHeartbeat() {
  const cloud = getCloudConfig();

  try {
    const response = await fetch(`${cloud.http.replace(/\/$/, "")}/api/agents/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildAgentStatusPayload())
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `cloud returned ${response.status}`);
    }
    return true;
  } catch (error) {
    logAction(`heartbeat failed message=${error.message}`);
    return false;
  }
}

function printUsage() {
  console.log(`
Sentry Agent

Usage:
  sentry-agent setup [--cloud <url>]
  sentry-agent start
  sentry-agent status
  sentry-agent enroll [--cloud <url>] [--label <label>]
  sentry-agent config
  sentry-agent config path
  sentry-agent config add-watch-root <path>
  sentry-agent config remove-watch-root <path>
  sentry-agent config set-cloud-http <url>
  sentry-agent config set-cloud-ws <url>
  sentry-agent config set-session <session-id>
  sentry-agent install-service
  sentry-agent uninstall-service
`);
}

async function runSetup(args = []) {
  ensureAgentHome();
  const current = readConfig();
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    console.log("Sentry Agent setup");
    console.log(`Config path: ${CONFIG_PATH}`);

    const defaultRoots = current.watchRoots.length > 0 ? current.watchRoots : getDefaultWatchRoots();
    const rootsInput = await rl.question(
      `Watch roots (semicolon separated) [${defaultRoots.join("; ")}]: `
    );
    const resolvedRoots =
      rootsInput.trim().length > 0
        ? parsePathInput(rootsInput)
        : uniquePaths(defaultRoots);

    const argCloud = getArgValue(args, "--cloud");
    const cloudHttpInput = argCloud
      ? argCloud
      : await rl.question(`Cloud Brain URL [${current.cloud.http || DEFAULT_CLOUD_HTTP}]: `);
    const cloudHttp = (cloudHttpInput.trim() || current.cloud.http || DEFAULT_CLOUD_HTTP).replace(/\/$/, "");

    const enrollment = await enrollWithCloud({
      cloudHttp
    });
    const agentSessionId = enrollment.agentSessionId;
    const cloudWs = enrollment.cloud?.ws || current.cloud.ws || "";
    console.log("Agent session registered with Cloud Brain.");

    const installServiceInput = await rl.question("Install Windows background startup task? [Y/n]: ");

    const nextConfig = saveConfig({
      ...current,
      cloud: {
        http: cloudHttp,
        ws: cloudWs,
        agentSessionId,
        agentToken: ""
      },
      watchRoots: resolvedRoots,
      ignorePatterns: current.ignorePatterns || DEFAULT_IGNORE_PATTERNS
    });

    console.log(`Saved configuration to ${CONFIG_PATH}`);
    console.log(`Machine ID: ${loadOrCreateId()}`);
    console.log(`Watch roots: ${nextConfig.watchRoots.length > 0 ? nextConfig.watchRoots.join(", ") : "(none configured)"}`);

    const nodeProjects = findNodeProjectsUnderRoots(nextConfig.watchRoots, {
      ignorePatterns: nextConfig.ignorePatterns
    });
    if (nodeProjects.length > 0) {
      const runtimeInput = await rl.question(
        `Install optional ${RUNTIME_PACKAGE_NAME} into ${nodeProjects.length} detected Node project(s)? [y/N]: `
      );
      if (/^y/i.test(runtimeInput.trim())) {
        const runtimeResult = await installRuntimeIntegration(nodeProjects);
        console.log(`Runtime integration installed in ${runtimeResult.installed.length} project(s).`);
        if (runtimeResult.failed.length > 0) {
          console.log(`Runtime integration failed in ${runtimeResult.failed.length} project(s):`);
          for (const failure of runtimeResult.failed) {
            console.log(`- ${failure.root}: ${failure.error}`);
          }
        }
        console.log(`Add this as the first import in each Node app entrypoint:`);
        console.log(`import "${RUNTIME_PACKAGE_NAME}";`);
      }
    } else {
      console.log("No Node projects detected for optional runtime integration.");
    }

    const shouldInstallService = !/^n/i.test(installServiceInput.trim() || "y");
    if (shouldInstallService) {
      try {
        await installServiceTask();
        console.log("Windows startup task installed.");
      } catch (error) {
        console.log(`Windows startup task installation failed: ${error.message}`);
      }
    }
  } finally {
    rl.close();
  }
}

async function runStatus() {
  const config = readConfig();
  const health = await readLocalHealth();
  const serviceInstalled = await isServiceInstalled();
  const cloudAuth = await checkCloudAuth();
  const summary = {
    machine_id: loadOrCreateId(),
    config_path: CONFIG_PATH,
    running: Boolean(health),
    service_installed: serviceInstalled,
    watch_roots: config.watchRoots || [],
    legacy_monitored_projects: (config.monitoredProjects || []).length,
    automation: config.automation || DEFAULT_AUTOMATION,
    last_automation_run_at: state.lastAutomationRunAt,
    has_agent_session: Boolean(config.cloud?.agentSessionId || config.cloud?.agentToken),
    cloud_auth: cloudAuth,
    cloud: redactCloudConfig(config.cloud),
    local_health: health
  };

  console.log(JSON.stringify(summary, null, 2));
}

function runConfigCommand(args = []) {
  const [subcommand, ...rest] = args;
  const current = readConfig();

  if (!subcommand) {
    console.log(JSON.stringify({
      config_path: CONFIG_PATH,
      resolved: current
    }, null, 2));
    return;
  }

  if (subcommand === "path") {
    console.log(CONFIG_PATH);
    return;
  }

  if (subcommand === "set-cloud-http") {
    const value = rest.join(" ").trim();
    if (!value) throw new Error("cloud HTTP URL is required");
    console.log(JSON.stringify(saveConfig({
      ...current,
      cloud: {
        ...current.cloud,
        http: value
      }
    }), null, 2));
    return;
  }

  if (subcommand === "set-cloud-ws") {
    const value = rest.join(" ").trim();
    if (!value) throw new Error("cloud WebSocket URL is required");
    console.log(JSON.stringify(saveConfig({
      ...current,
      cloud: {
        ...current.cloud,
        ws: value
      }
    }), null, 2));
    return;
  }

  if (subcommand === "set-session") {
    const value = rest.join(" ").trim();
    if (!value) throw new Error("agent session id is required");
    console.log(JSON.stringify(saveConfig({
      ...current,
      cloud: {
        ...current.cloud,
        agentSessionId: value,
        agentToken: ""
      }
    }), null, 2));
    return;
  }

  if (subcommand === "add-watch-root") {
    const value = rest.join(" ").trim();
    if (!value) throw new Error("watch root path is required");
    console.log(JSON.stringify(saveConfig({
      ...current,
      watchRoots: uniquePaths([...(current.watchRoots || []), value])
    }), null, 2));
    return;
  }

  if (subcommand === "remove-watch-root") {
    const value = safeResolve(rest.join(" ").trim());
    if (!value) throw new Error("watch root path is required");
    console.log(JSON.stringify(saveConfig({
      ...current,
      watchRoots: (current.watchRoots || []).filter((entry) => safeResolve(entry) !== value)
    }), null, 2));
    return;
  }

  throw new Error(`unknown config subcommand: ${subcommand}`);
}

function getArgValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || index === args.length - 1) return "";
  return args[index + 1];
}

async function runEnroll(args = []) {
  const current = readConfig();
  const cloudHttp = (getArgValue(args, "--cloud") || current.cloud.http).replace(/\/$/, "");
  const label = getArgValue(args, "--label") || os.hostname();

  const enrollment = await enrollWithCloud({
    cloudHttp,
    label
  });
  const cloudWs = enrollment.cloud?.ws || current.cloud.ws || `${cloudHttp.replace(/^http/i, "ws")}/agents`;
  const next = saveConfig({
    ...current,
    cloud: {
      ...current.cloud,
      http: enrollment.cloud?.http || cloudHttp,
      ws: cloudWs,
      agentSessionId: enrollment.agentSessionId,
      agentToken: ""
    }
  });

  console.log(JSON.stringify({
    ok: true,
    machine_id: state.machineId || loadOrCreateId(),
    cloud: next.cloud,
    agent: enrollment.agent
  }, null, 2));
}

app.post("/register", async (req, res) => {
  const payload = req.body || {};
  const projectRoot = payload.project?.root || payload.cwd;
  const packages = dedupePackages(payload.packages || []);

  if (!payload.pid || !projectRoot || !Array.isArray(payload.packages)) {
    return res.status(400).json({ error: "pid, project.root (or cwd), and packages are required" });
  }

  const snapshot = buildProjectSnapshot(projectRoot, {
    label: payload.project?.label,
    name: payload.project?.name,
    ecosystems: payload.project?.ecosystems,
    source: payload.source || "runtime-hook",
    observedAt: payload.observed_at,
    process: payload.process || null,
    pid: payload.pid,
    snapshotHash: payload.snapshot_hash
  });

  if (!snapshot) {
    return res.status(400).json({ error: "unable to resolve a project-scoped inventory from runtime hook payload" });
  }

  snapshot.packages = packages.length > 0 ? packages : snapshot.packages;
  snapshot.snapshotHash = payload.snapshot_hash || createSnapshotHash(snapshot.project.root, snapshot.packages);

  logAction(`HOOK pid=${payload.pid} project=${snapshot.project.label} pkgs=${snapshot.packages.length}`);
  const result = await ingestProjectSnapshot(snapshot);
  res.json({ status: "monitored", ...result });
});

app.post("/project-snapshot", async (req, res) => {
  const payload = req.body || {};
  const projectRoot = payload.project?.root;
  if (!projectRoot || !Array.isArray(payload.packages)) {
    return res.status(400).json({ error: "project.root and packages are required" });
  }

  const snapshot = buildProjectSnapshot(projectRoot, {
    label: payload.project?.label,
    name: payload.project?.name,
    ecosystems: payload.project?.ecosystems,
    source: payload.source || "manual-snapshot",
    observedAt: payload.observed_at,
    snapshotHash: payload.snapshot_hash
  });

  if (!snapshot) {
    return res.status(400).json({ error: "unable to resolve project snapshot" });
  }

  snapshot.packages = dedupePackages(payload.packages);
  snapshot.snapshotHash = payload.snapshot_hash || createSnapshotHash(snapshot.project.root, snapshot.packages);
  const result = await ingestProjectSnapshot(snapshot, { force: payload.force === true });
  res.json(result);
});

app.post("/event", (req, res) => {
  const { pid, type, detail, project_root: projectRoot } = req.body || {};
  logAction(`EVENT pid=${pid || "n/a"} type=${type || "unknown"} root=${projectRoot || "n/a"} detail=${JSON.stringify(detail || {})}`);
  res.json({ ok: true });
});

app.get("/projects", (_req, res) => {
  res.json({
    projects: Array.from(state.projects.values()).map((project) => ({
      ...project,
      packages: state.projectPackages.get(project.id) || []
    }))
  });
});

app.get("/health", (_req, res) => {
  const config = readConfig();
  res.json({
    ok: true,
    machine_id: state.machineId,
    projects: state.projects.size,
    managed_processes: state.managedProcesses.size,
    watch_roots: config.watchRoots || [],
    root_watchers: state.rootWatchers.size,
    project_watchers: state.projectWatchers.size,
    last_export_at: state.lastExportAt,
    last_automation_run_at: state.lastAutomationRunAt,
    last_automation_reason: state.lastAutomationReason,
    automation: config.automation || DEFAULT_AUTOMATION,
    ws_connected: state.wsConnected
  });
});

app.post("/projects/:id/remediate", async (req, res) => {
  try {
    const { package_name: packageName, fix_version: fixVersion } = req.body || {};
    const result = await remediateProjectDependency(req.params.id, packageName, fixVersion);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

function connectWs() {
  const cloud = getCloudConfig();
  if (!cloud.ws) {
    logAction("WS skipped because no Cloud WebSocket URL is configured");
    return;
  }
  const wsUrl = new URL(cloud.ws);
  wsUrl.searchParams.set("role", "agent");
  wsUrl.searchParams.set("machine_id", state.machineId);
  const ws = new WebSocket(wsUrl.toString());
  let heartbeatTimer = null;

  ws.on("open", () => {
    state.wsConnected = true;
    logAction("WS Connected");
    try {
      ws.send(JSON.stringify({ type: "HELLO", ...buildAgentStatusPayload() }));
    } catch {}

    heartbeatTimer = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "HEARTBEAT", ...buildAgentStatusPayload() }));
        } catch {}
      }
    }, getAutomationConfig().heartbeatIntervalMs);
  });

  ws.on("message", (raw) => {
    try {
      const message = JSON.parse(raw);
      if (message.type === "CVE_ALERT" && message.package) {
        cacheAlert(message);
        logAction(
          `ALERT project=${message.project_id || "n/a"} package=${message.package.name}@${message.package.version} severity=${message.severity}`
        );
        enforceMatchingProcesses(message);
      }
      if (message.type === "REMEDIATE_PACKAGE") {
        remediateProjectDependency(message.project_id, message.package?.name, message.fix_version)
          .then(() => {
            logAction(
              `REMEDIATE complete project=${message.project_id} package=${message.package?.name} fix=${message.fix_version}`
            );
          })
          .catch((error) => {
            logAction(
              `REMEDIATE failed project=${message.project_id} package=${message.package?.name} message=${error.message}`
            );
          });
      }
    } catch (error) {
      logAction(`WS message error ${error.message}`);
    }
  });

  ws.on("close", () => {
    state.wsConnected = false;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    setTimeout(connectWs, 5000);
  });

  ws.on("error", () => {
    state.wsConnected = false;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  });
}

function startHttpHeartbeatLoop() {
  const automation = getAutomationConfig();
  const send = () => {
    sendHttpHeartbeat().catch((error) => {
      logAction(`heartbeat failed message=${error.message}`);
    });
  };

  setTimeout(send, withJitter(1000, 0.8));
  if (automation.heartbeatIntervalMs > 0) {
    const scheduleNext = () => {
      setTimeout(() => {
        send();
        scheduleNext();
      }, withJitter(automation.heartbeatIntervalMs));
    };
    scheduleNext();
    logAction(`http heartbeat scheduled interval=${automation.heartbeatIntervalMs}ms jitter=20%`);
  }
}

function startAutomationLoop() {
  const automation = getAutomationConfig();
  let running = false;

  const run = async (reason) => {
    if (running) {
      logAction(`automation ${reason} skipped because a previous run is active`);
      return;
    }

    running = true;
    try {
      await runAutomatedRootDiscovery(reason);
    } catch (error) {
      logAction(`automation ${reason} failed message=${error.message}`);
    } finally {
      running = false;
    }
  };

  if (automation.rescanOnStart) {
    setTimeout(() => run("startup-rescan"), 1000);
  }

  if (automation.rescanIntervalMs > 0) {
    setInterval(() => run("scheduled-rescan"), automation.rescanIntervalMs);
    logAction(`automation scheduled rescan interval=${automation.rescanIntervalMs}ms`);
  }
}

async function startAgent() {
  state.machineId = loadOrCreateId();
  logAction(`Agent starting machine=${state.machineId}`);

  await registerMachine();

  app.listen(LOCAL_PORT, "127.0.0.1", () => {
    logAction(`System Agent listening on 127.0.0.1:${LOCAL_PORT}`);
  });

  await bootstrapConfiguredProjects();
  connectWs();
  startHttpHeartbeatLoop();
  startAutomationLoop();

  setInterval(pruneManagedProcesses, 30000);
}

async function main() {
  const command = process.argv[2] || "start";
  const args = process.argv.slice(3);

  switch (command) {
    case "start":
      await startAgent();
      return;
    case "setup":
      await runSetup(args);
      return;
    case "status":
      await runStatus();
      return;
    case "enroll":
      await runEnroll(args);
      return;
    case "config":
      runConfigCommand(args);
      return;
    case "install-service":
      await installServiceTask();
      console.log("Windows startup task installed.");
      return;
    case "uninstall-service":
      await uninstallServiceTask();
      console.log("Windows startup task removed.");
      return;
    case "help":
    case "--help":
    case "-h":
      printUsage();
      return;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exitCode = 1;
  }
}

process.on("uncaughtException", (error) => {
  logAction(`uncaught exception ${error.message}`);
});

process.on("unhandledRejection", (reason) => {
  logAction(`unhandled rejection ${String(reason)}`);
});

main().catch((error) => {
  logAction(`fatal error ${error.message}`);
});
