import { useState, useRef, useEffect, useCallback } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

// Module-level focus guards registered ONCE at import time — before any Dialog opens.
// The Dialog's FocusScope registers its own document-level focusin/focusout listeners
// only when the dialog opens (inside a useEffect). Since JS event listeners on the same
// target+phase fire in registration order, our listeners (registered at import time) run
// FIRST, so we can call stopImmediatePropagation() to prevent the Dialog's FocusScope
// from stealing focus away from our search inputs.
//
// The window flag prevents duplicate registration during HMR dev reloads.
if (typeof window !== "undefined" && !(window as any).__ssGuardActive) {
  (window as any).__ssGuardActive = true;

  // When focus moves INTO a search input — prevent FocusScope from taking it back
  document.addEventListener("focusin", (e) => {
    if ((e.target as Element | null)?.closest("[data-ss-input]")) {
      e.stopImmediatePropagation();
    }
  });

  // When focus moves FROM inside the dialog TO a search input — prevent FocusScope
  // from restoring focus to the last dialog element
  document.addEventListener("focusout", (e) => {
    if ((e.relatedTarget as Element | null)?.closest("[data-ss-input]")) {
      e.stopImmediatePropagation();
    }
  });
}

interface SearchableSelectProps {
  value?: string;
  onValueChange: (value: string) => void;
  options: string[] | { value: string; label: string }[];
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  triggerClassName?: string;
  disabled?: boolean;
  "data-testid"?: string;
}

function toEntries(options: SearchableSelectProps["options"]): { value: string; label: string }[] {
  if (!options.length) return [];
  if (typeof options[0] === "string") {
    return (options as string[]).map(o => ({ value: o, label: o }));
  }
  return options as { value: string; label: string }[];
}

export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder = "Select option",
  searchPlaceholder = "Search...",
  className,
  triggerClassName,
  disabled,
  "data-testid": testId,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [triggerWidth, setTriggerWidth] = useState<number>(200);

  const entries = toEntries(options);
  const selected = entries.find(e => e.value === value);
  const filtered = search
    ? entries.filter(e => e.label.toLowerCase().includes(search.toLowerCase()))
    : entries;

  const handleOpenChange = useCallback((next: boolean) => {
    if (!next) setSearch("");
    if (next && triggerRef.current) {
      setTriggerWidth(Math.max(triggerRef.current.getBoundingClientRect().width, 200));
    }
    setOpen(next);
  }, []);

  useEffect(() => {
    if (open) {
      // Delay slightly so the popover is fully mounted before we focus the input.
      // This also runs AFTER the dialog's FocusScope auto-focus has fired, ensuring
      // our module-level guards are in effect when this focus() call triggers focusin.
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <PopoverPrimitive.Trigger asChild>
        <button
          ref={triggerRef}
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          data-testid={testId}
          className={cn(
            "flex items-center justify-between gap-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background w-full",
            "hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
            triggerClassName,
            className,
          )}
        >
          <span className={cn("truncate text-left flex-1 min-w-0", !selected && "text-muted-foreground")}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50 ml-1" />
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          sideOffset={4}
          align="start"
          style={{ width: triggerWidth, zIndex: 9999, pointerEvents: "auto" }}
          className="rounded-md border border-border bg-popover shadow-md outline-none"
          onOpenAutoFocus={e => e.preventDefault()}
          onCloseAutoFocus={e => e.preventDefault()}
        >
          <div data-ss-input>
            <div className="flex items-center border-b border-border px-3">
              <svg className="mr-2 h-4 w-4 shrink-0 opacity-50" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="flex h-10 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="max-h-60 overflow-y-auto overflow-x-hidden p-1" onWheel={e => e.stopPropagation()}>
              {filtered.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">No results found.</div>
              ) : (
                filtered.map(entry => (
                  <div
                    key={entry.value}
                    role="option"
                    aria-selected={value === entry.value}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => {
                      onValueChange(entry.value);
                      setSearch("");
                      setOpen(false);
                    }}
                    className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                  >
                    <Check
                      className={cn("mr-2 h-4 w-4 shrink-0", value === entry.value ? "opacity-100" : "opacity-0")}
                    />
                    <span className="truncate">{entry.label}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
