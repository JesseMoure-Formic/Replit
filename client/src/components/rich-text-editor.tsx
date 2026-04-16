import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Bold, Italic, List, ListOrdered, Maximize2, Minimize2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { MentionDropdown } from "@/components/mention-textarea";

interface SlackItem {
  id: string;
  name: string;
}

function htmlToPlainText(html: string): string {
  if (!html) return "";
  let result = html;
  result = result.replace(/<ol>([\s\S]*?)<\/ol>/g, (_: string, content: string) => {
    let index = 0;
    return content.replace(/<li[^>]*>([\s\S]*?)<\/li>/g, (_2: string, item: string) => {
      index++;
      const text = item.replace(/<[^>]+>/g, "").trim();
      return `${index}. ${text}\n`;
    });
  });
  result = result.replace(/<ul>([\s\S]*?)<\/ul>/g, (_: string, content: string) => {
    return content.replace(/<li[^>]*>([\s\S]*?)<\/li>/g, (_2: string, item: string) => {
      const text = item.replace(/<[^>]+>/g, "").trim();
      return `• ${text}\n`;
    });
  });
  result = result.replace(/<\/p>\s*<p>/g, "\n");
  result = result.replace(/<p[^>]*>([\s\S]*?)<\/p>/g, (_: string, content: string) => {
    const text = content.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim();
    return text + "\n";
  });
  result = result.replace(/<br\s*\/?>/gi, "\n");
  result = result.replace(/<[^>]+>/g, "");
  result = result.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
  result = result.replace(/\n{3,}/g, "\n\n").trim();
  return result;
}

function plainTextToHtml(text: string): string {
  if (!text || text.trim() === "") return "<p></p>";
  const lines = text.split("\n");
  let html = "";
  let bulletItems: string[] = [];
  let orderedItems: string[] = [];

  const flushBullets = () => {
    if (bulletItems.length) {
      html += "<ul>" + bulletItems.map((i) => `<li><p>${escapeHtml(i)}</p></li>`).join("") + "</ul>";
      bulletItems = [];
    }
  };
  const flushOrdered = () => {
    if (orderedItems.length) {
      html += "<ol>" + orderedItems.map((i) => `<li><p>${escapeHtml(i)}</p></li>`).join("") + "</ol>";
      orderedItems = [];
    }
  };

  for (const line of lines) {
    const bulletMatch = line.match(/^[•\-\*]\s+(.*)$/);
    const orderedMatch = line.match(/^\d+\.\s+(.*)$/);
    if (bulletMatch) {
      flushOrdered();
      bulletItems.push(bulletMatch[1]);
    } else if (orderedMatch) {
      flushBullets();
      orderedItems.push(orderedMatch[1]);
    } else {
      flushBullets();
      flushOrdered();
      html += `<p>${line ? escapeHtml(line) : ""}</p>`;
    }
  }
  flushBullets();
  flushOrdered();
  return html || "<p></p>";
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── Mention state for Tiptap ─────────────────────────────────────────────────

interface TipMention {
  open: boolean;
  query: string;
  triggerType: "@" | "#";
  activeIndex: number;
  rect: { top: number; left: number; bottom: number } | null;
}

const TIP_CLOSED: TipMention = { open: false, query: "", triggerType: "@", activeIndex: 0, rect: null };

function detectTrigger(textBefore: string): { trigger: "@" | "#"; query: string } | null {
  const m = textBefore.match(/(?:^|[\s\n])([@#])([^\s@#]*)$/);
  if (!m) return null;
  return { trigger: m[1] as "@" | "#", query: m[2] };
}

function getCursorRect(): TipMention["rect"] {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  return { top: r.top, left: r.left, bottom: r.bottom };
}

// ─── Toolbar ─────────────────────────────────────────────────────────────────

function ToolbarButtons({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;
  const btnClass = (active: boolean) =>
    `p-1 rounded transition-colors ${active ? "bg-white/20 text-white" : "text-white/50 hover:text-white/80 hover:bg-white/10"}`;
  return (
    <>
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}
        className={btnClass(editor.isActive("bold"))}
        title="Bold"
      >
        <Bold className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}
        className={btnClass(editor.isActive("italic"))}
        title="Italic"
      >
        <Italic className="h-3.5 w-3.5" />
      </button>
      <div className="w-px h-4 bg-white/20" />
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBulletList().run(); }}
        className={btnClass(editor.isActive("bulletList"))}
        title="Bullet list"
      >
        <List className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleOrderedList().run(); }}
        className={btnClass(editor.isActive("orderedList"))}
        title="Numbered list"
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </button>
    </>
  );
}

// ─── Shared Mention Dropdown Portal ──────────────────────────────────────────

function TipMentionDropdown({
  tip,
  filtered,
  onSelect,
  onHover,
}: {
  tip: TipMention;
  filtered: SlackItem[];
  onSelect: (item: SlackItem) => void;
  onHover: (i: number) => void;
}) {
  if (!tip.open || filtered.length === 0 || !tip.rect) return null;
  const style: React.CSSProperties = {
    position: "fixed",
    top: tip.rect.bottom + 4,
    left: tip.rect.left,
  };
  return createPortal(
    <MentionDropdown
      items={filtered}
      triggerType={tip.triggerType}
      activeIndex={tip.activeIndex}
      onSelect={onSelect}
      onHover={onHover}
      style={style}
    />,
    document.body
  );
}

// ─── Shared editor factory hook ───────────────────────────────────────────────

