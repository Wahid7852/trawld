# trawld — Redesign & Rename Design Spec

**Date:** 2026-05-26
**Status:** Approved

## Overview

Rename and redesign the project currently called "Sentry" (local folder stays as `sentry/` for now). New name: **trawld**. The product is a package vulnerability monitor for developer fleets — trawling every enrolled machine's packages against the OSV database and surfacing findings in a real-time dashboard.

Two deliverables:
1. **Dashboard redesign** — Dark Pro aesthetic, sidebar nav, 4 pages, minimal
2. **Landing page** — separate static site, auto light/dark mode, pure HTML/CSS

---

## 1. Rename: Sentry → trawld

Every user-visible string, package name, command, and title changes. Internal code structure stays the same.

| Before | After |
|--------|-------|
| `@wahid7852/sentry-agent` | `@wahid7852/trawld-agent` |
| `@wahid7852/sentry-runtime-node` | `@wahid7852/trawld-runtime-node` |
| `sentry-agent` CLI command | `trawld` CLI command |
| "Sentry Supply Chain Security" | "trawld — package vulnerability monitoring" |
| All dashboard titles/headings | Updated to trawld |
| `README.md` | Rewritten for trawld |

The local folder `sentry/` is not renamed (git history, no breakage). The GitHub repo will be renamed separately by the user.

---

## 2. Dashboard Redesign

### 2.1 Design System

**Color palette (Dark Pro):**
```
--bg:           #0d1117   (page background)
--surface:      #161b22   (cards, sidebar)
--border:       #21262d   (all borders)
--border-hover: #30363d
--text-primary: #e6edf3
--text-secondary: #8b949e
--text-muted:   #7d8590
--green:        #3fb950   (online, success)
--green-bg:     #0f2817
--red:          #f85149   (critical, offline, error)
--red-bg:       #2d1115
--yellow:       #d29922   (high severity)
--yellow-bg:    #2d2008
--blue:         #388bfd   (medium severity, links)
--accent:       #238636   (buttons, logo mark)
```

**Typography:** System font stack (`-apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif`). Monospace elements use `'JetBrains Mono', 'Fira Code', monospace`. No external font imports in the dashboard (keep it fast).

**Spacing:** 8px base unit. Cards: 16px padding. Content area: 20px padding. Sidebar: 8px padding.

### 2.2 Layout

Replace the current `TopNav` + full-page route layout with a persistent sidebar shell.

```
┌─────────────────────────────────────────────┐
│  Sidebar (200px)  │  Main content           │
│                   │                         │
│  [w] trawld       │  Topbar (title + actions│
│                   │  ─────────────────────  │
│  ● Overview       │                         │
│  ○ Machines       │  Page content           │
│  ○ Alerts [3]     │                         │
│  ○ Packages       │                         │
│                   │                         │
│  ─────────────    │                         │
│  4 agents live    │                         │
└─────────────────────────────────────────────┘
```

**Sidebar contents:**
- Logo mark (`w`, green square) + "trawld" wordmark + version tag
- Nav section labeled "Monitor": Overview, Machines, Alerts (with unread badge), Packages
- Bottom: live agent count with pulsing green dot

**Topbar (per page):** Page title + subtitle (e.g. "Last sync 12s ago") + action buttons (right-aligned). Sticky, blurred background.

### 2.3 Pages

#### Overview (replaces OverviewPage + MasterDashboard)

4 metric cards in a row:
- Machines (online / total)
- Projects (fleet total)
- Packages (fleet total, ecosystem breakdown in subtitle)
- Open Findings (count, critical count in red subtitle)

Two-column card row below:
- Left: **Machines** — table rows (hostname, OS + project/pkg count, online/offline badge). Click row → opens machine slide-out.
- Right: **Recent Findings** — list (severity dot, package@version, machine/project, CVE id)

Full-width card below: **Activity feed** — timestamp (monospace) + event description + type badge.

Remove: fleet trends chart, doughnut charts, hero text, AgentOnboarding component, AgentAutomationPanel component.

#### Machines (replaces MachinesPage + MachineDetailPage)

Search bar + filter row at top.

Grid of machine cards (2-col on wide, 1-col on narrow):
- Hostname + online/offline badge
- OS, last heartbeat time
- Stats row: projects / packages / findings
- "Inspect" button → opens slide-out panel

**Machine slide-out panel** (replaces MachineDetailPage entirely):
- Slides in from the right, 440px wide, overlays main content with a backdrop
- Header: hostname, OS, close button
- Metric row: projects / packages / findings / risk score
- Projects list (scrollable)
- Recent findings for this machine
- "Rescan" button

