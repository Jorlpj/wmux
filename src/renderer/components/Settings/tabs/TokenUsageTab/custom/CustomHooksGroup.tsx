import type { SurfaceItem } from '../../../../../../shared/tokenUsage/surfaceTypes';
import Badge from '../../../../ui/Badge';

interface CustomHooksGroupProps {
  hooks: SurfaceItem[];
}

export function CustomHooksGroup({ hooks }: CustomHooksGroupProps) {
  if (hooks.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 my-4" data-testid="token-custom-hooks-group">
      <span className="text-[10px] font-semibold tracking-wider uppercase text-[var(--text-sub)]">
        Hooks ({hooks.length})
      </span>
      <div className="rounded-[12px] border border-[var(--border-hairline)] bg-[var(--bg-surface)] overflow-hidden divide-y divide-[var(--border-hairline)]">
        {hooks.map((hook) => {
          const isEnabled = hook.enabled !== false;
          const costTone =
            hook.hookCost === 'calls-model' || hook.hookCost === 'injects-context'
              ? 'warning'
              : 'neutral';

          return (
            <div
              key={hook.id}
              className="flex items-center justify-between px-3 py-2 text-[13px]"
              data-testid={`hook-${hook.name}`}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-[var(--text-main)]">{hook.name}</span>
                <Badge tone="neutral">{hook.source}</Badge>
                {hook.hookEvent && (
                  <span className="text-[11px] ui-code text-[var(--text-sub)]">{hook.hookEvent}</span>
                )}
                {hook.hookCost && (
                  <Badge tone={costTone}>{hook.hookCost}</Badge>
                )}
                {hook.wmuxRequired && (
                  <span className="text-[11px] text-[var(--accent)] font-medium">wmux required</span>
                )}
                {hook.readOnlyReason && (
                  <span className="text-[11px] text-[var(--text-sub)]">({hook.readOnlyReason})</span>
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
