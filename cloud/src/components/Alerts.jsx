import { useMemo, useState } from 'react'
import { acknowledgeAlert, remediateAlert as remediateAlertRequest } from '../api/alerts'

const SEV_STYLE = {
  critical: { badge: 'badge-red'    },
  high:     { badge: 'badge-yellow' },
  medium:   { badge: 'badge-blue'   },
  low:      { badge: 'badge-gray'   },
}

export default function Alerts({ data, loading, onChange }) {
  const [query, setQuery]       = useState('')
  const [severity, setSeverity] = useState('all')
  const [busyId, setBusyId]     = useState('')

  const alerts = useMemo(() => {
    return (data?.alerts || []).filter((alert) => {
      const matchesQuery = query.trim() === '' || [
        alert.package?.name, alert.cve_id, alert.project_name, alert.machine_id, alert.package?.version,
      ].filter(Boolean).some((v) => String(v).toLowerCase().includes(query.toLowerCase()))
      const matchesSeverity = severity === 'all' || alert.severity === severity
      return matchesQuery && matchesSeverity
    })
  }, [data?.alerts, query, severity])

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
