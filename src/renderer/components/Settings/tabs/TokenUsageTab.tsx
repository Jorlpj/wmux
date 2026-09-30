// ─── Settings → Agents → Token usage ──────────────────────────────────────────
//
// One place to see what each bound role costs and to switch every role to a
// cheaper model/effort in one step. The profile is a shortcut over the role
// bindings (src/shared/tokenProfiles.ts), never a second source of truth: the
// selected profile is DERIVED from the bindings, and Apply writes bindings.
// Permissions are the operator's and are never touched here.

import { useState } from 'react';
import { useStore } from '../../../stores';
import { useT } from '../../../hooks/useT';
import { applyRoleBinding, type OrchestratorRoleBindings, type RoleBinding } from '../../../../shared/orchestratorRole';
import { ROLE_TOOL_SURFACES } from '../../../../shared/roleSurfaces';
import { CORE_TOOL_SURFACE } from '../../../../shared/coreSurface';
import { SettingNote, SettingRow, SettingsSection } from '../SettingsLayout';
import Button from '../../ui/Button';
import { QuotaSection } from './TokenUsageTab/QuotaSection';
import { ProfileSection, describeBinding } from './TokenUsageTab/ProfileSection';
import { CustomPanel } from './TokenUsageTab/CustomPanel';

type T = ReturnType<typeof useT>;

const ROLE_ORDER = ['Planner', 'Builder', 'Tester', 'Reviewer'];

function argvPreview(b: RoleBinding): string {
  return b.agent ? applyRoleBinding(b.agent, b, { spawnedProcess: true }).command : '';
}

/** What the role's pane sees from wmux at its binding's tool level. */
function toolsLabel(role: string, b: RoleBinding, t: T): string {
  if (!b.tools) return t('settings.tokenToolsCliDefault');
  if (b.tools === 'full') return t('settings.tokenToolsAll');
  const surface = (ROLE_TOOL_SURFACES as Record<string, readonly string[] | undefined>)[role];
  const n = b.tools === 'role' && surface ? surface.length : CORE_TOOL_SURFACE.length;
  return t('settings.tokenRoleTools', { n });
}

export interface TokenUsageViewProps {
  bindings: OrchestratorRoleBindings;
  onApply: (next: OrchestratorRoleBindings) => void;
  onOpenTab: (tab: 'roles' | 'orchestrator') => void;
  deckBrainModel: string;
  deckBrainEffort: string;
  t: T;
}

export function TokenUsageView({ bindings, onApply, onOpenTab, deckBrainModel, deckBrainEffort, t }: TokenUsageViewProps) {
  const [showCustom, setShowCustom] = useState(false);
  const roles = [
    ...ROLE_ORDER.filter((r) => bindings[r]),
    ...Object.keys(bindings).filter((r) => !ROLE_ORDER.includes(r)),
  ];
  const bound = roles.length > 0;
  const sharedAgy = bindings.Builder?.agent && bindings.Builder.agent === bindings.Tester?.agent
    ? bindings.Builder.agent
    : undefined;

  return (
    <div className="settings-page" data-testid="token-usage-tab">
      <QuotaSection t={t} />

      {/* Catalog search jump anchor: <SettingsSection id="tokenprofile" */}
      <ProfileSection
        bindings={bindings}
        onApply={onApply}
        onOpenTab={onOpenTab}
        t={t}
        showCustom={showCustom}
        onToggleCustom={() => setShowCustom((v) => !v)}
      />

      {showCustom && <CustomPanel t={t} />}

      <SettingsSection id="tokenroles" title={t('settings.tokenRoles')} description={t('settings.tokenRolesDesc')}>
        {!bound && <SettingNote>{t('settings.tokenProfileNoRoles')}</SettingNote>}
        {roles.map((role) => {
          const b = bindings[role];
          return (
            <div key={role} className="settings-row" data-token-role={role}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-medium">{role}</span>
                <span className="text-[11px] text-[var(--text-sub)]">
                  {b.agent ?? '—'} · {describeBinding(b)} · {toolsLabel(role, b, t)}
                </span>
              </div>
              {b.agent && (
                <p className="ui-code m-0 mt-1 text-[11px] text-[var(--text-sub)]">{argvPreview(b)}</p>
              )}
            </div>
          );
        })}
        {sharedAgy && (
          <SettingNote data-testid="token-shared-pane">{t('settings.tokenSharedPane', { agent: sharedAgy })}</SettingNote>
        )}
      </SettingsSection>

      <SettingsSection id="tokendeck" title={t('settings.tokenDeck')} description={t('settings.tokenDeckDesc')}>
        <SettingRow
          label={t('settings.tokenDeckModel')}
          description={[deckBrainModel || 'default', deckBrainEffort ? `· ${deckBrainEffort}` : ''].join(' ').trim()}
        >
          <Button variant="secondary" size="sm" onClick={() => onOpenTab('orchestrator')}>
            {t('settings.tokenOpenOrchestrator')}
          </Button>
        </SettingRow>
      </SettingsSection>
    </div>
  );
}

export default function TokenUsageTab({ onOpenTab }: { onOpenTab: (tab: 'roles' | 'orchestrator') => void }) {
  const t = useT();
  const bindings = useStore((s) => s.orchestratorRoleBindings);
  const setBinding = useStore((s) => s.setOrchestratorRoleBinding);
  const deckBrainModel = useStore((s) => s.deckBrainModel);
  const deckBrainEffort = useStore((s) => s.deckBrainEffort);
  return (
    <TokenUsageView
      bindings={bindings}
      onApply={(next) => {
        for (const [role, binding] of Object.entries(next)) {
          if (binding !== bindings[role]) setBinding(role, binding);
        }
      }}
      onOpenTab={onOpenTab}
      deckBrainModel={deckBrainModel}
      deckBrainEffort={deckBrainEffort}
      t={t}
    />
  );
}
