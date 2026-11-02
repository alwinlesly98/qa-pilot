import { useEffect, useRef, useState, type ReactElement } from "react";
import { ArrowUpRight, Pencil, RotateCcw, Save, Square, Type, Undo2 } from "lucide-react";
import { Spinner } from "./ui";

type Tool = "rect" | "arrow" | "pen" | "text";
type Shape =
  | { tool: "rect" | "arrow"; color: string; x1: number; y1: number; x2: number; y2: number }
  | { tool: "pen"; color: string; points: [number, number][] }
  | { tool: "text"; color: string; x: number; y: number; text: string };

const COLORS = ["#ef4444", "#f59e0b", "#2563eb", "#16a34a", "#111827"];

function draw(ctx: CanvasRenderingContext2D, s: Shape, scale: number) {
  ctx.strokeStyle = ctx.fillStyle = s.color;
  ctx.lineWidth = 4 * scale;
  ctx.lineCap = ctx.lineJoin = "round";
  if (s.tool === "rect") {
    ctx.strokeRect(s.x1, s.y1, s.x2 - s.x1, s.y2 - s.y1);
  } else if (s.tool === "arrow") {
    const angle = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
    const head = 18 * scale;
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s.x2, s.y2);
    ctx.lineTo(s.x2 - head * Math.cos(angle - 0.45), s.y2 - head * Math.sin(angle - 0.45));
    ctx.lineTo(s.x2 - head * Math.cos(angle + 0.45), s.y2 - head * Math.sin(angle + 0.45));
    ctx.closePath();
    ctx.fill();
  } else if (s.tool === "pen") {
    ctx.beginPath();
    s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  } else if (s.tool === "text") {
    const size = 22 * scale;
    ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
    const w = ctx.measureText(s.text).width;
    ctx.fillStyle = "rgba(255,255,255,.9)";
    ctx.fillRect(s.x - 6 * scale, s.y - size, w + 12 * scale, size * 1.35);
    ctx.fillStyle = s.color;
    ctx.fillText(s.text, s.x, s.y);
  }
}

/** Draw boxes, arrows, freehand marks and notes on a screenshot; saves a flattened PNG. */
export default function Annotator({ src, original, onSave }: { src: string; original: string; onSave: (dataUrl: string) => Promise<void> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [base, setBase] = useState(src);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [tool, setTool] = useState<Tool>("rect");
  const [color, setColor] = useState(COLORS[0]);
  const [saving, setSaving] = useState(false);

  useEffect(() => setBase(src), [src]);
  useEffect(() => {
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = base;
    setShapes([]);
  }, [base]);

  const scale = img ? Math.max(1, img.naturalWidth / 1000) : 1;

  useEffect(() => {
    const c = canvas.current;
    if (!c || !img) return;
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    [...shapes, ...(draft ? [draft] : [])].forEach((s) => draw(ctx, s, scale));
  }, [img, shapes, draft, scale]);

  const pos = (e: React.PointerEvent) => {
    const rect = canvas.current!.getBoundingClientRect();
    return [((e.clientX - rect.left) / rect.width) * canvas.current!.width, ((e.clientY - rect.top) / rect.height) * canvas.current!.height] as [number, number];
  };

  const down = (e: React.PointerEvent) => {
    const [x, y] = pos(e);
    if (tool === "text") {
      const text = prompt("Note text");
      if (text) setShapes((s) => [...s, { tool: "text", color, x, y, text }]);
      return;
    }
    (e.target as Element).setPointerCapture(e.pointerId);
    setDraft(tool === "pen" ? { tool, color, points: [[x, y]] } : { tool, color, x1: x, y1: y, x2: x, y2: y });
  };
  const move = (e: React.PointerEvent) => {
    if (!draft) return;
    const [x, y] = pos(e);
    setDraft(draft.tool === "pen" ? { ...draft, points: [...draft.points, [x, y]] } : { ...(draft as Extract<Shape, { x1: number }>), x2: x, y2: y });
  };
  const up = () => {
    if (draft) setShapes((s) => [...s, draft]);
    setDraft(null);
  };

  const tools: [Tool, ReactElement, string][] = [
    ["rect", <Square className="h-4 w-4" />, "Box"],
    ["arrow", <ArrowUpRight className="h-4 w-4" />, "Arrow"],
    ["pen", <Pencil className="h-4 w-4" />, "Pen"],
    ["text", <Type className="h-4 w-4" />, "Note"],
  ];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
          {tools.map(([t, icon, label]) => (
            <button key={t} title={label} onClick={() => setTool(t)} className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs ${tool === t ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
              {icon}<span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {COLORS.map((c) => (
            <button key={c} onClick={() => setColor(c)} className={`h-6 w-6 rounded-full border-2 ${color === c ? "border-slate-900" : "border-white"} shadow-sm`} style={{ background: c }} aria-label={`Color ${c}`} />
          ))}
        </div>
        <button className="btn-ghost px-2 py-1 text-xs" disabled={!shapes.length} onClick={() => setShapes((s) => s.slice(0, -1))}><Undo2 className="h-4 w-4" /> Undo</button>
        {base !== original && <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setBase(original)}><RotateCcw className="h-4 w-4" /> Original</button>}
        <button
          className="btn-primary ml-auto px-3 py-1.5 text-xs"
          disabled={!shapes.length || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave(canvas.current!.toDataURL("image/png"));
              setShapes([]);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? <Spinner /> : <Save className="h-4 w-4" />} Save annotation
        </button>
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
        {!img && <div className="grid h-60 place-items-center"><Spinner /></div>}
        <canvas ref={canvas} className={`mx-auto block max-h-[75vh] max-w-full touch-none ${tool === "text" ? "cursor-text" : "cursor-crosshair"}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} />
      </div>
    </div>
  );
}
