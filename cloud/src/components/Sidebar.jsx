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
