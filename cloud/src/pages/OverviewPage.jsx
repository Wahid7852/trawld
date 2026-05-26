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
