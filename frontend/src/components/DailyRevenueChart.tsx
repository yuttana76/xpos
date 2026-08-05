"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";

interface DailySalesDay {
  date: string;
  total_revenue: string;
  order_count: number;
}

interface DailySalesReport {
  from: string;
  to: string;
  days: DailySalesDay[];
}

// สีเดียวกับ accent หลักของแอป (bg-sky-600 ที่ใช้ทั่วทั้งระบบ) — series เดียวไม่ต้องมี legend
// เพราะหัวข้อการ์ดบอกอยู่แล้วว่ากราฟนี้คือยอดขายรายวัน
const LINE_COLOR = "#38bdf8"; // sky-400
const AREA_COLOR = "#38bdf8";
const SURFACE_COLOR = "#0f172a"; // slate-900 (พื้นการ์ด — ใช้เป็นสี ring รอบจุด/แกน)
const GRID_COLOR = "#1e293b"; // slate-800

const CHART_W = 640;
const CHART_H = 200;
const PAD_L = 56;
const PAD_R = 16;
const PAD_T = 16;
const PAD_B = 28;

function formatCurrency(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatShortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("th-TH", { day: "2-digit", month: "short" });
}

function formatFullDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ปัดเพดานเป็นเลขกลมๆ (1/2/5 × 10^n) สำหรับ y-axis ticks ให้อ่านง่าย แทนที่จะโชว์ค่า max ดิบๆ
function niceCeiling(value: number): number {
  if (value <= 0) return 100;
  const exp = Math.floor(Math.log10(value));
  const base = Math.pow(10, exp);
  const fraction = value / base;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * base;
}

