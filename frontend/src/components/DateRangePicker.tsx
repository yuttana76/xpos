"use client";

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // จันทร์เป็นวันแรกของสัปดาห์
  const result = new Date(d);
  result.setDate(d.getDate() + diff);
  return result;
}

export interface DateRange {
  from: string;
  to: string;
}

export function todayRange(): DateRange {
  const today = toDateStr(new Date());
  return { from: today, to: today };
}

export function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
}) {
  const presets: Array<{ label: string; range: () => DateRange }> = [
    { label: "วันนี้", range: () => todayRange() },
    {
      label: "สัปดาห์นี้",
      range: () => {
        const now = new Date();
        return { from: toDateStr(startOfWeek(now)), to: toDateStr(now) };
      },
    },
    {
      label: "เดือนนี้",
      range: () => {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        return { from: toDateStr(start), to: toDateStr(now) };
      },
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1">
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => onChange(p.range())}
            className="rounded-md bg-slate-800 px-3 py-1.5 text-xs hover:bg-slate-700"
          >
            {p.label}
          </button>
        ))}
      </div>
      <input
        type="date"
        value={value.from}
        onChange={(e) => onChange({ ...value, from: e.target.value })}
        className="rounded bg-slate-800 px-2 py-1.5 text-sm"
      />
      <span className="text-slate-500 text-sm">ถึง</span>
      <input
        type="date"
        value={value.to}
        onChange={(e) => onChange({ ...value, to: e.target.value })}
        className="rounded bg-slate-800 px-2 py-1.5 text-sm"
      />
    </div>
  );
}