function useMentionEditor(
  value: string,
  onChange: (v: string) => void,
  placeholder: string | undefined,
  members: SlackItem[],
  channels: SlackItem[]
) {
  const lastExternalValue = useRef(value);
  const isInternalChange = useRef(false);
  const [tip, setTip] = useState<TipMention>(TIP_CLOSED);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: placeholder || "Enter text..." }),
    ],
    content: plainTextToHtml(value),
    onUpdate: ({ editor }) => {
      isInternalChange.current = true;
      const plain = htmlToPlainText(editor.getHTML());
      lastExternalValue.current = plain;
      onChange(plain);

      const { from } = editor.state.selection;
      const textBefore = editor.state.doc.textBetween(0, from, "\n");
      const found = detectTrigger(textBefore);
      if (!found) { setTip(TIP_CLOSED); return; }
      const list = found.trigger === "@" ? members : channels;
      const q = found.query.toLowerCase();
      if (found.query.length > 0 && !list.some(it => it.name.toLowerCase().includes(q))) {
        setTip(TIP_CLOSED); return;
      }
      setTip(prev => ({
        open: true,
        query: found.query,
        triggerType: found.trigger,
        activeIndex: prev.open && prev.triggerType === found.trigger ? prev.activeIndex : 0,
        rect: getCursorRect(),
      }));
    },
  });

  useEffect(() => {
    if (!editor || isInternalChange.current) {
      isInternalChange.current = false;
      return;
    }
    if (value !== lastExternalValue.current) {
      lastExternalValue.current = value;
      editor.commands.setContent(plainTextToHtml(value));
    }
  }, [value, editor]);

  const filtered: SlackItem[] = (() => {
    if (!tip.open) return [];
    const q = tip.query.toLowerCase();
    const list = tip.triggerType === "@" ? members : channels;
    return list.filter(it => it.name.toLowerCase().includes(q)).slice(0, 8);
  })();

  const insertMention = useCallback((item: SlackItem) => {
    if (!editor) return;
    const insert = tip.triggerType + item.name + " ";
    const from = editor.state.selection.from;
    const triggerLen = 1 + tip.query.length;
    editor.chain().focus()
      .deleteRange({ from: from - triggerLen, to: from })
      .insertContent(insert)
      .run();
    setTip(TIP_CLOSED);
  }, [editor, tip]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!tip.open || filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setTip(s => ({ ...s, activeIndex: Math.min(s.activeIndex + 1, filtered.length - 1) }));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setTip(s => ({ ...s, activeIndex: Math.max(s.activeIndex - 1, 0) }));
    } else if (e.key === "Enter" || e.key === "Tab") {
      if (filtered[tip.activeIndex]) { e.preventDefault(); insertMention(filtered[tip.activeIndex]); }
    } else if (e.key === "Escape") {
      setTip(TIP_CLOSED);
    }
  }, [tip, filtered, insertMention]);

  return { editor, tip, filtered, insertMention, handleKeyDown, setTip };
}

// ─── Main RichTextEditor (inline) ─────────────────────────────────────────────

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  testId?: string;
}

export function RichTextEditor({ value, onChange, placeholder, testId }: RichTextEditorProps) {
  const [popout, setPopout] = useState(false);

  const { data: members = [] } = useQuery<SlackItem[]>({
    queryKey: ["/api/slack/members"],
    staleTime: 5 * 60 * 1000,
  });
  const { data: channels = [] } = useQuery<SlackItem[]>({
    queryKey: ["/api/slack/channels"],
    staleTime: 5 * 60 * 1000,
  });

  const { editor, tip, filtered, insertMention, handleKeyDown, setTip } = useMentionEditor(
    value, onChange, placeholder, members, channels
  );

  return (
    <>
      <div
        className="rounded-md border border-input bg-muted/50 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/10 bg-muted/30">
          <ToolbarButtons editor={editor} />
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setPopout(true)}
            className="p-1 rounded text-white/50 hover:text-white/80 hover:bg-white/10 transition-colors"
            title="Expand editor"
            data-testid="button-expand-description"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
        <EditorContent
          data-testid={testId}
          editor={editor}
          className="rich-text-editor-content"
          style={{ minHeight: "96px" }}
        />
      </div>

      <TipMentionDropdown
        tip={tip}
        filtered={filtered}
        onSelect={insertMention}
        onHover={i => setTip(s => ({ ...s, activeIndex: i }))}
      />

      <Dialog open={popout} onOpenChange={setPopout}>
        <DialogContent className="max-w-3xl flex flex-col" style={{ height: "80vh" }}>
          <DialogHeader>
            <DialogTitle>Edit Description</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 rounded-md border border-input bg-muted/50 overflow-hidden">
            <PopoutEditor
              value={value}
              onChange={onChange}
              placeholder={placeholder}
              onClose={() => setPopout(false)}
              members={members}
              channels={channels}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Popout editor ────────────────────────────────────────────────────────────

function PopoutEditor({
  value,
  onChange,
  placeholder,
  onClose,
  members,
  channels,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onClose: () => void;
  members: SlackItem[];
  channels: SlackItem[];
}) {
  const { editor, tip, filtered, insertMention, handleKeyDown, setTip } = useMentionEditor(
    value, onChange, placeholder, members, channels
  );

  return (
    <div className="flex flex-col h-full" onKeyDown={handleKeyDown}>
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/10 bg-muted/30 rounded-t-md">
        <ToolbarButtons editor={editor} />
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded text-white/50 hover:text-white/80 hover:bg-white/10 transition-colors"
          title="Collapse"
        >
          <Minimize2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <EditorContent
        editor={editor}
        className="rich-text-editor-content flex-1 overflow-y-auto"
        style={{ minHeight: "300px" }}
      />
      <TipMentionDropdown
        tip={tip}
        filtered={filtered}
        onSelect={insertMention}
        onHover={i => setTip(s => ({ ...s, activeIndex: i }))}
      />
    </div>
  );
}
