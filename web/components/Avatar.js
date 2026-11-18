export default function Avatar({ name, color, size = 20 }) {
  return (
    <span
      className="avatar"
      style={{ background: color, width: size, height: size, fontSize: size * 0.5 }}
    >
      {name.trim()[0]?.toUpperCase()}
    </span>
  );
}
