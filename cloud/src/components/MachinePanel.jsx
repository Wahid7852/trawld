export default function MachinePanel({ onClose }) {
  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <aside className="fixed top-0 right-0 h-full w-[440px] bg-tr-surface border-l border-tr-border z-50 flex items-center justify-center">
        <p className="text-tr-dim text-sm">Loading machine details…</p>
      </aside>
    </>
  )
}
