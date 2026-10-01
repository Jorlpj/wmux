import type { SurfaceItem } from '../../../../../../shared/tokenUsage/surfaceTypes';
import Badge from '../../../../ui/Badge';

interface CustomBuiltinsGroupProps {
  items: SurfaceItem[];
}

export function CustomBuiltinsGroup({ items }: CustomBuiltinsGroupProps) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 my-4" data-testid="token-custom-builtins-group">
      <span className="text-[10px] font-semibold tracking-wider uppercase text-[var(--text-sub)]">
        Built-in Tools & Context ({items.length})
      </span>
      <div className="rounded-[12px] border border-[var(--border-hairline)] bg-[var(--bg-surface)] overflow-hidden divide-y divide-[var(--border-hairline)]">
        {items.map((item) => {
          const isEnabled = item.enabled !== false;

          return (
            <div
              key={item.id}
              className="flex items-center justify-between px-3 py-2 text-[13px]"
              data-testid={`builtin-${item.name}`}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-[var(--text-main)]">{item.name}</span>
                <Badge tone="neutral">{item.kind === 'builtin-tool' ? 'builtin tool' : 'context'}</Badge>
                {item.readOnlyReason && (
                  <span className="text-[11px] text-[var(--text-sub)]">({item.readOnlyReason})</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={isEnabled ? 'success' : 'neutral'}>
                  {isEnabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
