import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

interface SlackItem {
  id: string;
  name: string;
}

interface MentionState {
  open: boolean;
  query: string;
  triggerPos: number;
  triggerType: "@" | "#";
  activeIndex: number;
}

const CLOSED: MentionState = { open: false, query: "", triggerPos: -1, triggerType: "@", activeIndex: 0 };

function detectMention(text: string, cursor: number): { trigger: "@" | "#"; query: string; triggerPos: number } | null {
  const before = text.slice(0, cursor);
  const match = before.match(/(?:^|[\s\n])([@#])([^\s@#]*)$/);
  if (!match) return null;
  const trigger = match[1] as "@" | "#";
  const query = match[2];
  const triggerPos = cursor - match[0].trimStart().length;
  return { trigger, query, triggerPos };
}

interface MentionDropdownProps {
  items: SlackItem[];
  triggerType: "@" | "#";
  activeIndex: number;
  onSelect: (item: SlackItem) => void;
  onHover: (i: number) => void;
  style?: React.CSSProperties;
  className?: string;
}

export function MentionDropdown({ items, triggerType, activeIndex, onSelect, onHover, style, className }: MentionDropdownProps) {
  if (items.length === 0) return null;
  return (
    <div
      className={cn(
        "z-50 bg-popover border border-border rounded-md shadow-lg overflow-hidden min-w-[180px] max-w-[280px]",
        className
      )}
      style={style}
      onMouseDown={e => e.preventDefault()}
    >
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          onMouseDown={() => onSelect(item)}
          onMouseEnter={() => onHover(i)}
          className={cn(
            "w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition-colors",
            i === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-muted text-foreground"
          )}
        >
          <span className="text-[#FF9100] font-mono text-xs flex-shrink-0">{triggerType}</span>
          <span className="truncate">{item.name}</span>
        </button>
      ))}
    </div>
  );
}

interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  rows?: number;
  "data-testid"?: string;
  onBlur?: React.FocusEventHandler<HTMLTextAreaElement>;
  name?: string;
}

export function MentionTextarea({
  value,
  onChange,
  placeholder,
  className,
  style,
  "data-testid": testId,
  onBlur,
  name,
}: MentionTextareaProps) {
  const [state, setState] = useState<MentionState>(CLOSED);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: members = [] } = useQuery<SlackItem[]>({
    queryKey: ["/api/slack/members"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: channels = [] } = useQuery<SlackItem[]>({
    queryKey: ["/api/slack/channels"],
    staleTime: 5 * 60 * 1000,
  });

  const getFiltered = (s: MentionState): SlackItem[] => {
    if (!s.open) return [];
    const q = s.query.toLowerCase();
    const list = s.triggerType === "@" ? members : channels;
    return list.filter(it => it.name.toLowerCase().includes(q)).slice(0, 8);
  };

  const filtered = getFiltered(state);

  const updateState = useCallback((text: string, cursor: number) => {
    const found = detectMention(text, cursor);
    if (!found) {
      setState(CLOSED);
      return;
    }
    const list = found.trigger === "@" ? members : channels;
    const q = found.query.toLowerCase();
    const has = list.some(it => it.name.toLowerCase().includes(q));
    if (!has && found.query.length > 0) {
      setState(CLOSED);
      return;
    }
    setState(prev => ({
      open: true,
      query: found.query,
      triggerPos: found.triggerPos,
      triggerType: found.trigger,
      activeIndex: prev.open && prev.triggerType === found.trigger ? prev.activeIndex : 0,
    }));
  }, [members, channels]);

  const select = useCallback((item: SlackItem) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart;
    const insert = state.triggerType + item.name + " ";
    const newValue = value.slice(0, state.triggerPos) + insert + value.slice(cursor);
    onChange(newValue);
    const newCursor = state.triggerPos + insert.length;
    setState(CLOSED);
    setTimeout(() => {
      ta.setSelectionRange(newCursor, newCursor);
      ta.focus();
    }, 0);
  }, [value, onChange, state]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    updateState(e.target.value, e.target.selectionStart);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!state.open || filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setState(s => ({ ...s, activeIndex: Math.min(s.activeIndex + 1, filtered.length - 1) }));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setState(s => ({ ...s, activeIndex: Math.max(s.activeIndex - 1, 0) }));
    } else if (e.key === "Enter" || e.key === "Tab") {
      if (filtered[state.activeIndex]) {
        e.preventDefault();
        select(filtered[state.activeIndex]);
      }
    } else if (e.key === "Escape") {
      setState(CLOSED);
    }
  };

  const handleClick = () => {
    const ta = textareaRef.current;
    if (ta) updateState(ta.value, ta.selectionStart);
  };

  useEffect(() => {
    if (!state.open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setState(CLOSED);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [state.open]);

  return (
    <div ref={containerRef} className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
        onBlur={onBlur}
        name={name}
        placeholder={placeholder}
        data-testid={testId}
        style={style}
        className={className}
      />
      {state.open && filtered.length > 0 && (
        <MentionDropdown
          items={filtered}
          triggerType={state.triggerType}
          activeIndex={state.activeIndex}
          onSelect={select}
          onHover={i => setState(s => ({ ...s, activeIndex: i }))}
          className="absolute bottom-full mb-1 left-0"
        />
      )}
    </div>
  );
}