#### Alerts (replaces AlertsPage)

Search + severity filter (All / Critical / High / Medium / Low).

Summary stat row: total in view / active / auto-update ready.

Table with columns: Severity (colored dot + label), Package (name + ecosystem badge + version), Scope (project name + machine), CVE (link), Fix version, Actions (Auto Update + Resolve buttons).

Remove: large hero description text at top.

#### Packages (replaces PackagesPage)

Search + ecosystem filter.

Summary stat row: total / with findings / fix available.

Table with columns: Package (name + ecosystem badge), Project, Version, Findings (count badge), Fix available, Actions.

Remove: large hero description text at top.

### 2.4 Components to Delete

- `AnalyticsPage.jsx` + route — cut entirely
- `Analytics.jsx` — cut entirely
- `AgentOnboarding.jsx` — cut (install instructions belong on landing page)
- `AgentAutomationPanel.jsx` — cut
- `TopNav.jsx` — replaced by Sidebar + per-page Topbar
- `MasterDashboard.jsx` — logic absorbed into new `OverviewPage`
- `Dashboard.jsx` — logic absorbed into machine slide-out panel

### 2.5 Components to Create/Rewrite

- `Sidebar.jsx` — new persistent sidebar
- `AppShell.jsx` — simplified, wraps `<Sidebar>` + `<Outlet>`
- `OverviewPage.jsx` — rewritten (no charts, no mockup text)
- `MachinesPage.jsx` — rewritten with slide-out
- `MachinePanel.jsx` — new slide-out component
- `AlertsPage.jsx` — cleaned up (remove hero text, tighten table)
- `PackagesPage.jsx` — cleaned up (remove hero text, tighten table)
- `MetricCard.jsx` — keep, minor style update

### 2.6 Router Changes

Remove `/analytics` route. Remove `/machines/:id` route (replaced by slide-out). Default route stays `/`.

---

## 3. Landing Page

### 3.1 Structure

New folder: `landing/` at repo root. Contains a single `index.html` + `style.css`. No build step. Deploys as a separate Vercel project pointing at the `landing/` directory.

### 3.2 Sections (top to bottom)

1. **Nav** — sticky, blurred. Logo + links (Docs, GitHub) + "Get started →" CTA button.
2. **Hero** — badge ("open source · v1.0.0"), H1 ("Package vulnerability monitoring / for developer fleets"), subtitle (plain English, no jargon), two CTAs (GitHub + See dashboard), terminal snippet showing `trawld setup` output.
3. **Stats bar** — 4 stats: packages scanned, heartbeat interval, OSV database, supported ecosystems.
4. **How it works** — 3 steps: Deploy cloud, Install agent, Open dashboard. Each has a code snippet.
5. **Features** — 4 feature cards: OSV matching, fleet view, live heartbeats, auto remediation.
6. **Dashboard preview** — browser chrome mockup showing the dashboard UI.
7. **Footer** — logo, links (GitHub, Docs, npm), "MIT License · built by Wahid Khan".

### 3.3 Light/Dark Mode

CSS custom properties on `:root` define the dark palette (default). A single `@media (prefers-color-scheme: light)` block overrides them. Zero JavaScript. Terminal snippets stay dark in both modes.

**Light mode palette:**
```
--bg:           #ffffff
--surface:      #f6f8fa
--border:       #d0d7de
--text-primary: #1f2328
--text-secondary: #656d76
--accent:       #1a7f37
```

### 3.4 Deployment

`vercel.json` in `landing/`:
```json
{ "buildCommand": null, "outputDirectory": "." }
```

Separate Vercel project named `trawld-landing`. Domain: `trawld.vercel.app` initially, custom domain `trawld.dev` when purchased.

---

## 4. Terminology

Never use "supply chain security" in any user-facing text. Use instead:
- "package vulnerability monitoring"
- "catch vulnerable packages before they ship"
- "package security for developer fleets"

---

## 5. Files Not Changing

- `server.js` — API routes unchanged, only string literals updated (e.g. log messages)
- `cloud/src/api.js` — unchanged
- MongoDB schema — unchanged
- Agent logic (`agent/index.js`) — unchanged except package name and CLI command name
- `runtime-node/index.js` — unchanged except package name

---

## Out of Scope

- Actual npm publish of renamed packages (user does this manually)
- GitHub repo rename (user does this manually)
- Custom domain purchase/setup
- Adding new features to the agent or dashboard
