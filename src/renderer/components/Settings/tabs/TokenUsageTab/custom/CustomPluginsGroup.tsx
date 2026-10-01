import type { SurfaceItem } from '../../../../../../shared/tokenUsage/surfaceTypes';
import Badge from '../../../../ui/Badge';

interface CustomPluginsGroupProps {
  plugins: SurfaceItem[];
}

export function CustomPluginsGroup({ plugins }: CustomPluginsGroupProps) {
  if (plugins.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 my-4" data-testid="token-custom-plugins-group">
      <span className="text-[10px] font-semibold tracking-wider uppercase text-[var(--text-sub)]">
        Plugins ({plugins.length})
      </span>
      <div className="rounded-[12px] border border-[var(--border-hairline)] bg-[var(--bg-surface)] overflow-hidden divide-y divide-[var(--border-hairline)]">
        {plugins.map((plugin) => {
          const isEnabled = plugin.enabled !== false;

          return (
            <div
              key={plugin.id}
              className="flex items-center justify-between px-3 py-2 text-[13px]"
              data-testid={`plugin-${plugin.name}`}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-[var(--text-main)]">{plugin.name}</span>
                <Badge tone="neutral">{plugin.source}</Badge>
                {plugin.readOnlyReason && (
                  <span className="text-[11px] text-[var(--text-sub)]">({plugin.readOnlyReason})</span>
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
