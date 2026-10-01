import type { SurfaceItem } from '../../../../../../shared/tokenUsage/surfaceTypes';
import Badge from '../../../../ui/Badge';

interface CustomSkillsGroupProps {
  skills: SurfaceItem[];
}

export function CustomSkillsGroup({ skills }: CustomSkillsGroupProps) {
  if (skills.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 my-4" data-testid="token-custom-skills-group">
      <span className="text-[10px] font-semibold tracking-wider uppercase text-[var(--text-sub)]">
        Skills ({skills.length})
      </span>
      <div className="rounded-[12px] border border-[var(--border-hairline)] bg-[var(--bg-surface)] overflow-hidden divide-y divide-[var(--border-hairline)]">
        {skills.map((skill) => {
          const isEnabled = skill.enabled !== false;

          return (
            <div
              key={skill.id}
              className="flex items-center justify-between px-3 py-2 text-[13px]"
              data-testid={`skill-${skill.name}`}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-[var(--text-main)]">{skill.name}</span>
                <Badge tone="neutral">{skill.source}</Badge>
                {skill.descriptionChars !== null && (
                  <span className="text-[11px] text-[var(--text-sub)]">
                    {skill.descriptionChars} chars
                  </span>
                )}
                {skill.readOnlyReason && (
                  <span className="text-[11px] text-[var(--text-sub)]">({skill.readOnlyReason})</span>
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
