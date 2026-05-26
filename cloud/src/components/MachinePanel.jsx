import { useEffect } from 'react'
import useMachineDetail from '../hooks/useMachineDetail'

const SEV_DOT = { critical: 'bg-tr-red', high: 'bg-tr-yellow', medium: 'bg-tr-blue', low: 'bg-[#3d444d]' }

export default function MachinePanel({ machineId, refreshToken, onClose, onRescan }) {
  const { data, loading } = useMachineDetail(machineId, refreshToken)
  const machine  = data?.machine
  const detail   = data?.data || {}
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
