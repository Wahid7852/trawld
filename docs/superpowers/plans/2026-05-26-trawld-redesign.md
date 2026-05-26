# trawld Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the project from Sentry to trawld, redesign the dashboard with a Dark Pro aesthetic and sidebar nav, and build a standalone landing page in `landing/`.

**Architecture:** The dashboard (React + Tailwind in `cloud/`) gets a full visual overhaul — new dark design system, sidebar replacing top nav, 4 pages with machine detail as a slide-out panel, Analytics page deleted. The landing page is a pure static HTML/CSS site in a new `landing/` folder that deploys as a separate Vercel project. All user-visible strings change from Sentry to trawld; internal API routes and hooks are left untouched.

**Tech Stack:** React 19, React Router v7, Tailwind CSS 3.4, Vite 7 (dashboard) · Pure HTML5/CSS3 with CSS custom properties (landing page)

---

## File Map

**Modified:**
- `agent/package.json` — rename package + bin
- `runtime-node/package.json` — rename package
- `cloud/package.json` — rename
- `cloud/tailwind.config.js` — add `tr-*` color palette
- `cloud/src/index.css` — rewrite with dark base styles
- `cloud/src/App.jsx` — remove analytics + machineDetail routes, remove Chart.js registration
- `cloud/src/layouts/AppShell.jsx` — replace TopNav with Sidebar, new layout shell
- `cloud/src/components/MetricCard.jsx` — full rewrite (dark style)
- `cloud/src/pages/OverviewPage.jsx` — full rewrite (no charts, no mockup text)
- `cloud/src/pages/MachinesPage.jsx` — rewrite to use slide-out panel
- `cloud/src/components/Alerts.jsx` — full rewrite (dark table)
- `cloud/src/components/Packages.jsx` — full rewrite (dark table)

**Created:**
- `cloud/src/components/Sidebar.jsx` — persistent sidebar nav
- `cloud/src/components/MachinePanel.jsx` — slide-out machine detail panel
- `landing/index.html` — full landing page markup
- `landing/style.css` — all landing styles, light/dark via `prefers-color-scheme`
- `landing/vercel.json` — static deployment config

**Deleted:**
- `cloud/src/components/TopNav.jsx`
- `cloud/src/components/MasterDashboard.jsx`
- `cloud/src/components/Dashboard.jsx`
- `cloud/src/components/Analytics.jsx`
- `cloud/src/components/AgentOnboarding.jsx`
- `cloud/src/components/AgentAutomationPanel.jsx`
- `cloud/src/components/ActivityFeed.jsx`
- `cloud/src/components/RecentAlerts.jsx`
- `cloud/src/pages/AnalyticsPage.jsx`
- `cloud/src/pages/MachineDetailPage.jsx`
- `cloud/src/hooks/useAnalytics.js`

---

## Task 1: Rename packages

**Files:**
- Modify: `agent/package.json`
- Modify: `runtime-node/package.json`
- Modify: `cloud/package.json`

- [ ] **Step 1: Update agent/package.json**

Replace the entire file with:

```json
{
  "name": "@wahid7852/trawld-agent",
  "version": "0.1.0",
  "description": "Global local agent for trawld that discovers project manifests, exports package inventory, and connects machines to the cloud",
  "type": "module",
  "main": "index.js",
  "bin": {
    "trawld": "./index.js"
  },
  "homepage": "https://www.npmjs.com/package/@wahid7852/trawld-agent",
  "bugs": {
    "url": "https://github.com/Wahid7852/Sentry/issues"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/Wahid7852/Sentry.git",
    "directory": "agent"
  },
  "license": "MIT",
  "author": "Wahid7852",
  "files": ["index.js", "README.md"],
  "scripts": { "start": "node index.js" },
  "engines": { "node": ">=18" },
  "publishConfig": { "access": "public" },
  "dependencies": {
    "express": "^5.2.1",
    "node-fetch": "^3.3.2",
    "uuid": "^9.0.1",
    "ws": "^8.17.0"
  }
}
```

- [ ] **Step 2: Update runtime-node/package.json**

Change `name` to `@wahid7852/trawld-runtime-node` and `description` to `Optional Node.js runtime hook for trawld — registers the current process with the local agent`.

- [ ] **Step 3: Update cloud/package.json**

Change `name` to `trawld-cloud`.

- [ ] **Step 4: Commit**

```bash
git add agent/package.json runtime-node/package.json cloud/package.json
git commit -m "chore: rename packages from sentry to trawld"
```

---

## Task 2: Design system

**Files:**
- Modify: `cloud/tailwind.config.js`
- Modify: `cloud/src/index.css`

- [ ] **Step 1: Update tailwind.config.js**

Replace entirely:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        tr: {
          bg:         '#0d1117',
          surface:    '#161b22',
          border:     '#21262d',
          'border-hi':'#30363d',
          text:       '#e6edf3',
          muted:      '#8b949e',
          dim:        '#7d8590',
          green:      '#3fb950',
          'green-bg': '#0f2817',
          red:        '#f85149',
          'red-bg':   '#2d1115',
          yellow:     '#d29922',
          'yellow-bg':'#2d2008',
          blue:       '#388bfd',
          accent:     '#238636',
          'accent-hi':'#2ea043',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'system-ui', 'sans-serif'],
        mono: ["'JetBrains Mono'", "'Fira Code'", 'monospace'],
      },
    },
  },
  plugins: [],
}
```

- [ ] **Step 2: Rewrite cloud/src/index.css**

Replace entirely:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html { scroll-behavior: smooth; color-scheme: dark; }
  body {
    @apply bg-tr-bg text-tr-text antialiased;
    font-family: -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif;
  }
  #root { @apply min-h-screen; }
}

@layer components {
  .card {
    @apply bg-tr-surface border border-tr-border rounded-lg;
  }
  .card-head {
    @apply px-4 py-2.5 border-b border-tr-border text-[10px] font-semibold text-tr-dim uppercase tracking-[0.7px] flex items-center justify-between;
  }
  .badge-green  { @apply bg-tr-green-bg text-tr-green; }
  .badge-red    { @apply bg-tr-red-bg text-tr-red; }
  .badge-yellow { @apply bg-tr-yellow-bg text-tr-yellow; }
  .badge-blue   { @apply bg-[#0d1f3c] text-tr-blue; }
  .badge-gray   { @apply bg-[#1c2128] text-tr-dim; }
  .status-badge {
    @apply px-2 py-0.5 rounded-full text-[10px] font-semibold;
  }
  .btn {
    @apply px-3 py-1.5 rounded-md text-[11px] font-medium border border-tr-border bg-tr-surface text-tr-muted hover:border-tr-border-hi hover:text-tr-text transition-colors cursor-pointer;
  }
  .btn-primary {
    @apply px-3 py-1.5 rounded-md text-[11px] font-semibold bg-tr-accent border border-tr-accent-hi text-white hover:bg-tr-accent-hi transition-colors cursor-pointer;
  }
  .input {
    @apply bg-tr-bg border border-tr-border rounded-md px-3 py-1.5 text-[12px] text-tr-text placeholder-tr-dim focus:outline-none focus:border-tr-border-hi;
  }
  .select {
    @apply bg-tr-bg border border-tr-border rounded-md px-3 py-1.5 text-[12px] text-tr-text focus:outline-none focus:border-tr-border-hi cursor-pointer;
  }
  .scrollbar::-webkit-scrollbar { width: 4px; }
  .scrollbar::-webkit-scrollbar-track { background: transparent; }
  .scrollbar::-webkit-scrollbar-thumb { @apply bg-tr-border rounded-full; }
}
```

- [ ] **Step 3: Verify dev server starts without errors**

```bash
cd cloud && npm run dev
```

Expected: Vite starts on port 3000. The page will look broken (no components updated yet) but no compile errors.

- [ ] **Step 4: Commit**

```bash
git add cloud/tailwind.config.js cloud/src/index.css
git commit -m "feat: add trawld dark pro design system"
```

---

## Task 3: Sidebar + AppShell + routing

**Files:**
- Create: `cloud/src/components/Sidebar.jsx`
- Modify: `cloud/src/layouts/AppShell.jsx`
- Modify: `cloud/src/App.jsx`

