import { useState } from 'react'
import MachinePanel from '../components/MachinePanel'
import { scanMachine } from '../api/machines'
import useAppShell from '../hooks/useAppShell'
import useMachines from '../hooks/useMachines'

function getTimeAgo(dateStr) {
  if (!dateStr) return '—'
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000
  if (diff < 0) return 'just now'
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {machines.map((m) => (
              <div key={m.uuid} className="card p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-tr-text truncate">{m.hostname || m.uuid}</p>
                    <p className="text-[10px] text-tr-dim mt-0.5 truncate">{m.os || '—'} · {getTimeAgo(m.last_seen)}</p>
                  </div>
                  <span className={`status-badge shrink-0 ml-2 ${m.online ? 'badge-green' : 'badge-red'}`}>
                    {m.online ? 'online' : 'offline'}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 mb-3">
                  {[
                    { label: 'Projects', value: m.project_count || 0 },
                    { label: 'Packages', value: m.package_count || 0 },
                    { label: 'Findings', value: m.alert_count || 0 },
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
          onRescan={() => handleScan(selectedId)}
        />
      )}
    </>
  )
}
