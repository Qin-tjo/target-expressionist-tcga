const NUM_ROW = "1234567890";
const ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];

/**
 * Decorative + interactive pixel keyboard.
 * - the key matching `active` depresses (mirrors physical typing)
 * - clicking a key calls `onKey` with the character, or a token for ENTER/SPACE/BACKSPACE
 */
export function PixelKeyboard({
  active,
  scale = 1,
  onKey,
}: {
  active?: string | null;
  scale?: number;
  onKey?: (key: string) => void;
}) {
  const hot = (active ?? "").toUpperCase();
  const gap = Math.round(4 * scale);
  return (
    <div aria-label="on-screen keyboard" className="select-none flex flex-col items-center" style={{ gap }}>
      <div className="flex" style={{ gap }}>
        {NUM_ROW.split("").map((k) => (
          <Key key={k} label={k} pressed={hot === k} scale={scale} onKey={onKey} />
        ))}
      </div>
      {ROWS.map((row, r) => (
        <div key={r} className="flex" style={{ gap, paddingLeft: r * 12 * scale }}>
          {row.split("").map((k) => (
            <Key key={k} label={k} pressed={hot === k} scale={scale} onKey={onKey} />
          ))}
        </div>
      ))}
      <div className="flex" style={{ gap }}>
        <Key label="⏎" token="ENTER" pressed={hot === "ENTER"} wide scale={scale} onKey={onKey} />
        <Key label="SPACE" token=" " pressed={hot === " "} extraWide scale={scale} onKey={onKey} />
        <Key label="⌫" token="BACKSPACE" pressed={hot === "BACKSPACE"} wide scale={scale} onKey={onKey} />
      </div>
    </div>
  );
}

function Key({
  label,
  token,
  pressed,
  wide,
  extraWide,
  scale,
  onKey,
}: {
  label: string;
  token?: string;
  pressed?: boolean;
  wide?: boolean;
  extraWide?: boolean;
  scale: number;
  onKey?: (key: string) => void;
}) {
  const base = 30 * scale;
  const off = Math.round(3 * scale);
  const clickable = !!onKey;
  return (
    <button
      type="button"
      tabIndex={-1}
      disabled={!clickable}
      onMouseDown={(e) => {
        e.preventDefault(); // keep input focus
        onKey?.(token ?? label);
      }}
      className="grid place-items-center border-2 border-ink bg-paper font-pixel text-ink"
      style={{
        width: extraWide ? base * 4.6 : wide ? base * 1.3 : base,
        height: base,
        fontSize: Math.round(9 * scale),
        borderRadius: 5 * scale,
        cursor: clickable ? "pointer" : "default",
        transform: pressed ? `translate(${off}px,${off}px)` : "none",
        boxShadow: pressed ? "0 0 0 0 #111" : `${off}px ${off}px 0 0 #111`,
        transition: "transform 60ms, box-shadow 60ms, background 100ms",
        background: pressed ? "#FFC7DE" : undefined,
      }}
    >
      {label}
    </button>
  );
}
