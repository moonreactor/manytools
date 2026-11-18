import { money } from "./Money";

const monthLabel = (m) =>
  new Date(`${m}-01T12:00:00`).toLocaleDateString("es-AR", { month: "short" });

// Barras de ingresos vs gastos de los últimos meses (SVG, sin dependencias).
export default function TrendChart({ data, selected }) {
  const W = 640, H = 240, pad = { t: 16, b: 32 };
  const innerH = H - pad.t - pad.b;
  const max = Math.max(1, ...data.flatMap((d) => [d.income, d.expense]));
  const slot = W / data.length;
  const bar = Math.min(26, slot / 3);
  const h = (v) => (v / max) * innerH;

  return (
    <div className="table-card pad">
      <div className="legend">
        <span><i className="dot pos-bg" /> Ingresos</span>
        <span><i className="dot neg-bg" /> Gastos</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="trend" role="img" aria-label="Tendencia de ingresos y gastos">
        <line x1="0" x2={W} y1={H - pad.b} y2={H - pad.b} className="axis" />
        {data.map((d, i) => {
          const cx = slot * i + slot / 2;
          return (
            <g key={d.month} className={d.month === selected ? "sel" : ""}>
              <rect x={cx - bar - 2} y={H - pad.b - h(d.income)} width={bar} height={h(d.income)} rx="5" className="pos-bg">
                <title>{`${d.month} · Ingresos ${money(d.income)}`}</title>
              </rect>
              <rect x={cx + 2} y={H - pad.b - h(d.expense)} width={bar} height={h(d.expense)} rx="5" className="neg-bg">
                <title>{`${d.month} · Gastos ${money(d.expense)}`}</title>
              </rect>
              <text x={cx} y={H - 10} textAnchor="middle" className="tick">
                {monthLabel(d.month)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
