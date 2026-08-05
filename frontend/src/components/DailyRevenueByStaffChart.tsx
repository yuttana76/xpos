"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";

interface StaffDay {
  date: string;
  total_revenue: string;
  order_count: number;
}

interface StaffSeries {
  staff_id: string | null;
  staff_name: string;
  days: StaffDay[];
}

interface DailySalesByStaffReport {
  from: string;
  to: string;
  staff: StaffSeries[];
}

// categorical palette (dark-mode steps), ลำดับคงที่ตาม dataviz skill — ห้ามสลับ/สุ่ม เพราะลำดับคือ
// กลไกกัน CVD confusion ระหว่างเส้นที่อยู่ติดกัน (validate_palette.js ผ่านแล้วสำหรับชุดนี้ทั้ง 8 สี)
const SERIES_COLORS = [
  "#3987e5", // blue
  "#d95926", // orange
  "#199e70", // aqua
  "#c98500", // yellow
  "#d55181", // magenta
  "#008300", // green
  "#9085e9", // violet
  "#e66767", // red
];

const SURFACE_COLOR = "#0f172a"; // slate-900
const GRID_COLOR = "#1e293b"; // slate-800

const CHART_W = 640;
const CHART_H = 220;
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

function niceCeiling(value: number): number {
  if (value <= 0) return 100;
  const exp = Math.floor(Math.log10(value));
  const base = Math.pow(10, exp);
  const fraction = value / base;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * base;
}

export function DailyRevenueByStaffChart({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<DailySalesByStaffReport | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    api
      .get<DailySalesByStaffReport>(`/api/orders/reports/daily-sales-by-staff/?from=${from}&to=${to}`)
      .then(setData)
      .catch(() => setData(null));
  }, [from, to]);

  const seriesList = data?.staff ?? [];
  const dates = seriesList[0]?.days.map((d) => d.date) ?? [];
  const allRevenues = seriesList.flatMap((s) => s.days.map((d) => parseFloat(d.total_revenue)));
  const maxRevenue = niceCeiling(Math.max(...allRevenues, 0));
  const hasAnyData = allRevenues.some((r) => r > 0);

  const seriesPoints = useMemo(() => {
    if (dates.length === 0) return [];
    const innerW = CHART_W - PAD_L - PAD_R;
    const innerH = CHART_H - PAD_T - PAD_B;
    return seriesList.map((s, sIdx) => ({
      staffName: s.staff_name,
      color: SERIES_COLORS[sIdx % SERIES_COLORS.length],
      points: s.days.map((d, i) => {
        const x = dates.length === 1 ? PAD_L + innerW / 2 : PAD_L + (i / (dates.length - 1)) * innerW;
        const revenue = parseFloat(d.total_revenue);
        const y = PAD_T + innerH - (maxRevenue > 0 ? (revenue / maxRevenue) * innerH : 0);
        return { x, y, revenue, date: d.date, orderCount: d.order_count };
      }),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesList, dates.length, maxRevenue]);

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => maxRevenue * f);
  const maxLabels = 7;
  const labelStep = Math.max(1, Math.ceil(dates.length / maxLabels));

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current || dates.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * CHART_W;
    const innerW = CHART_W - PAD_L - PAD_R;
    const rawIndex = ((svgX - PAD_L) / innerW) * (dates.length - 1);
    const nearest = Math.min(dates.length - 1, Math.max(0, Math.round(rawIndex)));
    setHoverIndex(nearest);
  };

  if (!data) return null;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium text-slate-300">ยอดขายรายวันแยกตามพนักงาน</p>
        <button
          onClick={() => setShowTable((v) => !v)}
          className="text-xs text-slate-400 hover:text-slate-200"
        >
          {showTable ? "ซ่อนตาราง" : "แสดงตาราง"}
        </button>
      </div>

      {seriesList.length === 0 || !hasAnyData ? (
        <p className="text-sm text-slate-500">ไม่มีข้อมูลในช่วงนี้</p>
      ) : (
        <>
          {/* legend — บังคับมีเสมอเพราะ >=2 series (identity channel ที่พึ่งพาได้ ไม่ใช่ให้เดาสีเอา) */}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-2">
            {seriesPoints.map((s) => (
              <span key={s.staffName} className="flex items-center gap-1.5 text-xs text-slate-300">
                <span className="inline-block h-0.5 w-4 rounded-full" style={{ backgroundColor: s.color }} />
                {s.staffName}
              </span>
            ))}
          </div>

          <svg
            ref={svgRef}
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            preserveAspectRatio="none"
            className="w-full h-[220px] touch-none"
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setHoverIndex(null)}
          >
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

            {dates.map((date, i) =>
              i % labelStep === 0 || i === dates.length - 1 ? (
                <text
                  key={i}
                  x={seriesPoints[0]?.points[i]?.x ?? 0}
                  y={CHART_H - 8}
                  textAnchor="middle"
                  fontSize="10"
                  fill="#64748b"
                >
                  {formatShortDate(date)}
                </text>
              ) : null
            )}

            {seriesPoints.map((s) => {
              const path = s.points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
              return (
                <path key={s.staffName} d={path} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              );
            })}

            {/* crosshair — จุดเดียวกันทุก series ที่ x เดียวกัน (one tooltip, every series) */}
            {hoverIndex !== null && seriesPoints[0]?.points[hoverIndex] && (
              <>
                <line
                  x1={seriesPoints[0].points[hoverIndex].x}
                  y1={PAD_T}
                  x2={seriesPoints[0].points[hoverIndex].x}
                  y2={CHART_H - PAD_B}
                  stroke="#475569"
                  strokeWidth={1}
                />
                {seriesPoints.map((s) => {
                  const p = s.points[hoverIndex];
                  return (
                    <circle key={s.staffName} cx={p.x} cy={p.y} r={5} fill={s.color} stroke={SURFACE_COLOR} strokeWidth={2} />
                  );
                })}
              </>
            )}
          </svg>

          {/* tooltip: ทุก series ที่ x เดียวกัน ไม่ใช่แค่เส้นที่ hover โดน */}
          {hoverIndex !== null && (
            <div className="pointer-events-none -mt-2 flex justify-center">
              <div className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 shadow-lg min-w-[180px]">
                <p className="text-[11px] text-slate-400 mb-1">{formatFullDate(dates[hoverIndex])}</p>
                <div className="space-y-0.5">
                  {seriesPoints.map((s) => {
                    const p = s.points[hoverIndex];
                    return (
                      <div key={s.staffName} className="flex items-center justify-between gap-3 text-xs">
                        <span className="flex items-center gap-1.5 text-slate-300">
                          <span className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: s.color }} />
                          {s.staffName}
                        </span>
                        <span className="font-semibold text-slate-100">฿{formatCurrency(p.revenue)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {showTable && (
            <div className="mt-3 max-h-56 overflow-auto border-t border-slate-800 pt-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-slate-500">
                    <th className="font-normal pb-1 sticky left-0 bg-slate-900/60">วันที่</th>
                    {seriesPoints.map((s) => (
                      <th key={s.staffName} className="font-normal pb-1 text-right pl-3 whitespace-nowrap">
                        {s.staffName}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {dates.map((date, i) => (
                    <tr key={date}>
                      <td className="py-1 sticky left-0 bg-slate-900/60 whitespace-nowrap">{formatFullDate(date)}</td>
                      {seriesPoints.map((s) => (
                        <td key={s.staffName} className="py-1 text-right pl-3 text-slate-300 whitespace-nowrap">
                          ฿{s.points[i].revenue.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                        </td>
                      ))}
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
