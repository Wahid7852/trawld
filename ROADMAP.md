# VULN-PKG SENTRY — Project Roadmap

> Close the window between vulnerability disclosure and patch.  
> Do it automatically. Do it safely. Earn the trust to do it in production.

---

## The Problem We're Solving

The zero-day window isn't a detection problem — it's a **response latency problem**.

OSV knows about the vulnerability within hours. The CISO knows within days. The patch lands in production weeks or months later. That gap is where companies get breached.

The reason that gap exists isn't ignorance. It's fear. Fear that an automated system will upgrade `express` from `4.18.1` to `4.19.0` and silently break the payment service at 2am on a Friday. That fear is rational. The CISO who approves an automated patch owns every outage it causes. Red Hat built a billion-dollar business on the same insight: **trust, not technology, is the bottleneck**.

SENTRY's job is to make automated patching something a CISO can confidently approve — by proving the fix works before it touches production, building a complete audit trail, and giving teams a dial between "just tell me" and "handle it yourself."

---

## Current State (v1 — Done)

The detection layer is live:

- **Fleet Agent** (`/agent`) — scans local `package.json` / `requirements.txt`, heartbeats every 30s over WebSocket, POSTs full inventory to Cloud Brain.
- **Cloud Brain** (`/cloud`) — Express backend, MongoDB Atlas, OSV.dev real-time sync via `ingestModifiedCSV`, WebSocket alert broadcasting.
- **React Dashboard** — live fleet map, 30-day trend chart, severity breakdown, one-click alert acknowledgement.
- **Core Algorithms** — `versionMatches` (semver range matching), `normalizeSeverity` (CVSS → severity tier), `findFixedVersion` (branch-aware remediation), `ingestModifiedCSV` (concurrency-locked OSV ingestion).
- **VSS (Vulnerability Scoring System)** — CVSS × Environmental Multiplier × Exposure Factor.
- **Remediation Confidence Score** — ranks version bumps by semantic distance to flag likely breaking changes.

The system sees vulnerabilities fast. Now it needs to fix them safely.

---

## Phase 2 — LLM-Powered Patch Generation

> Goal: given a CVE and the affected package, generate the safest upgrade path — not just "go to latest" but the exact version bump that closes the vulnerability with the minimum risk of breaking anything.

The `findFixedVersion` algorithm already handles the semver logic. This phase makes it smarter.

### 2.1 Context-Aware Version Recommendation

Current `findFixedVersion` finds the nearest fixed version on the same major branch. This phase augments it with:

- [ ] **Changelog diff ingestion** — for npm packages, fetch the `CHANGELOG.md` or GitHub release notes between `current_version` and `fix_version`. Parse for breaking change markers (`BREAKING CHANGE`, `!`, major API removals).
- [ ] **Dependent API surface diff** — use `api-extractor` (TypeScript) or `jsdoc` AST comparison to detect removed or renamed exports between versions. Score as `api_surface_delta` (0 = identical, 1 = completely different).
- [ ] **Community signal aggregation** — pull GitHub issues/PRs tagged `breaking` or `regression` filed after `fix_version` was published. High issue velocity = risky upgrade.
- [ ] **`patch_confidence` composite score** — weighted combination of semver distance + API delta + community signal → 0–100%. Shown on every remediation card.

### 2.2 LLM Patch Advisor

- [ ] `cloud/src/llm/patchAdvisor.js` — calls Claude API with: CVE summary, current version, candidate fix version, changelog diff, API delta
- [ ] Returns structured JSON: `{ recommended_version, reasoning, risks[], estimated_breaking_change_probability, alternative_mitigations[] }`
- [ ] Prompt caching on CVE ID — one LLM call per CVE, cached in `cves` collection as `llm_analysis`. Never re-call for the same CVE+version pair.
- [ ] Dashboard: collapsible "AI Analysis" panel on each alert with the advisor output
- [ ] Fallback: if LLM is unavailable, fall back to raw `findFixedVersion` output (current behavior)

### 2.3 Code-Level Patch Suggestion (Insecure Usage)

For vulnerabilities where a version bump alone isn't enough (e.g., you're passing user input to a function that's safe in the new version only if called correctly):

