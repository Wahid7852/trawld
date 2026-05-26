import { useMemo, useState } from 'react'
import { remediateAlert } from '../api/alerts'

export default function Packages({ data, loading, onChange }) {
  const [query, setQuery]         = useState('')
  const [ecosystem, setEcosystem] = useState('all')
  const [busyKey, setBusyKey]     = useState('')

  const packages  = data?.packages || []
  const projects  = data?.projects || []

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
