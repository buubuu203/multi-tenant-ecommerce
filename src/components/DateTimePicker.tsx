"use client";

import { useState, useRef, useEffect } from "react";
import { DayPicker } from "react-day-picker";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toLocalDatetimeString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDisplay(date: Date | null, includeTime: boolean): string {
  if (!date) return "";
  const d = date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
  if (!includeTime) return d;
  return `${d} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function DateTimePicker({
  name,
  defaultValue,
  placeholder = "Select date…",
  includeTime = true,
  className = "",
}: {
  name: string;
  defaultValue?: Date | string | null;
  placeholder?: string;
  includeTime?: boolean;
  className?: string;
}) {
  const parsed = defaultValue
    ? typeof defaultValue === "string"
      ? defaultValue.trim() ? new Date(defaultValue) : null
      : defaultValue
    : null;
  const [selected, setSelected] = useState<Date | null>(
    parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
  );
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState(selected ? pad(selected.getHours()) : "00");
  const [minutes, setMinutes] = useState(selected ? pad(selected.getMinutes()) : "00");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  function handleDaySelect(day: Date | undefined) {
    if (!day) { setSelected(null); return; }
    const h = parseInt(hours, 10) || 0;
    const m = parseInt(minutes, 10) || 0;
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
    setSelected(d);
    if (!includeTime) setOpen(false);
  }

  function handleTimeChange(newH: string, newM: string) {
    setHours(newH);
    setMinutes(newM);
    if (selected) {
      const h = parseInt(newH, 10) || 0;
      const m = parseInt(newM, 10) || 0;
      setSelected(new Date(selected.getFullYear(), selected.getMonth(), selected.getDate(), h, m));
    }
  }

  function handleClear() {
    setSelected(null);
    setHours("00");
    setMinutes("00");
    setOpen(false);
  }

  const hiddenValue = selected ? toLocalDatetimeString(selected) : "";

  return (
    <div ref={ref} className={`relative ${className}`}>
      <input type="hidden" name={name} value={hiddenValue} />
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
      >
        {selected ? (
          <span>{formatDisplay(selected, includeTime)}</span>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
      </button>

      {open && (
        <div className="absolute z-50 mt-1 rounded-lg border border-border bg-surface p-3 shadow-lg">
          <DayPicker
            mode="single"
            selected={selected ?? undefined}
            onSelect={handleDaySelect}
            classNames={{
              root: "text-sm",
              months: "flex flex-col",
              month: "space-y-2",
              month_caption: "flex justify-center items-center py-1",
              caption_label: "text-sm font-medium",
              nav: "flex items-center gap-1",
              button_previous: "size-7 flex items-center justify-center rounded-md hover:bg-surface-muted text-muted-foreground",
              button_next: "size-7 flex items-center justify-center rounded-md hover:bg-surface-muted text-muted-foreground",
              month_grid: "w-full border-collapse",
              weekdays: "flex",
              weekday: "w-8 text-center text-[11px] font-medium text-muted-foreground",
              weeks: "flex flex-col",
              week: "flex",
              day: "size-8 flex items-center justify-center rounded-md text-sm",
              day_button: "size-8 flex items-center justify-center rounded-md hover:bg-surface-muted transition-colors cursor-pointer",
              selected: "!bg-foreground !text-background rounded-md font-medium",
              today: "font-bold text-foreground",
              outside: "text-muted-foreground/40",
              disabled: "text-muted-foreground/30",
              chevron: "size-4",
            }}
          />
          {includeTime && (
            <div className="mt-2 flex items-center gap-1 border-t border-border pt-2">
              <span className="text-xs text-muted-foreground">Time:</span>
              <input
                type="number"
                min={0}
                max={23}
                value={hours}
                onChange={(e) => handleTimeChange(e.target.value, minutes)}
                className="w-12 rounded-md border border-border bg-background px-1.5 py-1 text-center text-xs"
              />
              <span className="text-xs text-muted-foreground">:</span>
              <input
                type="number"
                min={0}
                max={59}
                value={minutes}
                onChange={(e) => handleTimeChange(hours, e.target.value)}
                className="w-12 rounded-md border border-border bg-background px-1.5 py-1 text-center text-xs"
              />
            </div>
          )}
          <div className="mt-2 flex justify-between border-t border-border pt-2">
            <button
              type="button"
              onClick={handleClear}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md bg-foreground px-3 py-1 text-xs font-medium text-background"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