export function DailyRevenueChart({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<DailySalesReport | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    api
      .get<DailySalesReport>(`/api/orders/reports/daily-sales/?from=${from}&to=${to}`)
      .then(setData)
      .catch(() => setData(null));
  }, [from, to]);

  const days = data?.days ?? [];
  const revenues = days.map((d) => parseFloat(d.total_revenue));
  const maxRevenue = niceCeiling(Math.max(...revenues, 0));

  const points = useMemo(() => {
    if (days.length === 0) return [];
    const innerW = CHART_W - PAD_L - PAD_R;
    const innerH = CHART_H - PAD_T - PAD_B;
    return days.map((d, i) => {
      const x = days.length === 1 ? PAD_L + innerW / 2 : PAD_L + (i / (days.length - 1)) * innerW;
      const revenue = parseFloat(d.total_revenue);
      const y = PAD_T + innerH - (maxRevenue > 0 ? (revenue / maxRevenue) * innerH : 0);
      return { x, y, revenue, date: d.date, orderCount: d.order_count };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, maxRevenue]);

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath =
    points.length > 0
      ? `${linePath} L${points[points.length - 1].x.toFixed(1)},${(CHART_H - PAD_B).toFixed(1)} L${points[0].x.toFixed(1)},${(CHART_H - PAD_B).toFixed(1)} Z`
      : "";

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => maxRevenue * f);

  // แสดง label แกน x แบบเว้นระยะ กันตัวหนังสือทับกันเวลาช่วงวันที่ยาว
  const maxLabels = 7;
  const labelStep = Math.max(1, Math.ceil(days.length / maxLabels));

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current || points.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * CHART_W;
    let nearest = 0;
    let nearestDist = Infinity;
    points.forEach((p, i) => {
      const dist = Math.abs(p.x - svgX);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = i;
      }
    });
    setHoverIndex(nearest);
  };

  const hovered = hoverIndex !== null ? points[hoverIndex] : null;
  const lastPoint = points[points.length - 1];

  if (!data) return null;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium text-slate-300">ยอดขายรายวัน</p>
        <button
          onClick={() => setShowTable((v) => !v)}
          className="text-xs text-slate-400 hover:text-slate-200"
        >
          {showTable ? "ซ่อนตาราง" : "แสดงตาราง"}
        </button>
      </div>

      {days.length === 0 || revenues.every((r) => r === 0) ? (
        <p className="text-sm text-slate-500">ไม่มีข้อมูลในช่วงนี้</p>
      ) : (
        <>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            preserveAspectRatio="none"
            className="w-full h-[200px] touch-none"
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setHoverIndex(null)}
          >
            {/* gridlines + y-axis labels */}
            {yTicks.map((tick, i) => {
              const innerH = CHART_H - PAD_T - PAD_B;
              const y = PAD_T + innerH - (maxRevenue > 0 ? (tick / maxRevenue) * innerH : 0);
              return (
                <g key={i}>
                  <line x1={PAD_L} y1={y} x2={CHART_W - PAD_R} y2={y} stroke={GRID_COLOR} strokeWidth={1} />
                  <text x={PAD_L - 8} y={y + 3} textAnchor="end" fontSize="10" fill="#64748b">
                    {formatCurrency(tick)}
                  </text>
                </g>
              );
            })}

            {/* x-axis labels */}
            {points.map((p, i) =>
              i % labelStep === 0 || i === points.length - 1 ? (
                <text key={i} x={p.x} y={CHART_H - 8} textAnchor="middle" fontSize="10" fill="#64748b">
                  {formatShortDate(p.date)}
                </text>
              ) : null
            )}

            {/* area wash */}
            <path d={areaPath} fill={AREA_COLOR} opacity={0.1} stroke="none" />

            {/* line */}
            <path d={linePath} fill="none" stroke={LINE_COLOR} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

            {/* end marker + direct label (ตาม mark spec: เส้น -> ค่าที่ปลายเส้น) */}
            {lastPoint && (
              <>
                <circle cx={lastPoint.x} cy={lastPoint.y} r={5} fill={LINE_COLOR} stroke={SURFACE_COLOR} strokeWidth={2} />
                <text
                  x={Math.min(lastPoint.x + 8, CHART_W - PAD_R - 2)}
                  y={Math.max(lastPoint.y - 8, PAD_T + 8)}
                  textAnchor={lastPoint.x + 60 > CHART_W - PAD_R ? "end" : "start"}
                  fontSize="11"
                  fontWeight={600}
                  fill="#e2e8f0"
                >
                  ฿{formatCurrency(lastPoint.revenue)}
                </text>
              </>
            )}

            {/* crosshair + hover point */}
            {hovered && (
              <>
                <line
                  x1={hovered.x}
                  y1={PAD_T}
                  x2={hovered.x}
                  y2={CHART_H - PAD_B}
                  stroke="#475569"
                  strokeWidth={1}
                />
                <circle cx={hovered.x} cy={hovered.y} r={5} fill={LINE_COLOR} stroke={SURFACE_COLOR} strokeWidth={2} />
              </>
            )}
          </svg>

          {/* tooltip (แยกจาก SVG เพื่อให้ข้อความคมชัด ไม่ scale ตาม viewBox) */}
          {hovered && (
            <div className="pointer-events-none -mt-2 flex justify-center">
              <div className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-center shadow-lg">
                <p className="text-sm font-semibold text-slate-100">฿{formatCurrency(hovered.revenue)}</p>
                <p className="text-[11px] text-slate-400">
                  {formatFullDate(hovered.date)} · {hovered.orderCount} บิล
                </p>
              </div>
            </div>
          )}

          {showTable && (
            <div className="mt-3 max-h-48 overflow-y-auto border-t border-slate-800 pt-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-slate-500">
                    <th className="font-normal pb-1">วันที่</th>
                    <th className="font-normal pb-1 text-right">ยอดขาย</th>
                    <th className="font-normal pb-1 text-right">บิล</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {days.map((d) => (
                    <tr key={d.date}>
                      <td className="py-1">{formatFullDate(d.date)}</td>
                      <td className="py-1 text-right text-slate-300">฿{d.total_revenue}</td>
                      <td className="py-1 text-right text-slate-500">{d.order_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
