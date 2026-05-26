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