- [ ] **Step 1: Create cloud/src/components/Sidebar.jsx**

```jsx
import { NavLink } from 'react-router-dom'

const NAV = [
  { to: '/',          label: 'Overview'  },
  { to: '/machines',  label: 'Machines'  },
  { to: '/alerts',    label: 'Alerts'    },
  { to: '/packages',  label: 'Packages'  },
]

export default function Sidebar({ summary, wsConnected }) {
  const openAlerts = (summary?.alerts || []).filter((a) => a.status !== 'ack').length
  const onlineMachines = (summary?.machines || []).filter((m) => m.online).length

  return (
    <aside className="w-[200px] shrink-0 bg-tr-surface border-r border-tr-border flex flex-col min-h-screen sticky top-0">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-[18px] border-b border-tr-border">
        <div className="w-[22px] h-[22px] bg-tr-accent rounded flex items-center justify-center text-[11px] font-bold text-white font-mono">
          t
        </div>
        <span className="text-[13px] font-semibold text-tr-text tracking-[-0.2px]">trawld</span>
        <span className="ml-auto text-[10px] text-tr-dim font-mono">v1.0</span>
      </div>

      {/* Nav */}
      <nav className="px-2 pt-3 flex-1">
        <p className="text-[10px] text-tr-dim uppercase tracking-[0.8px] px-2 mb-1">Monitor</p>
        {NAV.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center justify-between gap-2 px-2 py-[6px] rounded-md text-[12px] mb-[1px] transition-colors ${
                isActive
                  ? 'bg-[#1f2937] text-tr-text'
                  : 'text-tr-dim hover:bg-[#1c2128] hover:text-tr-muted'
              }`
            }
          >
            <span>{label}</span>
            {label === 'Alerts' && openAlerts > 0 && (
              <span className="bg-tr-red text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                {openAlerts}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-tr-border">
        <div className="flex items-center gap-2 text-[11px] text-tr-dim px-1">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              wsConnected ? 'bg-tr-green' : 'bg-tr-dim'
            }`}
          />
          {onlineMachines} agent{onlineMachines !== 1 ? 's' : ''} live
        </div>
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: Rewrite cloud/src/layouts/AppShell.jsx**

Replace entirely (keep all data-fetching logic, change only the render):

```jsx
import { startTransition, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import useFleetSummary from '../hooks/useFleetSummary'
import { getSystemInfo, ingestNow } from '../api/system'
import { normalizeState } from '../utils/state'

const DEFAULT_SYSTEM_INFO = {
  public_cloud_url: window.location.origin,
  realtime_mode: 'http',
  open_agent_enrollment: true,
  state_version: 0,
  last_updated: ''
}

export default function AppShell() {
  const [refreshToken, setRefreshToken] = useState(0)
  const [wsConnected, setWsConnected] = useState(false)
  const [ingesting, setIngesting] = useState(false)
  const [systemInfo, setSystemInfo] = useState(DEFAULT_SYSTEM_INFO)
  const socketRef = useRef(null)
  const reconnectRef = useRef(null)
  const pollRef = useRef(null)
  const idlePollsRef = useRef(0)
  const { data: summary, loading: summaryLoading, setData: setSummary } = useFleetSummary(refreshToken)

  const requestRefresh = useEffectEvent(() => {
    setRefreshToken((current) => current + 1)
  })

  const pollSystemInfo = useEffectEvent(async () => {
    try {
      const next = await getSystemInfo()
      setSystemInfo((current) => {
        if ((next.state_version || 0) > (current.state_version || 0)) {
          idlePollsRef.current = 0
          startTransition(() => requestRefresh())
        } else {
          idlePollsRef.current += 1
        }
        return { ...current, ...next }
      })
    } catch (error) {
      console.error('System info polling failed:', error)
      idlePollsRef.current += 1
    }
  })

  useEffect(() => {
    getSystemInfo()
      .then((next) => setSystemInfo((current) => ({ ...current, ...next })))
      .catch((error) => console.error('Failed to load system info:', error))
  }, [])

  useEffect(() => {
    let isDisposed = false
    const useWebSocket = systemInfo.realtime_mode !== 'http'

    if (!useWebSocket) {
      setWsConnected(true)
      const schedulePoll = () => {
        const intervalMs = idlePollsRef.current >= 6 ? 30000 : idlePollsRef.current >= 2 ? 15000 : 5000
        pollRef.current = setTimeout(async () => {
          if (!isDisposed) { await pollSystemInfo(); schedulePoll() }
        }, intervalMs)
      }
      schedulePoll()
      return () => { isDisposed = true; if (pollRef.current) clearTimeout(pollRef.current) }
    }

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${protocol}//${window.location.host}/agents`)
      socketRef.current = ws
      ws.onopen = () => {
        if (isDisposed) return
        setWsConnected(true)
        ws.send(JSON.stringify({ type: 'DASHBOARD_HELLO' }))
      }
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          if (message.type === 'STATE_SYNC' && message.state) {
            startTransition(() => { setSummary(normalizeState(message.state)); setRefreshToken((c) => c + 1) })
            return
          }
          if (['MACHINE_UPDATE', 'PROJECT_UPDATE', 'INVENTORY_UPDATE', 'ALERT_UPDATE', 'AGENT_STATUS_UPDATE'].includes(message.type)) {
            setRefreshToken((c) => c + 1)
          }
        } catch (error) { console.error('WebSocket message error:', error) }
      }
      ws.onclose = () => { if (isDisposed) return; setWsConnected(false); reconnectRef.current = setTimeout(connect, 5000) }
      ws.onerror = () => { setWsConnected(false) }
    }
    connect()
    return () => {
      isDisposed = true
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      if (socketRef.current) socketRef.current.close()
    }
  }, [systemInfo.realtime_mode])

  useEffect(() => {
    if ((summary.state_version || 0) > (systemInfo.state_version || 0)) {
      setSystemInfo((current) => ({
        ...current,
        state_version: summary.state_version,
        last_updated: summary.last_updated || current.last_updated
      }))
    }
  }, [summary.state_version, summary.last_updated])

  const handleIngestNow = async () => {
    if (ingesting) return
    try {
      setIngesting(true)
      await ingestNow()
      requestRefresh()
    } catch (error) {
      console.error('Failed to sync OSV data:', error)
    } finally {
      setIngesting(false)
    }
  }

  const shellContext = useMemo(() => ({
    refreshToken,
    requestRefresh,
    systemInfo,
    summary,
    wsConnected,
    ingesting,
    onIngestNow: handleIngestNow,
  }), [refreshToken, systemInfo, summary, wsConnected, ingesting])

  return (
    <div className="flex min-h-screen bg-tr-bg">
      <Sidebar summary={summary} wsConnected={wsConnected} />
      <div className="flex-1 flex flex-col min-w-0">
        <Outlet context={shellContext} />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Rewrite cloud/src/App.jsx**

Remove AnalyticsPage, MachineDetailPage, and Chart.js registration:

```jsx
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './layouts/AppShell'
import OverviewPage from './pages/OverviewPage'
import MachinesPage from './pages/MachinesPage'
import AlertsPage from './pages/AlertsPage'
import PackagesPage from './pages/PackagesPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<OverviewPage />} />
          <Route path="/machines" element={<MachinesPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/packages" element={<PackagesPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
```

- [ ] **Step 4: Verify in browser**

Run `cd cloud && npm run dev`. Open http://localhost:3000. You should see the dark sidebar on the left with "trawld" logo, nav links, and a dark background. Pages will be blank/broken until Task 4+ but there should be no console errors.

- [ ] **Step 5: Commit**

```bash
git add cloud/src/components/Sidebar.jsx cloud/src/layouts/AppShell.jsx cloud/src/App.jsx
git commit -m "feat: add sidebar nav, rewrite AppShell layout"
```

---

## Task 4: MetricCard + OverviewPage

**Files:**
- Modify: `cloud/src/components/MetricCard.jsx`
- Modify: `cloud/src/pages/OverviewPage.jsx`

- [ ] **Step 1: Rewrite cloud/src/components/MetricCard.jsx**

```jsx
export default function MetricCard({ label, value, sub, danger }) {
  return (
    <div className="card p-4">
      <p className="text-[10px] text-tr-dim uppercase tracking-[0.5px] mb-1.5">{label}</p>
      <p className={`text-[22px] font-bold leading-none mb-1 ${danger ? 'text-tr-red' : 'text-tr-text'}`}>
        {value}
      </p>
      {sub && <p className="text-[10px] text-tr-dim">{sub}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Rewrite cloud/src/pages/OverviewPage.jsx**

```jsx
import { useState } from 'react'
import MetricCard from '../components/MetricCard'
import MachinePanel from '../components/MachinePanel'
import { scanMachine } from '../api/machines'
import useAppShell from '../hooks/useAppShell'
import useOverviewData from '../hooks/useOverviewData'

const SEV_COLOR = { critical: 'text-tr-red', high: 'text-tr-yellow', medium: 'text-tr-blue', low: 'text-tr-dim' }
const SEV_DOT   = { critical: 'bg-tr-red',  high: 'bg-tr-yellow',   medium: 'bg-tr-blue',  low: 'bg-[#3d444d]' }

function getTimeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function OverviewPage() {
  const { refreshToken, requestRefresh, systemInfo, ingesting, onIngestNow } = useAppShell()
  const { data, loading } = useOverviewData(refreshToken)
  const [selectedMachineId, setSelectedMachineId] = useState(null)

  const machines = data.machines || []
  const projects = data.projects || []
  const packages = data.packages || []
  const alerts   = data.alerts   || []

  const openAlerts     = alerts.filter((a) => a.status !== 'ack')
  const criticalAlerts = openAlerts.filter((a) => a.severity === 'critical')
  const onlineMachines = machines.filter((m) => m.online)

  const lastSyncAgo = systemInfo.last_updated ? getTimeAgo(systemInfo.last_updated) : '—'

  const handleScanAll = async () => {
    try {
      await Promise.all(machines.map((m) => scanMachine(m.uuid)))
      requestRefresh()
    } catch (error) {
      console.error('Failed to rescan fleet:', error)
    }
  }

  // Activity feed: merge machines + projects + alerts, sort by time, take 10
  const activity = [
    ...alerts.slice(0, 8).map((a) => ({
      type: 'alert',
      label: `${a.package?.name}@${a.package?.version}`,
      detail: `${a.project_name || a.project_id} · ${a.severity}`,
      badge: 'alert',
      time: new Date(a.updated_at || a.created_at),
    })),
    ...machines.slice(0, 6).map((m) => ({
      type: 'machine',
      label: m.hostname || m.uuid,
      detail: `${m.project_count || 0} projects · ${m.package_count || 0} pkgs`,
      badge: 'heartbeat',
      time: new Date(m.last_seen),
    })),
    ...projects.slice(0, 6).map((p) => ({
      type: 'project',
      label: p.label || p.name,
      detail: `${p.package_count || 0} packages`,
      badge: 'scan',
      time: new Date(p.last_seen),
    })),
  ]
    .filter((a) => !isNaN(a.time.getTime()))
    .sort((a, b) => b.time - a.time)
    .slice(0, 10)

  const BADGE_STYLE = {
    alert:     'badge-red',
    heartbeat: 'badge-green',
    scan:      'badge-gray',
  }

  return (
    <>
      {/* Topbar */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3.5 border-b border-tr-border bg-tr-bg/90 backdrop-blur">
        <div>
          <h1 className="text-[14px] font-semibold text-tr-text">Fleet Overview</h1>
          <p className="text-[11px] text-tr-dim">Last sync {lastSyncAgo}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={onIngestNow} disabled={ingesting}>
            {ingesting ? 'Syncing…' : 'Sync OSV'}
          </button>
          <button className="btn-primary" onClick={handleScanAll}>Rescan Fleet</button>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Metrics */}
        <div className="grid grid-cols-4 gap-3">
          <MetricCard
            label="Machines"
            value={machines.length}
            sub={`${onlineMachines.length} online`}
          />
          <MetricCard
            label="Projects"
            value={projects.length}
            sub="across fleet"
          />
          <MetricCard
            label="Packages"
            value={packages.length.toLocaleString()}
            sub="npm + PyPI"
          />
          <MetricCard
            label="Open Findings"
            value={openAlerts.length}
            sub={criticalAlerts.length > 0 ? `${criticalAlerts.length} critical` : 'none critical'}
            danger={criticalAlerts.length > 0}
          />
        </div>

        {/* Two-column */}
        <div className="grid grid-cols-2 gap-3">
          {/* Machines */}
          <div className="card">
            <div className="card-head">
              Machines
              <span className="text-tr-dim normal-case tracking-normal text-[10px]">click to inspect</span>
            </div>
            <div className="divide-y divide-tr-border">
              {loading ? (
                <p className="px-4 py-6 text-[12px] text-tr-dim">Loading…</p>
              ) : machines.length === 0 ? (
                <p className="px-4 py-6 text-[12px] text-tr-dim">No machines enrolled yet.</p>
              ) : (
                machines.map((m) => (
                  <button
                    key={m.uuid}
                    onClick={() => setSelectedMachineId(m.uuid)}
                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#1c2128] transition-colors text-left"
                  >
                    <div>
                      <p className="text-[12px] font-medium text-tr-text">{m.hostname || m.uuid}</p>
                      <p className="text-[10px] text-tr-dim mt-0.5">
                        {m.os || '—'} · {m.project_count || 0} projects · {m.package_count || 0} pkgs
                      </p>
                    </div>
                    <span className={`status-badge ${m.online ? 'badge-green' : 'badge-red'}`}>
                      {m.online ? 'online' : 'offline'}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Recent findings */}
          <div className="card">
            <div className="card-head">
              Recent Findings
              <span className="text-tr-dim normal-case tracking-normal text-[10px]">
                {openAlerts.length} unacknowledged
              </span>
            </div>
            <div className="divide-y divide-tr-border">
              {loading ? (
                <p className="px-4 py-6 text-[12px] text-tr-dim">Loading…</p>
              ) : openAlerts.length === 0 ? (
                <p className="px-4 py-6 text-[12px] text-tr-dim">No open findings.</p>
              ) : (
                openAlerts.slice(0, 8).map((a) => (
                  <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className={`w-1.5 h-1.5 rounded-sm shrink-0 mt-0.5 ${SEV_DOT[a.severity] || 'bg-tr-dim'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-medium text-tr-text truncate">
                        {a.package?.name}@{a.package?.version}
                      </p>
                      <p className="text-[10px] text-tr-dim truncate">
                        {a.project_name || a.project_id} · {a.machine_id}
                      </p>
                    </div>
                    <span className={`text-[10px] font-mono shrink-0 ${SEV_COLOR[a.severity] || 'text-tr-dim'}`}>
                      {a.cve_id || a.osv_id || '—'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Activity */}
        <div className="card">
          <div className="card-head">Activity</div>
          <div className="divide-y divide-tr-border">
            {activity.length === 0 ? (
              <p className="px-4 py-6 text-[12px] text-tr-dim">Waiting for agent activity…</p>
            ) : (
              activity.map((item, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-2.5">
                  <span className="text-[11px] text-tr-dim font-mono w-16 shrink-0">
                    {item.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <p className="text-[12px] text-tr-text flex-1 min-w-0 truncate">
                    {item.label} · {item.detail}
                  </p>
                  <span className={`status-badge ${BADGE_STYLE[item.badge]}`}>{item.badge}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Machine slide-out */}
      {selectedMachineId && (
        <MachinePanel
          machineId={selectedMachineId}
          refreshToken={refreshToken}
          onClose={() => setSelectedMachineId(null)}
          onRescan={async () => { await scanMachine(selectedMachineId); requestRefresh() }}
        />
      )}
    </>
  )
}
```

- [ ] **Step 3: Verify in browser**

Open http://localhost:3000. Overview page should render with dark metric cards, machines list, findings list, and activity feed. If agents are enrolled you'll see real data; otherwise empty states.

- [ ] **Step 4: Commit**

```bash
git add cloud/src/components/MetricCard.jsx cloud/src/pages/OverviewPage.jsx
git commit -m "feat: rewrite OverviewPage and MetricCard with dark pro design"
```

---

## Task 5: MachinesPage + MachinePanel

**Files:**
- Create: `cloud/src/components/MachinePanel.jsx`
- Modify: `cloud/src/pages/MachinesPage.jsx`

- [ ] **Step 1: Create cloud/src/components/MachinePanel.jsx**

```jsx
import { useEffect } from 'react'
import useMachineDetail from '../hooks/useMachineDetail'

const SEV_DOT = { critical: 'bg-tr-red', high: 'bg-tr-yellow', medium: 'bg-tr-blue', low: 'bg-[#3d444d]' }

export default function MachinePanel({ machineId, refreshToken, onClose, onRescan }) {
  const { data, loading } = useMachineDetail(machineId, refreshToken)
  const machine  = data.machine
  const detail   = data.data
  const projects = detail.projects || []
  const alerts   = (detail.alerts || []).filter((a) => a.status !== 'ack')
  const packages = detail.packages || []

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <aside className="fixed top-0 right-0 h-full w-[440px] bg-tr-surface border-l border-tr-border z-50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-tr-border shrink-0">
          <div>
            <h2 className="text-[14px] font-semibold text-tr-text">
              {loading ? '…' : machine?.hostname || machineId}
            </h2>
            <p className="text-[11px] text-tr-dim mt-0.5">{machine?.os || '—'}</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn" onClick={onRescan}>Rescan</button>
            <button
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-tr-border text-tr-dim hover:text-tr-text transition-colors"
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-[12px] text-tr-dim">Loading…</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto scrollbar">
            {/* Metrics */}
            <div className="grid grid-cols-3 gap-2 p-4">
              {[
                { label: 'Projects', value: projects.length },
                { label: 'Packages', value: packages.length },
                { label: 'Findings', value: alerts.length, danger: alerts.length > 0 },
              ].map(({ label, value, danger }) => (
                <div key={label} className="bg-tr-bg border border-tr-border rounded-md p-3">
                  <p className="text-[9px] text-tr-dim uppercase tracking-[0.5px] mb-1">{label}</p>
                  <p className={`text-[18px] font-bold leading-none ${danger ? 'text-tr-red' : 'text-tr-text'}`}>
                    {value}
                  </p>
                </div>
              ))}
            </div>

            {/* Projects */}
            <div className="mx-4 mb-3 card">
              <div className="card-head">Projects</div>
              <div className="divide-y divide-tr-border max-h-48 overflow-y-auto scrollbar">
                {projects.length === 0 ? (
                  <p className="px-4 py-3 text-[11px] text-tr-dim">No projects on this machine.</p>
                ) : (
                  projects.map((p) => (
                    <div key={p.id} className="flex items-center justify-between px-4 py-2">
                      <p className="text-[12px] text-tr-text truncate">{p.label || p.name}</p>
                      <span className="text-[10px] text-tr-dim shrink-0 ml-2">{p.package_count || 0} pkgs</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Findings */}
            <div className="mx-4 mb-4 card">
              <div className="card-head">
                Open Findings
                <span className="text-tr-dim normal-case tracking-normal text-[10px]">{alerts.length} total</span>
              </div>
              <div className="divide-y divide-tr-border max-h-64 overflow-y-auto scrollbar">
                {alerts.length === 0 ? (
                  <p className="px-4 py-3 text-[11px] text-tr-dim">No open findings.</p>
                ) : (
                  alerts.map((a) => (
                    <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className={`w-1.5 h-1.5 rounded-sm shrink-0 mt-0.5 ${SEV_DOT[a.severity] || 'bg-tr-dim'}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium text-tr-text truncate">
                          {a.package?.name}@{a.package?.version}
                        </p>
                        <p className="text-[10px] text-tr-dim truncate">{a.project_name || a.project_id}</p>
                      </div>
                      <span className="text-[10px] font-mono text-tr-blue shrink-0">
                        {a.cve_id || a.osv_id || '—'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </aside>
    </>
  )
}
```

- [ ] **Step 2: Rewrite cloud/src/pages/MachinesPage.jsx**

```jsx
import { useState } from 'react'
import MachinePanel from '../components/MachinePanel'
import { scanMachine } from '../api/machines'
import useAppShell from '../hooks/useAppShell'
import useMachines from '../hooks/useMachines'

export default function MachinesPage() {
  const { refreshToken, requestRefresh } = useAppShell()
  const { data, loading } = useMachines(refreshToken)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  const machines = (data?.machines || []).filter((m) => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return (
      (m.hostname || '').toLowerCase().includes(q) ||
      (m.uuid || '').toLowerCase().includes(q) ||
      (m.os || '').toLowerCase().includes(q)
    )
  })

  const handleScan = async (machineId) => {
    try {
      await scanMachine(machineId)
      requestRefresh()
    } catch (error) {
      console.error('Failed to rescan machine:', error)
    }
  }

  return (
    <>
      {/* Topbar */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3.5 border-b border-tr-border bg-tr-bg/90 backdrop-blur">
        <div>
          <h1 className="text-[14px] font-semibold text-tr-text">Machines</h1>
          <p className="text-[11px] text-tr-dim">{machines.length} enrolled</p>
        </div>
      </div>

      <div className="p-5">
        <input
          className="input w-full max-w-xs mb-4"
          placeholder="Search hostname, UUID, OS…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {loading ? (
          <p className="text-[12px] text-tr-dim">Loading…</p>
        ) : machines.length === 0 ? (
          <p className="text-[12px] text-tr-dim">No machines found.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {machines.map((m) => (
              <div key={m.uuid} className="card p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-tr-text truncate">{m.hostname || m.uuid}</p>
                    <p className="text-[10px] text-tr-dim font-mono mt-0.5 truncate">{m.uuid}</p>
                  </div>
                  <span className={`status-badge shrink-0 ml-2 ${m.online ? 'badge-green' : 'badge-red'}`}>
                    {m.online ? 'online' : 'offline'}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 mb-3">
                  {[
                    { label: 'OS',       value: m.os || '—' },
                    { label: 'Projects', value: m.project_count || 0 },
                    { label: 'Packages', value: m.package_count || 0 },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-tr-bg border border-tr-border rounded p-2">
                      <p className="text-[9px] text-tr-dim uppercase tracking-[0.5px]">{label}</p>
                      <p className="text-[12px] font-semibold text-tr-text truncate">{value}</p>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2">
                  <button className="btn text-[11px]" onClick={() => handleScan(m.uuid)}>Rescan</button>
                  <button className="btn-primary text-[11px]" onClick={() => setSelectedId(m.uuid)}>Inspect</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedId && (
        <MachinePanel
          machineId={selectedId}
          refreshToken={refreshToken}
          onClose={() => setSelectedId(null)}
          onRescan={async () => { await handleScan(selectedId); requestRefresh() }}
        />
      )}
    </>
  )
}
```

- [ ] **Step 3: Verify Machines page and slide-out**

Open http://localhost:3000/machines. You should see a grid of machine cards. Click "Inspect" on any machine → a slide-out panel should appear from the right with machine details. Press Escape or click the backdrop to close.

- [ ] **Step 4: Commit**

```bash
git add cloud/src/components/MachinePanel.jsx cloud/src/pages/MachinesPage.jsx
git commit -m "feat: rewrite MachinesPage with slide-out MachinePanel"
```

---

## Task 6: AlertsPage

**Files:**
- Modify: `cloud/src/components/Alerts.jsx`

- [ ] **Step 1: Rewrite cloud/src/components/Alerts.jsx**

Keep all filter/ack/remediate logic, replace the render completely:

```jsx
import { useMemo, useState } from 'react'
import { acknowledgeAlert, remediateAlert as remediateAlertRequest } from '../api/alerts'

const SEV_STYLE = {
  critical: { dot: 'bg-tr-red',    label: 'text-tr-red',    badge: 'badge-red'    },
  high:     { dot: 'bg-tr-yellow', label: 'text-tr-yellow', badge: 'badge-yellow' },
  medium:   { dot: 'bg-tr-blue',   label: 'text-tr-blue',   badge: 'badge-blue'   },
  low:      { dot: 'bg-[#3d444d]', label: 'text-tr-dim',    badge: 'badge-gray'   },
}

export default function Alerts({ data, loading, onChange }) {
  const [query, setQuery]       = useState('')
  const [severity, setSeverity] = useState('all')
  const [busyId, setBusyId]     = useState('')

  const alerts = useMemo(() => {
    return (data.alerts || []).filter((alert) => {
      const matchesQuery = query.trim() === '' || [
        alert.package?.name, alert.cve_id, alert.project_name, alert.machine_id, alert.package?.version,
      ].filter(Boolean).some((v) => String(v).toLowerCase().includes(query.toLowerCase()))
      const matchesSeverity = severity === 'all' || alert.severity === severity
      return matchesQuery && matchesSeverity
    })
  }, [data.alerts, query, severity])

  const activeFindings  = useMemo(() => alerts.filter((a) => a.status !== 'ack').length, [alerts])
  const autoUpdateReady = useMemo(() => alerts.filter((a) => a.fix && a.status !== 'ack').length, [alerts])

  const ackAlert = async (id) => {
    try { await acknowledgeAlert(id); onChange?.() }
    catch (error) { console.error('Failed to acknowledge alert:', error) }
  }

  const remediateAlert = async (id) => {
    try { setBusyId(id); await remediateAlertRequest(id); onChange?.() }
    catch (error) { console.error('Failed to queue remediation:', error) }
    finally { setBusyId('') }
  }

  return (
    <>
      {/* Topbar */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3.5 border-b border-tr-border bg-tr-bg/90 backdrop-blur">
        <div>
          <h1 className="text-[14px] font-semibold text-tr-text">Alerts</h1>
          <p className="text-[11px] text-tr-dim">{activeFindings} active findings</p>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Filters + stats */}
        <div className="flex items-center gap-3">
          <input
            className="input w-64"
            placeholder="Search package, CVE, project…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="select"
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
          >
            <option value="all">All severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <div className="ml-auto flex gap-4 text-[11px] text-tr-dim">
            <span><span className="text-tr-text font-semibold">{alerts.length}</span> in view</span>
            <span><span className="text-tr-text font-semibold">{activeFindings}</span> active</span>
            <span><span className="text-tr-text font-semibold">{autoUpdateReady}</span> auto-update ready</span>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <p className="text-[12px] text-tr-dim py-8">Loading…</p>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-tr-border">
                  {['Severity', 'Package', 'Scope', 'CVE', 'Fix', 'Actions'].map((h) => (
                    <th key={h} className="text-left px-4 py-2.5 text-[10px] text-tr-dim uppercase tracking-[0.5px] font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-tr-border">
                {alerts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-tr-dim text-center">No alerts match your filters.</td>
                  </tr>
                ) : (
                  alerts.map((a) => {
                    const sev = SEV_STYLE[a.severity] || SEV_STYLE.low
                    return (
                      <tr key={a.id} className="hover:bg-[#1c2128] transition-colors">
                        <td className="px-4 py-2.5">
                          <span className={`status-badge ${sev.badge}`}>{a.severity || '—'}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <p className="text-tr-text font-medium">{a.package?.name}</p>
                          <p className="text-[10px] text-tr-dim">{a.package?.ecosystem} · v{a.package?.version}</p>
                        </td>
                        <td className="px-4 py-2.5">
                          <p className="text-tr-text">{a.project_name || a.project_id}</p>
                          <p className="text-[10px] text-tr-dim">{a.machine_id}</p>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="text-tr-blue font-mono text-[10px]">{a.cve_id || a.osv_id || '—'}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="text-tr-muted text-[10px]">{a.fix || '—'}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex gap-1.5">
                            {a.fix && a.status !== 'ack' && (
                              <button
                                className="btn text-[10px] py-1 px-2"
                                disabled={busyId === a.id}
                                onClick={() => remediateAlert(a.id)}
                              >
                                {busyId === a.id ? '…' : 'Auto Update'}
                              </button>
                            )}
                            {a.status !== 'ack' && (
                              <button
                                className="btn text-[10px] py-1 px-2"
                                onClick={() => ackAlert(a.id)}
                              >
                                Resolve
                              </button>
                            )}
                            {a.status === 'ack' && (
                              <span className="text-[10px] text-tr-dim">Resolved</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 2: AlertsPage.jsx stays the same** (it just passes `data` and `loading` to `Alerts` — no changes needed).

- [ ] **Step 3: Verify Alerts page**

Open http://localhost:3000/alerts. You should see the dark table with severity badges, CVE links, and action buttons. Filters should work.

- [ ] **Step 4: Commit**

```bash
git add cloud/src/components/Alerts.jsx
git commit -m "feat: rewrite Alerts component with dark pro table design"
```

---

## Task 7: PackagesPage

**Files:**
- Modify: `cloud/src/components/Packages.jsx`

- [ ] **Step 1: Rewrite cloud/src/components/Packages.jsx**

Keep all filter/remediate logic, replace the render:

```jsx
import { useMemo, useState } from 'react'
import { remediateAlert } from '../api/alerts'

export default function Packages({ data, loading, onChange }) {
  const [query, setQuery]       = useState('')
  const [ecosystem, setEcosystem] = useState('all')
  const [busyKey, setBusyKey]   = useState('')

  const packages  = data.packages || []
  const projects  = data.projects || []

  const projectNameById = useMemo(
    () => new Map(projects.map((p) => [p.id, p.label || p.name])),
    [projects]
  )

  const filtered = useMemo(() => {
    return packages.filter((pkg) => {
      const matchesQuery = query.trim() === '' || [pkg.name, pkg.project_label, pkg.project_root, pkg.version, pkg.machine_id]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(query.toLowerCase()))
      const matchesEco = ecosystem === 'all' || pkg.ecosystem === ecosystem
      return matchesQuery && matchesEco
    })
  }, [packages, query, ecosystem])

  const projectsCovered = useMemo(() => new Set(filtered.map((p) => p.project_id)).size, [filtered])
  const withFindings    = useMemo(() => filtered.filter((p) => p.vulnerability_count > 0).length, [filtered])
  const autoUpdateReady = useMemo(() => filtered.filter((p) => p.remediation_alert_id && (p.fixes || []).length > 0).length, [filtered])

  const remediatePackage = async (alertId) => {
    try {
      setBusyKey(alertId)
      await remediateAlert(alertId)
      onChange?.()
    } catch (error) {
      console.error('Failed to queue remediation:', error)
    } finally {
      setBusyKey('')
    }
  }

  return (
    <>
      {/* Topbar */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3.5 border-b border-tr-border bg-tr-bg/90 backdrop-blur">
        <div>
          <h1 className="text-[14px] font-semibold text-tr-text">Packages</h1>
          <p className="text-[11px] text-tr-dim">{filtered.length.toLocaleString()} packages</p>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Filters + stats */}
        <div className="flex items-center gap-3">
          <input
            className="input w-64"
            placeholder="Search package, project, version…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select className="select" value={ecosystem} onChange={(e) => setEcosystem(e.target.value)}>
            <option value="all">All ecosystems</option>
            <option value="npm">npm</option>
            <option value="PyPI">PyPI</option>
          </select>
          <div className="ml-auto flex gap-4 text-[11px] text-tr-dim">
            <span><span className="text-tr-text font-semibold">{projectsCovered}</span> projects</span>
            <span><span className="text-tr-red font-semibold">{withFindings}</span> with findings</span>
            <span><span className="text-tr-text font-semibold">{autoUpdateReady}</span> auto-update ready</span>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <p className="text-[12px] text-tr-dim py-8">Loading…</p>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-tr-border">
                  {['Package', 'Project', 'Version', 'Findings', 'Fix', 'Actions'].map((h) => (
                    <th key={h} className="text-left px-4 py-2.5 text-[10px] text-tr-dim uppercase tracking-[0.5px] font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-tr-border">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-tr-dim text-center">No packages match your filters.</td>
                  </tr>
                ) : (
                  filtered.map((pkg, i) => (
                    <tr key={`${pkg.project_id}-${pkg.name}-${i}`} className="hover:bg-[#1c2128] transition-colors">
                      <td className="px-4 py-2.5">
                        <p className="text-tr-text font-medium">{pkg.name}</p>
                        <p className="text-[10px] text-tr-dim">{pkg.ecosystem}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="text-tr-text">{projectNameById.get(pkg.project_id) || pkg.project_label || pkg.project_id}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="font-mono text-tr-muted">{pkg.version}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        {pkg.vulnerability_count > 0 ? (
                          <span className="status-badge badge-red">{pkg.vulnerability_count}</span>
                        ) : (
                          <span className="text-tr-dim">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-[10px] text-tr-muted font-mono">
                          {(pkg.fixes || [])[0] || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {pkg.remediation_alert_id && (pkg.fixes || []).length > 0 ? (
                          <button
                            className="btn text-[10px] py-1 px-2"
                            disabled={busyKey === pkg.remediation_alert_id}
                            onClick={() => remediatePackage(pkg.remediation_alert_id)}
                          >
                            {busyKey === pkg.remediation_alert_id ? '…' : 'Auto Update'}
                          </button>
                        ) : (
                          <span className="text-tr-dim text-[10px]">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 2: Verify Packages page**

Open http://localhost:3000/packages. Dark table with package list, ecosystem badge, findings count, and auto-update buttons.

- [ ] **Step 3: Commit**

```bash
git add cloud/src/components/Packages.jsx
git commit -m "feat: rewrite Packages component with dark pro table design"
```

---

## Task 8: Delete dead code

**Files to delete:**
- `cloud/src/components/TopNav.jsx`
- `cloud/src/components/MasterDashboard.jsx`
- `cloud/src/components/Dashboard.jsx`
- `cloud/src/components/Analytics.jsx`
- `cloud/src/components/AgentOnboarding.jsx`
- `cloud/src/components/AgentAutomationPanel.jsx`
- `cloud/src/components/ActivityFeed.jsx`
- `cloud/src/components/RecentAlerts.jsx`
- `cloud/src/pages/AnalyticsPage.jsx`
- `cloud/src/pages/MachineDetailPage.jsx`
- `cloud/src/hooks/useAnalytics.js`

- [ ] **Step 1: Delete all dead files**

```bash
cd cloud/src && \
rm components/TopNav.jsx \
   components/MasterDashboard.jsx \
   components/Dashboard.jsx \
   components/Analytics.jsx \
   components/AgentOnboarding.jsx \
   components/AgentAutomationPanel.jsx \
   components/ActivityFeed.jsx \
   components/RecentAlerts.jsx \
   pages/AnalyticsPage.jsx \
   pages/MachineDetailPage.jsx \
   hooks/useAnalytics.js
```

- [ ] **Step 2: Run dev server and confirm no import errors**

```bash
cd cloud && npm run dev
```

Expected: Vite starts cleanly. No "Cannot find module" errors in the console.

- [ ] **Step 3: Build to confirm production bundle is clean**

```bash
cd cloud && npm run build
```

Expected: Build completes with no errors. Output in `public/`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete Analytics, AgentOnboarding, TopNav, and other dead components"
```

---

## Task 9: Landing page

**Files:**
- Create: `landing/index.html`
- Create: `landing/style.css`
- Create: `landing/vercel.json`

- [ ] **Step 1: Create landing/vercel.json**

```json
{
  "buildCommand": null,
  "outputDirectory": "."
}
```

- [ ] **Step 2: Create landing/style.css**

```css
/* === Variables === */
:root {
  --bg:        #080c10;
  --surface:   #0d1117;
  --card:      #161b22;
  --border:    #21262d;
  --border-hi: #30363d;
  --text:      #e6edf3;
  --muted:     #8b949e;
  --dim:       #7d8590;
  --green:     #3fb950;
  --green-bg:  rgba(35,134,54,0.12);
  --green-bdr: #238636;
  --red:       #f85149;
  --accent:    #238636;
  --accent-hi: #2ea043;
  --blue:      #388bfd;
  --term-bg:   #0d1117;
}

@media (prefers-color-scheme: light) {
  :root {
    --bg:        #ffffff;
    --surface:   #f6f8fa;
    --card:      #ffffff;
    --border:    #d0d7de;
    --border-hi: #afb8c1;
    --text:      #1f2328;
    --muted:     #656d76;
    --dim:       #8c959f;
    --green:     #1a7f37;
    --green-bg:  rgba(26,127,55,0.08);
    --green-bdr: #1a7f37;
    --accent:    #1a7f37;
    --accent-hi: #157f3b;
    --blue:      #0969da;
    /* terminal always stays dark */
    --term-bg:   #0d1117;
  }
}

/* === Reset === */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
a { color: inherit; text-decoration: none; }
button { cursor: pointer; font: inherit; }

/* === Nav === */
nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 48px;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(12px);
  z-index: 100;
}
.nav-logo { display: flex; align-items: center; gap: 8px; }
.nav-mark {
  width: 24px; height: 24px;
  background: var(--accent); border-radius: 5px;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; color: #fff;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}
.nav-wordmark { font-size: 14px; font-weight: 600; letter-spacing: -0.2px; }
.nav-links { display: flex; gap: 24px; }
.nav-links a { font-size: 13px; color: var(--muted); transition: color 0.15s; }
.nav-links a:hover { color: var(--text); }
.nav-actions { display: flex; gap: 8px; align-items: center; }
.btn-ghost {
  display: flex; align-items: center; gap: 5px;
  padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 500;
  border: 1px solid var(--border); background: var(--card); color: var(--muted);
  transition: border-color 0.15s, color 0.15s;
}
.btn-ghost:hover { border-color: var(--border-hi); color: var(--text); }
.btn-cta {
  padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 600;
  background: var(--accent); border: 1px solid var(--accent-hi); color: #fff;
  transition: background 0.15s;
}
.btn-cta:hover { background: var(--accent-hi); }

/* === Hero === */
.hero {
  padding: 88px 48px 60px;
  text-align: center;
  position: relative;
  overflow: hidden;
}
.hero::before {
  content: '';
  position: absolute; top: 0; left: 50%; transform: translateX(-50%);
  width: 640px; height: 360px;
  background: radial-gradient(ellipse at top, var(--green-bg) 0%, transparent 70%);
  pointer-events: none;
}
.hero-badge {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 12px; border-radius: 20px;
  border: 1px solid var(--green-bdr); background: var(--green-bg);
  font-size: 11px; font-weight: 500; color: var(--green); margin-bottom: 22px;
  font-family: 'JetBrains Mono', monospace;
}
.hero-badge::before { content: '●'; font-size: 7px; }
.hero h1 {
  font-size: 52px; font-weight: 800; line-height: 1.1;
  letter-spacing: -1.8px; color: var(--text);
  margin-bottom: 18px;
}
.hero h1 em { font-style: normal; color: var(--green); }
.hero-sub {
  font-size: 16px; color: var(--muted); max-width: 500px;
  margin: 0 auto 32px; line-height: 1.65;
}
.hero-actions { display: flex; gap: 10px; justify-content: center; margin-bottom: 48px; }
.btn-big {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 10px 22px; border-radius: 8px; font-size: 13px; font-weight: 600;
  background: var(--accent); border: 1px solid var(--accent-hi); color: #fff;
  transition: background 0.15s;
}
.btn-big:hover { background: var(--accent-hi); }
.btn-big-outline {
  padding: 10px 22px; border-radius: 8px; font-size: 13px; font-weight: 500;
  background: transparent; border: 1px solid var(--border); color: var(--muted);
  transition: border-color 0.15s, color 0.15s;
}
.btn-big-outline:hover { border-color: var(--border-hi); color: var(--text); }

/* === Terminal === */
.terminal {
  max-width: 540px; margin: 0 auto;
  border-radius: 10px; overflow: hidden;
  border: 1px solid var(--border);
  box-shadow: 0 20px 60px rgba(0,0,0,0.4);
}
.term-bar {
  background: #161b22; padding: 9px 14px;
  display: flex; align-items: center; gap: 6px;
  border-bottom: 1px solid var(--border);
}
.dot { width: 10px; height: 10px; border-radius: 50%; }
.dot-r { background: #ff5f57; } .dot-y { background: #ffbd2e; } .dot-g { background: #28c840; }
.term-title { margin: 0 auto; font-size: 11px; color: #7d8590; font-family: 'JetBrains Mono', monospace; }
.term-body {
  background: var(--term-bg); padding: 18px 20px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 12px; line-height: 1.9; color: #8b949e;
}
.t-green { color: #3fb950; }
.t-warn  { color: #d29922; }
.t-comment { color: #6e7681; }

/* === Stats bar === */
.stats {
  display: flex; justify-content: center; gap: 56px;
  padding: 28px 48px;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.stat-value { font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }
.stat-label { font-size: 11px; color: var(--muted); margin-top: 2px; }

/* === Sections === */
.section { padding: 64px 48px; max-width: 960px; margin: 0 auto; }
.section-eyebrow {
  font-size: 11px; font-weight: 600; color: var(--green);
  text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 10px;
  font-family: 'JetBrains Mono', monospace;
}
.section-title {
  font-size: 30px; font-weight: 700; letter-spacing: -0.6px; margin-bottom: 10px;
}
.section-sub { font-size: 14px; color: var(--muted); max-width: 440px; margin-bottom: 40px; }

/* === Steps === */
.steps { display: grid; grid-template-columns: repeat(3,1fr); gap: 16px; }
.step {
  background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 22px;
  transition: border-color 0.15s;
}
.step:hover { border-color: var(--border-hi); }
.step-num { font-size: 11px; font-weight: 600; color: var(--green); font-family: 'JetBrains Mono', monospace; margin-bottom: 10px; }
.step h3 { font-size: 14px; font-weight: 600; margin-bottom: 7px; }
.step p { font-size: 12px; color: var(--muted); line-height: 1.6; }
.step-code {
  margin-top: 12px; background: var(--surface); border: 1px solid var(--border);
  border-radius: 6px; padding: 9px 12px;
  font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--muted);
  white-space: pre;
}

/* === Features === */
.features-section { padding: 64px 48px; background: var(--surface); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.features-inner { max-width: 960px; margin: 0 auto; }
.features { display: grid; grid-template-columns: repeat(2,1fr); gap: 14px; }
.feature {
  background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 22px 24px;
}
.feature-icon {
  width: 30px; height: 30px; border-radius: 7px;
  background: var(--green-bg); border: 1px solid var(--green-bdr);
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; margin-bottom: 12px;
}
.feature h3 { font-size: 13px; font-weight: 600; margin-bottom: 5px; }
.feature p { font-size: 12px; color: var(--muted); line-height: 1.6; }

/* === Dashboard preview === */
.preview-section { padding: 64px 48px; }
.preview-section .section-title { text-align: center; }
.preview-section .section-eyebrow { text-align: center; display: block; }
.preview-wrap {
  max-width: 820px; margin: 32px auto 0;
  border: 1px solid #21262d; border-radius: 10px; overflow: hidden;
  box-shadow: 0 28px 80px rgba(0,0,0,0.5);
}
.preview-bar {
  background: #161b22; padding: 9px 14px;
  display: flex; align-items: center; gap: 6px;
  border-bottom: 1px solid #21262d;
}
.preview-url {
  margin: 0 auto; font-size: 11px; color: #7d8590;
  font-family: 'JetBrains Mono', monospace;
  background: #0d1117; padding: 2px 10px; border-radius: 4px;
  border: 1px solid #21262d;
}
.preview-body { background: #0d1117; display: flex; height: 300px; font-family: -apple-system,system-ui,sans-serif; }
.preview-sidebar { width: 150px; background: #161b22; border-right: 1px solid #21262d; padding: 10px 8px; flex-shrink: 0; }
.ps-logo { font-size: 12px; font-weight: 700; color: #e6edf3; padding: 5px 8px 10px; border-bottom: 1px solid #21262d; margin-bottom: 6px; font-family: monospace; }
.ps-nav { font-size: 11px; color: #7d8590; padding: 5px 8px; border-radius: 4px; margin-bottom: 1px; }
.ps-nav.active { background: #1f2937; color: #e6edf3; }
.preview-main { flex: 1; padding: 12px; overflow: hidden; }
.pm-metrics { display: grid; grid-template-columns: repeat(4,1fr); gap: 6px; margin-bottom: 8px; }
.pm-metric { background: #161b22; border: 1px solid #21262d; border-radius: 5px; padding: 8px 10px; }
.pm-label { font-size: 8px; color: #7d8590; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 3px; }
.pm-value { font-size: 16px; font-weight: 700; color: #e6edf3; }
.pm-value.red { color: #f85149; }
.pm-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.pm-card { background: #161b22; border: 1px solid #21262d; border-radius: 5px; overflow: hidden; }
.pm-head { font-size: 8px; color: #7d8590; text-transform: uppercase; letter-spacing: 0.4px; padding: 5px 8px; border-bottom: 1px solid #21262d; }
.pm-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; border-bottom: 1px solid #1c2128; font-size: 9px; color: #c9d1d9; }
.pm-row:last-child { border: none; }
.pm-badge { padding: 1px 5px; border-radius: 8px; font-size: 8px; font-weight: 600; }
.pm-bg { background: #0f2817; color: #3fb950; }
.pm-br { background: #2d1115; color: #f85149; }

/* === Footer === */
footer {
  padding: 32px 48px;
  border-top: 1px solid var(--border);
  display: flex; align-items: center; justify-content: space-between;
}
.footer-logo { font-size: 13px; font-weight: 600; color: var(--dim); font-family: 'JetBrains Mono', monospace; }
.footer-links { display: flex; gap: 20px; }
.footer-links a { font-size: 12px; color: var(--dim); transition: color 0.15s; }
.footer-links a:hover { color: var(--text); }
.footer-right { font-size: 11px; color: var(--border-hi); }

/* === Responsive === */
@media (max-width: 768px) {
  nav { padding: 12px 20px; }
  .nav-links { display: none; }
  .hero { padding: 60px 20px 40px; }
  .hero h1 { font-size: 34px; }
  .stats { gap: 28px; padding: 20px; flex-wrap: wrap; }
  .section { padding: 48px 20px; }
  .steps { grid-template-columns: 1fr; }
  .features { grid-template-columns: 1fr; }
  .features-section { padding: 48px 20px; }
  .preview-section { padding: 48px 20px; }
  footer { padding: 24px 20px; flex-direction: column; gap: 16px; text-align: center; }
}
```

- [ ] **Step 3: Create landing/index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>trawld — Package vulnerability monitoring for developer fleets</title>
  <meta name="description" content="trawld monitors every machine on your team, scans packages against the OSV database, and surfaces vulnerable dependencies before they reach production.">
  <link rel="stylesheet" href="style.css">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
</head>
<body>

<!-- NAV -->
<nav>
  <div class="nav-logo">
    <div class="nav-mark">t</div>
    <span class="nav-wordmark">trawld</span>
  </div>
  <div class="nav-links">
    <a href="#how-it-works">How it works</a>
    <a href="#features">Features</a>
    <a href="https://github.com/Wahid7852/Sentry" target="_blank" rel="noopener">GitHub</a>
  </div>
  <div class="nav-actions">
    <a class="btn-ghost" href="https://github.com/Wahid7852/Sentry" target="_blank" rel="noopener">
      <svg width="13" height="13" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
      GitHub
    </a>
    <a class="btn-cta" href="#how-it-works">Get started →</a>
  </div>
</nav>

<!-- HERO -->
<section class="hero">
  <div class="hero-badge">open source · v1.0.0</div>
  <h1>Package vulnerability<br>monitoring for <em>developer fleets</em></h1>
  <p class="hero-sub">
    trawld watches every machine on your team, scans packages against the OSV database,
    and surfaces vulnerable dependencies before they reach production.
  </p>
  <div class="hero-actions">
    <a class="btn-big" href="https://github.com/Wahid7852/Sentry" target="_blank" rel="noopener">
      <svg width="13" height="13" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
      View on GitHub
    </a>
    <a class="btn-big-outline" href="#dashboard">See the dashboard →</a>
  </div>

  <div class="terminal">
    <div class="term-bar">
      <div class="dot dot-r"></div>
      <div class="dot dot-y"></div>
      <div class="dot dot-g"></div>
      <span class="term-title">terminal</span>
    </div>
    <div class="term-body">
<span class="t-comment"># install the agent globally</span>
<span class="t-green">$</span> npm install -g @wahid7852/trawld-agent

<span class="t-green">$</span> trawld setup
  <span class="t-green">✔</span> Connected to cloud at https://trawld.vercel.app
  <span class="t-green">✔</span> Watching 3 project roots
  <span class="t-green">✔</span> Enrolled as dev-machine-01 · 420 packages indexed
  <span class="t-warn">⚠</span> 2 critical findings · open dashboard to review</div>
  </div>
</section>

<!-- STATS -->
<div class="stats">
  <div class="stat">
    <div class="stat-value">1,200+</div>
    <div class="stat-label">packages scanned per machine</div>
  </div>
  <div class="stat">
    <div class="stat-value">~15s</div>
    <div class="stat-label">heartbeat interval</div>
  </div>
  <div class="stat">
    <div class="stat-value">OSV</div>
    <div class="stat-label">vulnerability database</div>
  </div>
  <div class="stat">
    <div class="stat-value">npm + PyPI</div>
    <div class="stat-label">ecosystems supported</div>
  </div>
</div>

<!-- HOW IT WORKS -->
<section class="section" id="how-it-works">
  <p class="section-eyebrow">// how it works</p>
  <h2 class="section-title">Three steps to fleet coverage</h2>
  <p class="section-sub">Works on Linux, macOS, and Windows. No app-level code changes required.</p>
  <div class="steps">
    <div class="step">
      <p class="step-num">01 / deploy</p>
      <h3>Deploy the cloud brain</h3>
      <p>One-click Vercel deploy. Point it at a MongoDB database and you're done — it serves the dashboard and accepts agent connections.</p>
      <div class="step-code">vercel deploy ./cloud</div>
    </div>
    <div class="step">
      <p class="step-num">02 / install</p>
      <h3>Install the agent</h3>
      <p>Global npm package. The setup wizard chooses project folders, configures startup, and enrolls the machine with your cloud instance.</p>
      <div class="step-code">npm i -g @wahid7852/trawld-agent
trawld setup</div>
    </div>
    <div class="step">
      <p class="step-num">03 / watch</p>
      <h3>Open the dashboard</h3>
      <p>Your machine appears in the fleet, packages are indexed, and vulnerabilities are matched against OSV. Live heartbeats keep status current.</p>
      <div class="step-code">https://your-cloud.vercel.app</div>
    </div>
  </div>
</section>

<!-- FEATURES -->
<section class="features-section" id="features">
  <div class="features-inner">
    <p class="section-eyebrow">// features</p>
    <h2 class="section-title">Built for security-conscious teams</h2>
    <p class="section-sub" style="margin-bottom:32px">Every feature ships by default. Nothing to configure beyond the initial setup.</p>
    <div class="features">
      <div class="feature">
        <div class="feature-icon">🔍</div>
        <h3>Passive project discovery</h3>
        <p>The agent scans watched folders for package.json and requirements.txt. No code changes to your apps required.</p>
      </div>
      <div class="feature">
        <div class="feature-icon">⚡</div>
        <h3>OSV vulnerability matching</h3>
        <p>Package versions are checked against the Open Source Vulnerability database with semver-range matching to catch indirect exposure.</p>
      </div>
      <div class="feature">
        <div class="feature-icon">🖥️</div>
        <h3>Multi-machine fleet view</h3>
        <p>Every enrolled machine reports to one dashboard. See cross-fleet exposure at a glance and drill into any machine instantly.</p>
      </div>
      <div class="feature">
        <div class="feature-icon">🔄</div>
        <h3>Auto-remediation queue</h3>
        <p>One click sends a patch command back to the agent. It updates the package and reports the new version automatically.</p>
      </div>
    </div>
  </div>
</section>

<!-- DASHBOARD PREVIEW -->
<section class="preview-section" id="dashboard">
  <p class="section-eyebrow">// dashboard</p>
  <h2 class="section-title">Everything in one view</h2>
  <div class="preview-wrap">
    <div class="preview-bar">
      <div class="dot dot-r"></div>
      <div class="dot dot-y"></div>
      <div class="dot dot-g"></div>
      <div class="preview-url">https://trawld.vercel.app</div>
    </div>
    <div class="preview-body">
      <div class="preview-sidebar">
        <div class="ps-logo">trawld</div>
        <div class="ps-nav active">Overview</div>
        <div class="ps-nav">Machines</div>
        <div class="ps-nav">Alerts</div>
        <div class="ps-nav">Packages</div>
      </div>
      <div class="preview-main">
        <div class="pm-metrics">
          <div class="pm-metric"><div class="pm-label">Machines</div><div class="pm-value">4</div></div>
          <div class="pm-metric"><div class="pm-label">Projects</div><div class="pm-value">18</div></div>
          <div class="pm-metric"><div class="pm-label">Packages</div><div class="pm-value">1,204</div></div>
          <div class="pm-metric"><div class="pm-label">Findings</div><div class="pm-value red">7</div></div>
        </div>
        <div class="pm-cols">
          <div class="pm-card">
            <div class="pm-head">Machines</div>
            <div class="pm-row"><span>dev-machine-01</span><span class="pm-badge pm-bg">online</span></div>
            <div class="pm-row"><span>dev-machine-02</span><span class="pm-badge pm-bg">online</span></div>
            <div class="pm-row"><span>build-server</span><span class="pm-badge pm-br">offline</span></div>
            <div class="pm-row"><span>laptop-wahid</span><span class="pm-badge pm-bg">online</span></div>
          </div>
          <div class="pm-card">
            <div class="pm-head">Recent Findings</div>
            <div class="pm-row"><span style="color:#f85149">●</span> <span style="margin-left:4px">lodash@4.17.20</span><span style="color:#7d8590;font-size:8px">CRIT</span></div>
            <div class="pm-row"><span style="color:#f85149">●</span> <span style="margin-left:4px">axios@0.21.1</span><span style="color:#7d8590;font-size:8px">CRIT</span></div>
            <div class="pm-row"><span style="color:#d29922">●</span> <span style="margin-left:4px">requests@2.27.0</span><span style="color:#7d8590;font-size:8px">HIGH</span></div>
            <div class="pm-row"><span style="color:#388bfd">●</span> <span style="margin-left:4px">semver@5.7.1</span><span style="color:#7d8590;font-size:8px">MED</span></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- FOOTER -->
<footer>
  <span class="footer-logo">trawld</span>
  <div class="footer-links">
    <a href="https://github.com/Wahid7852/Sentry" target="_blank" rel="noopener">GitHub</a>
    <a href="https://www.npmjs.com/package/@wahid7852/trawld-agent" target="_blank" rel="noopener">npm</a>
  </div>
  <span class="footer-right">MIT License · built by Wahid Khan</span>
</footer>

</body>
</html>
```

- [ ] **Step 4: Verify landing page locally**

Open `landing/index.html` directly in a browser (no server needed). Check:
- Dark mode renders correctly (default)
- Switch your OS to light mode → page should switch to light palette automatically
- Terminal snippet stays dark in both modes
- Mobile: resize browser to <768px, nav links should hide, layout should stack

- [ ] **Step 5: Commit**

```bash
git add landing/
git commit -m "feat: add trawld landing page with auto light/dark mode"
```

---

## Spec coverage check

| Spec requirement | Task |
|---|---|
| Rename packages to trawld-* | Task 1 |
| Rename CLI command to `trawld` | Task 1 |
| Dark Pro color palette | Task 2 |
| Sidebar nav replacing TopNav | Task 3 |
| Remove AnalyticsPage route | Task 3 |
| Remove MachineDetailPage route | Task 3 |
| MetricCard dark redesign | Task 4 |
| OverviewPage: metrics + machines + findings + activity | Task 4 |
| MachinesPage: grid cards | Task 5 |
| MachinePanel: slide-out | Task 5 |
| AlertsPage: dark table + filters | Task 6 |
| PackagesPage: dark table + filters | Task 7 |
| Delete Analytics, AgentOnboarding, TopNav, etc. | Task 8 |
| Landing page HTML/CSS | Task 9 |
| Landing page light/dark via prefers-color-scheme | Task 9 |
| Landing page vercel.json | Task 9 |
| Terminology: no "supply chain" | All tasks — no instance of that phrase in any code |
