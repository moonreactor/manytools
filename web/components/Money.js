const fmt = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
});

export const money = (n) => fmt.format(n);

// Muestra el monto con los decimales atenuados (estilo Portfolio).
export default function Money({ value }) {
  return (
    <span>
      {fmt.formatToParts(value).map((p, i) =>
        p.type === "decimal" || p.type === "fraction" ? (
          <span key={i} className="dec">
            {p.value}
          </span>
        ) : (
          p.value
        )
      )}
    </span>
  );
}
