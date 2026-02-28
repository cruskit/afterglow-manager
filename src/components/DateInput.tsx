import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { CalendarDays } from "lucide-react";
import { cn } from "../lib/utils";

interface DateInputProps {
  value: string;
  onChange: (val: string) => void;
  onBlur: () => void;
}

function parseDDMMYYYY(str: string): Date | null {
  const match = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const year = parseInt(match[3], 10);
  const d = new Date(year, month, day);
  // Validate round-trip
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null;
  return d;
}

function formatDDMMYYYY(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function DateInput({ value, onChange, onBlur }: DateInputProps) {
  const [inputText, setInputText] = useState(value);
  const [isValid, setIsValid] = useState(true);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarDate, setCalendarDate] = useState<Date>(() => parseDDMMYYYY(value) ?? new Date());
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync inputText when parent value changes (e.g. selecting different gallery)
  useEffect(() => {
    setInputText(value);
    setIsValid(true);
    const parsed = parseDDMMYYYY(value);
    if (parsed) setCalendarDate(parsed);
  }, [value]);

  const calendarPos = (() => {
    if (!calendarOpen || !containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    return { top: rect.bottom + 4, left: rect.left };
  })();

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setInputText(val);
      onChange(val);
      if (val === "" || parseDDMMYYYY(val)) setIsValid(true);
    },
    [onChange]
  );

  const handleBlur = useCallback(() => {
    if (inputText !== "" && !parseDDMMYYYY(inputText)) {
      setIsValid(false);
    } else {
      setIsValid(true);
    }
    // Delay onBlur to allow calendar click to fire first
    setTimeout(() => {
      if (!calendarOpen) onBlur();
    }, 150);
  }, [inputText, calendarOpen, onBlur]);

  const handleDayClick = useCallback(
    (day: number) => {
      const date = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), day);
      const formatted = formatDDMMYYYY(date);
      setInputText(formatted);
      setIsValid(true);
      onChange(formatted);
      setCalendarOpen(false);
      setTimeout(() => onBlur(), 0);
    },
    [calendarDate, onChange, onBlur]
  );

  // Close calendar on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        // Check if click is inside the portal calendar
        const calendar = document.getElementById("date-input-calendar");
        if (calendar && calendar.contains(e.target as Node)) return;
        setCalendarOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const firstDayOfWeek = (new Date(year, month, 1).getDay() + 6) % 7; // 0=Mon
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const selectedDate = parseDDMMYYYY(inputText);

  const prevMonth = useCallback(() => {
    setCalendarDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }, []);

  const nextMonth = useCallback(() => {
    setCalendarDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }, []);

  return (
    <>
      <div ref={containerRef} className="relative">
        <div className="relative">
          <input
            type="text"
            value={inputText}
            placeholder="dd/MM/yyyy"
            onChange={handleInputChange}
            onBlur={handleBlur}
            className={cn(
              "w-full px-3 py-1.5 pr-9 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring",
              isValid ? "border-input" : "border-destructive"
            )}
          />
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => {
              e.preventDefault();
              setCalendarOpen((open) => !open);
              if (!calendarOpen) {
                const parsed = parseDDMMYYYY(inputText);
                if (parsed) setCalendarDate(parsed);
              }
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Open calendar"
          >
            <CalendarDays size={16} />
          </button>
        </div>
        {!isValid && (
          <p className="text-xs text-destructive mt-1">Use dd/MM/yyyy format</p>
        )}
      </div>

      {calendarOpen && calendarPos &&
        createPortal(
          <div
            id="date-input-calendar"
            style={{ position: "fixed", top: calendarPos.top, left: calendarPos.left }}
            className="z-[9999] w-64 rounded-md border border-[#333] bg-[#1a1a1a] text-[#e0e0e0] shadow-lg p-3"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); prevMonth(); }}
                className="px-2 py-1 text-sm hover:bg-[#242424] rounded"
                aria-label="Previous month"
              >
                ‹
              </button>
              <span className="text-sm font-medium">{MONTH_NAMES[month]} {year}</span>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); nextMonth(); }}
                className="px-2 py-1 text-sm hover:bg-[#242424] rounded"
                aria-label="Next month"
              >
                ›
              </button>
            </div>

            {/* Day of week labels */}
            <div className="grid grid-cols-7 mb-1">
              {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
                <div key={d} className="text-center text-xs text-muted-foreground py-1">
                  {d}
                </div>
              ))}
            </div>

            {/* Day grid */}
            <div className="grid grid-cols-7">
              {/* Leading nulls */}
              {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                <div key={`pre-${i}`} />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const isSelected =
                  selectedDate &&
                  selectedDate.getFullYear() === year &&
                  selectedDate.getMonth() === month &&
                  selectedDate.getDate() === day;
                const isToday =
                  !isSelected &&
                  today.getFullYear() === year &&
                  today.getMonth() === month &&
                  today.getDate() === day;
                return (
                  <button
                    key={day}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleDayClick(day);
                    }}
                    className={cn(
                      "text-center text-sm rounded py-1",
                      isSelected
                        ? "bg-[#c9a84c] text-[#0e0e0e] font-medium"
                        : isToday
                        ? "border border-[#c9a84c]/50 text-[#c9a84c]"
                        : "hover:bg-[#242424]"
                    )}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body
        )
      }
    </>
  );
}
