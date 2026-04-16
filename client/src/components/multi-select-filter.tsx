import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Check, ChevronDown, X, Search } from "lucide-react";

interface MultiSelectFilterProps {
  label: string;
  options: { value: string; label: string }[];
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
  "data-testid"?: string;
  className?: string;
  align?: "left" | "right";
}

export function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  "data-testid": testId,
  className = "",
  align = "left",
}: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 0);
    } else {
      setSearch("");
    }
  }, [open]);

  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    onChange(next);
  };

  const filtered = search.trim()
    ? options.filter((o) =>
        o.label.toLowerCase().includes(search.toLowerCase())
      )
    : options;

  const displayText =
    selected.size === 0
      ? label
      : selected.size === 1
      ? options.find((o) => o.value === [...selected][0])?.label || [...selected][0]
      : `${selected.size} selected`;

  return (
    <div ref={ref} className={`relative ${className}`}>
      <Button
        data-testid={testId}
        variant="outline"
        role="combobox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="h-9 text-sm bg-muted/50 border-input justify-between gap-1 font-normal min-w-[150px]"
      >
        <span className="truncate">{displayText}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
      </Button>

      {selected.size > 0 && (
        <button
          data-testid={testId ? `${testId}-clear` : undefined}
          onClick={(e) => {
            e.stopPropagation();
            onChange(new Set());
          }}
          className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-muted-foreground/80 text-background flex items-center justify-center hover:bg-muted-foreground z-10"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}

      {open && (
        <div className={`absolute top-full mt-1 z-50 w-[260px] max-h-[320px] flex flex-col rounded-md border bg-popover shadow-md ${align === "right" ? "right-0" : "left-0"}`}>
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border/50">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              data-testid={testId ? `${testId}-search` : undefined}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground/60 min-w-0"
            />
            {search && (
              <button onClick={() => setSearch("")} className="text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="overflow-auto p-1">
            {filtered.length === 0 ? (
              <p className="py-2 px-2 text-sm text-muted-foreground">No results</p>
            ) : (
              filtered.map((option) => (
                <button
                  key={option.value}
                  data-testid={testId ? `${testId}-option-${option.value}` : undefined}
                  onClick={() => toggle(option.value)}
                  className="relative flex w-full items-center rounded-sm py-1.5 px-2 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer gap-2"
                >
                  <div
                    className={`h-4 w-4 shrink-0 rounded border flex items-center justify-center ${
                      selected.has(option.value)
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-input"
                    }`}
                  >
                    {selected.has(option.value) && <Check className="h-3 w-3" />}
                  </div>
                  <span className="truncate">{option.label}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
