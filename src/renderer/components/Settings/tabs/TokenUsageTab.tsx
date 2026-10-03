// ─── Settings → Agents → Token usage ──────────────────────────────────────────
//
// Two jobs only: watch the quota of every account the user added, and cut what
// each CLI loads into context (MCP servers and tools, wmux tools, skills,
// plugins, hooks). A choice here applies to the CLI itself, so every pane of
// that CLI gets it. Models, effort and role bindings live in Roles & fan-out.

import { useT } from '../../../hooks/useT';
import { SettingsSection } from '../SettingsLayout';
import { QuotaSection } from './TokenUsageTab/QuotaSection';
import { CustomPanel } from './TokenUsageTab/CustomPanel';
import { SavedSurfaceProfiles } from './TokenUsageTab/profiles/SavedSurfaceProfiles';

type T = ReturnType<typeof useT>;

export interface TokenUsageViewProps {
  t: T;
}

export function TokenUsageView({ t }: TokenUsageViewProps) {
  return (
    <div className="settings-page" data-testid="token-usage-tab">
      <QuotaSection t={t} />
      <CustomPanel t={t} />
      <SettingsSection id="tokenprofiles">
        <div className="px-4 pb-4">
          <SavedSurfaceProfiles t={t} />
        </div>
      </SettingsSection>
    </div>
  );
}

export default function TokenUsageTab() {
  const t = useT();
  return <TokenUsageView t={t} />;
}
