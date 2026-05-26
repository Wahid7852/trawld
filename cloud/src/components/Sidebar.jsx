import { NavLink } from 'react-router-dom'

const NAV = [
  { to: '/',          label: 'Overview'  },
  { to: '/machines',  label: 'Machines'  },
  { to: '/alerts',    label: 'Alerts'    },
  { to: '/packages',  label: 'Packages'  },
]

function isOnline(m) {
  if (!m.last_seen) return false
  return (Date.now() - new Date(m.last_seen).getTime()) / 1000 < 45
}

export default function Sidebar({ summary, wsConnected, open, onClose }) {
  const openAlerts = (summary?.alerts || []).filter((a) => a.status !== 'ack').length
  const onlineMachines = (summary?.machines || []).filter(isOnline).length

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={onClose}
        />
      )}

      <aside className={`
        fixed inset-y-0 left-0 z-50 w-[220px]
        md:sticky md:top-0 md:inset-y-auto md:left-auto md:z-auto md:w-[200px] md:min-h-screen
        bg-tr-surface border-r border-tr-border flex flex-col
        transition-transform duration-200
        ${open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 py-[18px] border-b border-tr-border">
          <div className="w-[22px] h-[22px] bg-tr-accent rounded flex items-center justify-center text-[11px] font-bold text-white font-mono">
            t
          </div>
          <span className="text-[13px] font-semibold text-tr-text tracking-[-0.2px]">trawld</span>
          <span className="ml-auto text-[10px] text-tr-dim font-mono">v1.0</span>
          {/* Close button - mobile only */}
          <button
            className="md:hidden ml-1 w-6 h-6 flex items-center justify-center text-tr-dim hover:text-tr-text"
            onClick={onClose}
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        {/* Nav */}
        <nav className="px-2 pt-3 flex-1">
          <p className="text-[10px] text-tr-dim uppercase tracking-[0.8px] px-2 mb-1">Monitor</p>
          {NAV.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={onClose}
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
        <div className="px-3 py-3 border-t border-tr-border space-y-1.5">
          <div className="flex items-center gap-2 text-[11px] text-tr-dim px-1">
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                wsConnected ? 'bg-tr-green' : 'bg-tr-dim'
              }`}
            />
            {onlineMachines} agent{onlineMachines !== 1 ? 's' : ''} live
          </div>
          <p className="text-[10px] text-tr-dim px-1">
            by{' '}
            <a
              href="https://github.com/Wahid7852"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-tr-text transition-colors"
            >
              Wahid Khan
            </a>
          </p>
        </div>
      </aside>
    </>
  )
}