- [ ] Agent-side static scan: detect insecure usage patterns against a rules library (e.g., `child_process.exec(req.body.cmd)`)
- [ ] If a usage pattern match is found, send the code snippet + CVE to the LLM advisor
- [ ] LLM returns a unified diff showing the safe usage
- [ ] Rendered as a diff preview in the dashboard alert detail panel
- [ ] "Open PR" button: creates a GitHub/GitLab PR with the patch applied

---

## Phase 3 — Patch Validation Sandbox

> Goal: before any automated patch touches a real machine, prove it works. The sandbox is not a malware scanner — it's a compatibility validator.

This is the core trust mechanism. A CISO can approve automated patching once they've seen that the system runs their tests against every proposed change and only proceeds if they pass.

### 3.1 Sandbox Infrastructure

- [ ] `sandbox/` directory — Docker-based isolated environment
- [ ] `sandbox/Dockerfile` — base image mirrors the agent's host environment (Node version, OS, installed global tools)
- [ ] Job queue: Bull (Redis-backed) — when a remediation is proposed, a validation job is enqueued automatically
- [ ] The sandbox job does exactly this, in order:
  1. Clone the affected project (or receive a manifest snapshot from the agent)
  2. Apply the proposed version bump to `package.json` / `requirements.txt`
  3. Run `npm install` / `pip install`
  4. Run the project's test suite (`npm test`, `pytest`, etc.) — agent reports the test command during registration
  5. If no test suite exists, run a smoke test: import the upgraded package, call its main export, assert no exception
  6. Capture: exit code, stdout/stderr, duration
- [ ] Result stored in `validation_results` collection: `{ alert_id, proposed_version, test_command, exit_code, duration_ms, stdout, status: "pass"|"fail"|"no_tests" }`

### 3.2 Validation Status on Dashboard

- [ ] Each alert card shows validation status badge: `✓ Tests Pass`, `✗ Tests Fail`, `⚠ No Tests Found`
- [ ] "View Test Output" expander shows the full sandbox stdout/stderr
- [ ] If `Tests Fail`: alert stays in `open` state, human review required, no auto-patch option
- [ ] If `Tests Pass` or `No Tests Found` (with warning): auto-patch option unlocked depending on the machine's autonomy tier (Phase 4)
- [ ] `no_tests` machines are flagged separately — operators can see which machines have zero test coverage

### 3.3 Regression Detection

- [ ] If the project has a test suite, compare test counts and pass rates between `current_version` and `fix_version` runs
- [ ] If `fix_version` run has fewer passing tests than `current_version` baseline → `REGRESSION_DETECTED`, block auto-patch even if overall exit code is 0
- [ ] Store baseline test metrics per machine in `test_baselines` collection, updated on every successful agent heartbeat

---

## Phase 4 — The Trust Layer (Autonomy Tiers)

> Goal: a graduated trust model that lets teams start with zero automation and progressively unlock it as confidence is established. This is the answer to the CISO problem.

The core insight from the field: **teams won't flip from "manual everything" to "auto-patch prod" in one step**. They need a dial. SENTRY's autonomy tier system is that dial — and every action at every tier is fully audited.

### 4.1 Tier Definitions

Each machine in the fleet is assigned an autonomy tier. Tiers can be set per machine, per environment tag, or fleet-wide.

| Tier | Name | What SENTRY Does |
|---|---|---|
| 0 | **Observe** | Detect vulnerabilities, show them on dashboard. Nothing automatic. |
| 1 | **Notify** | Detect + send Slack/email/PagerDuty alert with patch recommendation. |
| 2 | **Suggest** | Detect + open a GitHub/GitLab PR with the version bump. Human merges. |
| 3 | **Auto-Patch (Dev/Staging)** | Detect + validate in sandbox + apply patch automatically. Notify after. |
| 4 | **Auto-Patch (Production)** | Same as Tier 3, but applies to production machines. Requires `patch_confidence ≥ 90%` AND `validation_status = pass`. |

Tier 4 is the end state — but no one starts there. The typical path is 0 → 1 → 2 → 3, and teams move to 4 only after seeing months of Tier 3 working without incident.

### 4.2 Tier Implementation

