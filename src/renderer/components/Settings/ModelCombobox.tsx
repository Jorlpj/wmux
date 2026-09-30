// ─── Model combobox for role bindings ────────────────────────────────────────
//
// Text input + a listbox of the models the agent CLI reported (ModelCatalog).
// Opening shows the FULL list regardless of the current value — a native
// <datalist> filters by the value, so a chosen field re-opened showed only
// itself — and typing filters. Free text is always accepted: a codex id or a
// model newer than the catalog must stay typeable.

import { useEffect, useRef, useState } from 'react';
import Input from '../ui/Input';
import Popover from '../ui/Popover';
import type { CatalogModel } from '../../../shared/modelCatalog';

export interface ModelComboboxProps {
  value: string;
  onChange: (value: string) => void;
  models: readonly CatalogModel[];
  'aria-label': string;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function ModelCombobox({
  value,
  onChange,
  models,
  placeholder,
  className,
  style,
  'aria-label': ariaLabel,
}: ModelComboboxProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  // What the user typed since opening; null = show everything.
  const [query, setQuery] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const q = query?.trim().toLowerCase() ?? '';
  const shown = q
    ? models.filter((m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q))
    : models;

  const close = () => {
    setOpen(false);
    setQuery(null);
  };

  return (
    <div ref={ref} className="relative" style={style} data-model-combobox>
      <Input
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-autocomplete="list"
        value={query ?? value}
        placeholder={placeholder}
        className={className}
        style={{ width: '100%' }}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          // Committed per keystroke, like the other binding fields: no edit can
          // be stranded by the panel unmounting. The store normalizes; the
          // field keeps showing the raw text until blur.
          setQuery(e.target.value);
          setOpen(true);
          onChange(e.target.value);
        }}
        onBlur={() => setQuery(null)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          if (e.key === 'Enter') {
            close();
            e.currentTarget.blur();
          }
        }}
      />
      {open && shown.length > 0 && (
        // The quiet popover panel from ui/ (DESIGN.md). The roles section opts
        // into overflowVisible so the list is not clipped by the group.
        <Popover
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 top-full mt-1 z-50 min-w-[340px] max-h-64 overflow-y-auto"
        >
          {shown.map((m) => (
            <button
              key={m.id}
              type="button"
              role="option"
              aria-selected={m.id === value}
              // mousedown, not click: runs before the input's blur commits text.
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(m.id);
                close();
              }}
              className={`flex items-center justify-between gap-3 w-full px-2.5 py-1 rounded-md text-left text-[12px] hover:bg-[var(--surface-fill-hover)] ${
                m.id === value ? 'text-[var(--text-main)] font-semibold' : 'text-[var(--text-sub)] hover:text-[var(--text-main)]'
              }`}
            >
              <span className="font-mono whitespace-nowrap">{m.id}</span>
              <span className="opacity-70 whitespace-nowrap">{m.label}</span>
            </button>
          ))}
        </Popover>
      )}
    </div>
  );
}

export default ModelCombobox;