- [ ] `tier` field added to `machines` collection (default: `0`)
- [ ] Tier management UI in dashboard: per-machine dropdown, bulk env-tag assignment
- [ ] Tier 1: webhook dispatcher (`cloud/src/notify/`) — Slack, PagerDuty, email adapters
- [ ] Tier 2: GitHub App / GitLab webhook integration — auto-open PR with version bump + AI analysis + validation status as PR description
- [ ] Tier 3/4: `PATCH` command sent to agent over existing WebSocket after sandbox validation passes
- [ ] Tier 4 hard guards: `patch_confidence < 90%` → downgrade to Tier 2 (PR only) for that specific alert, regardless of machine tier setting
- [ ] Tier 4 hard guards: `validation_status = fail` → block entirely, page human

### 4.3 Full Audit Trail

Every action at every tier is immutable and exportable. This is what a CISO actually needs to approve automation.

- [ ] `audit_log` collection: every alert detection, patch proposal, validation run, patch application, PR creation, human override — timestamped and attributed to actor (system or user)
- [ ] Audit export: CSV / JSON export filtered by date range, machine, CVE ID
- [ ] Dashboard "Audit Log" tab: searchable, filterable timeline of all system actions
- [ ] Retention: configurable (default 365 days), automatic purge after retention window

### 4.4 Human Override at Every Step

- [ ] Any auto-patch (Tier 3/4) can be blocked by an operator before it executes — alert has a 5-minute "cancel window" where a `CANCEL_PATCH` WebSocket message aborts the job
- [ ] Operators can manually downgrade any machine to Tier 0 instantly from the dashboard (emergency brake)
- [ ] All overrides logged to audit trail

---

## Phase 5 — Agent Intelligence & Delta Sync

> Goal: minimize agent footprint on production machines and add deeper inventory awareness.

### 5.1 Delta-Sync Inventory Model

Current agent sends full inventory on every heartbeat. On large machines this is wasteful.

- [ ] Agent maintains a local `manifest_hash` (SHA-256 of serialized package list)
- [ ] Heartbeat sends only the hash — Cloud Brain compares to stored hash
- [ ] If hashes differ, Cloud Brain requests a full sync; otherwise heartbeat is ~100 bytes
- [ ] Result: 99%+ of heartbeats require no inventory upload, drastically reducing Cloud Brain load and agent CPU time
- [ ] Force-sync every 24h regardless of hash match (state reconciliation)

### 5.2 Broader Ecosystem Coverage

Current agent handles `package.json` (npm) and `requirements.txt` (PyPI).

- [ ] `Gemfile.lock` → RubyGems ecosystem
- [ ] `go.sum` → Go modules
- [ ] `Cargo.lock` → Rust crates
- [ ] `composer.lock` → PHP Packagist
- [ ] `pom.xml` / `build.gradle` → Maven/Gradle (Java)
- [ ] System packages: `dpkg -l` (Debian/Ubuntu), `rpm -qa` (RHEL/CentOS), `brew list` (macOS)
- [ ] Each new ecosystem requires: parser + OSV ecosystem string mapping + agent test fixture

### 5.3 Test Suite Discovery

The sandbox needs to know how to run tests on each project. The agent handles discovery.

- [ ] On registration, agent introspects project root: check for `npm test`, `pytest`, `go test ./...`, `bundle exec rspec`
- [ ] Report `test_command` and `test_framework` to Cloud Brain
- [ ] If no test command found, report `test_discovery: false` — operator is notified to configure one
- [ ] Operators can manually override `test_command` per machine from the dashboard

---

## Phase 6 — CI/CD Native Integration

> Goal: bring SENTRY into the development workflow, not just the runtime.

### 6.1 GitHub Actions (SENTRY-Gate)

- [ ] Publish `sentry-gate` GitHub Action to GitHub Marketplace
- [ ] In a CI workflow: action sends the build's dependency manifest to Cloud Brain, waits for scan result
- [ ] If any `CRITICAL` vulnerability with `patch_confidence ≥ 80%` → action exits non-zero, failing the build
- [ ] Action outputs: `vulnerability_count`, `highest_severity`, `recommended_fixes` as step outputs
- [ ] Configurable failure threshold (default: CRITICAL only; can set to HIGH)
- [ ] PR comment bot: posts a formatted vulnerability summary table directly on the PR

### 6.2 Pre-Commit Hook

- [ ] `sentry-cli` package (npm + pip) with `sentry check` command
- [ ] Runs local inventory scan, calls Cloud Brain, prints results
- [ ] Can be registered as a pre-commit hook: blocks commit if new vulnerability introduced
- [ ] Respects `--severity-threshold` flag

### 6.3 GitLab CI / Jenkins

- [ ] GitLab: reusable `.gitlab-ci.yml` template include
- [ ] Jenkins: shared library step `sentryScan()`
- [ ] Both: same logic as GitHub Actions gate

---

## Phase 7 — Compliance & Enterprise Readiness

> Goal: give security teams the paper trail and integrations they need to actually deploy SENTRY in regulated environments.

- [ ] **SBOM Export** — CycloneDX 1.5 JSON / SPDX 2.3 per machine or fleet-wide, on-demand or scheduled
- [ ] **SIEM Integration** — Splunk HEC, Microsoft Sentinel, Elastic SIEM: alerts pushed as structured JSON events
- [ ] **Ticketing Integration** — Jira, ServiceNow, Linear: auto-create tickets for `CRITICAL` alerts with SENTRY dashboard deeplink
- [ ] **SSO / RBAC** — SAML 2.0 / OIDC login, role definitions: `viewer`, `operator`, `admin`; org-level tenant isolation in MongoDB
- [ ] **Air-Gapped Mode** — fully offline agent + Cloud Brain with a local OSV mirror (script to sync via USB/S3 from an internet-connected staging environment)
- [ ] **Attestation API** — `GET /api/attest/:machine_id` returns a signed JSON document asserting current vulnerability state (for supply chain compliance audits, e.g., US EO 14028 / SSDF)
- [ ] **Data Retention Controls** — configurable per-collection retention windows, automated purge jobs, GDPR-compliant data deletion by machine ID

---

## Open Problems / Research Directions

Things we don't know how to do well yet — contributions very welcome:

1. **Sandboxing Without a Test Suite** — most production services don't have a test suite the sandbox can run. What's the right smoke-test heuristic that actually catches regressions without false confidence?

2. **Breaking Changes in Dynamic Languages** — Python and JavaScript have no compile-time type checking. A function that changes its return type from `string` to `null` on an edge case will pass all tests until production. How do we catch this short of running a full integration test?

3. **Patch Rollback** — if an auto-patch (Tier 3/4) causes a production issue that wasn't caught by the sandbox, how do we roll back safely and atomically across a fleet of 1000 machines?

4. **Trust Calibration** — how do you measure whether your `patch_confidence` score is actually well-calibrated? If SENTRY says 95% confidence and the patch breaks things 10% of the time, the score is useless. We need a historical calibration dataset.

5. **Multi-Service Dependency Coordination** — if `service-A` and `service-B` both depend on `lib-X@1.2.3`, and we need to patch it, both services need to be patched and verified together. Cross-service patch orchestration is unsolved.

---

## How to Contribute

This is an OSS project. Everything above is a TODO, not a promise.

- Pick any unchecked item, open an issue, and claim it
- `ml/` — Python preferred (scikit-learn, PyTorch, ONNX)
- `agent/`, `cloud/` — Node.js (existing stack)
- `sandbox/` — Docker + shell scripting
- New ecosystem parsers (Ruby, Go, Rust, Java) are a great entry point

**Branch naming:** `feat/phase-N-description`  
**Issue labels:** `phase-2`, `phase-3`, `sandbox`, `trust-layer`, `good-first-issue`

---

## Timeline (Aspirational)

| Milestone | Target | Status |
|---|---|---|
| v1 — Fleet telemetry + OSV alerting | Done | ✅ |
| v2 — LLM patch advisor + patch confidence scoring | Q3 2026 | 🔲 |
| v3 — Sandbox patch validation | Q4 2026 | 🔲 |
| v4 — Autonomy tier system + audit trail | Q1 2027 | 🔲 |
| v5 — Delta-sync + multi-ecosystem coverage | Q1 2027 | 🔲 |
| v6 — CI/CD native integration (GitHub Actions, CLI) | Q2 2027 | 🔲 |
| v7 — Enterprise compliance suite | Q3 2027 | 🔲 |
