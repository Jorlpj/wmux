// ─── Settings → Agents → Token usage ──────────────────────────────────────────
//
// One place to see what each bound role costs and to switch every role to a
// cheaper model/effort in one step. The profile is a shortcut over the role
// bindings (src/shared/tokenProfiles.ts), never a second source of truth: the
// selected profile is DERIVED from the bindings, and Apply writes bindings.
// Permissions are the operator's and are never touched here.

import { useMemo, useState } from 'react';
import { useStore } from '../../../stores';
import { useT } from '../../../hooks/useT';
import { applyRoleBinding, type OrchestratorRoleBindings, type RoleBinding } from '../../../../shared/orchestratorRole';
import { agyEffortOf } from '../../../../shared/modelCatalog';
import { ROLE_TOOL_SURFACES } from '../../../../shared/roleSurfaces';
import { CORE_TOOL_SURFACE } from '../../../../shared/coreSurface';
import {
  TOKEN_PROFILES,
  applyTokenProfile,
  matchTokenProfile,
  tokenProfileChanges,
  type TokenProfile,
} from '../../../../shared/tokenProfiles';
import { SettingNote, SettingRow, SettingsSection } from '../SettingsLayout';
import SegmentedControl from '../../ui/SegmentedControl';
import Button from '../../ui/Button';
import Badge from '../../ui/Badge';

type T = ReturnType<typeof useT>;

const ROLE_ORDER = ['Planner', 'Builder', 'Tester', 'Reviewer'];

function effortOf(b: RoleBinding): string | undefined {
  return b.agent === 'agy' && b.model ? agyEffortOf(b.model) : b.effort;
}

function describeBinding(b: RoleBinding): string {
  return [b.model ?? 'default', effortOf(b) ? `· ${effortOf(b)}` : '', b.tools ? `· tools ${b.tools}` : '']
    .filter(Boolean)
    .join(' ');
}

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

const PROFILE_KEYS: Record<TokenProfile | 'custom', string> = {
  full: 'settings.tokenProfileFull',
  coding: 'settings.tokenProfileCoding',
  balanced: 'settings.tokenProfileBalanced',
  minimal: 'settings.tokenProfileMinimal',
  custom: 'settings.tokenProfileCustom',
};

export interface TokenUsageViewProps {
  bindings: OrchestratorRoleBindings;
  onApply: (next: OrchestratorRoleBindings) => void;
  onOpenTab: (tab: 'roles' | 'orchestrator') => void;
  deckBrainModel: string;
  deckBrainEffort: string;
  t: T;
}

export function TokenUsageView({ bindings, onApply, onOpenTab, deckBrainModel, deckBrainEffort, t }: TokenUsageViewProps) {
  const current = matchTokenProfile(bindings);
  const [picked, setPicked] = useState<TokenProfile>(current === 'custom' ? 'minimal' : current);
  const changes = useMemo(() => tokenProfileChanges(bindings, picked), [bindings, picked]);
  const roles = [
    ...ROLE_ORDER.filter((r) => bindings[r]),
    ...Object.keys(bindings).filter((r) => !ROLE_ORDER.includes(r)),
  ];
  const bound = roles.length > 0;
  const sharedAgy = bindings.Builder?.agent && bindings.Builder.agent === bindings.Tester?.agent
    ? bindings.Builder.agent
    : undefined;
  const label = (p: TokenProfile | 'custom') => t(PROFILE_KEYS[p]);

  return (
    <div className="settings-page" data-testid="token-usage-tab">
      <SettingsSection
        id="tokenprofile"
        title={t('settings.tokenProfile')}
        description={t('settings.tokenProfileDesc')}
        action={<Badge data-testid="token-profile-current">{label(current)}</Badge>}
      >
        {!bound ? (
          <SettingRow label={t('settings.tokenProfileNoRoles')}>
            <Button variant="secondary" size="sm" onClick={() => onOpenTab('roles')}>
              {t('settings.tokenProfileBindFirst')}
            </Button>
          </SettingRow>
        ) : (
          <>
            <SettingRow label={t('settings.tokenProfile')} description={t(`${PROFILE_KEYS[picked]}Desc`)}>
              <SegmentedControl<TokenProfile>
                value={picked}
                onValueChange={setPicked}
                options={TOKEN_PROFILES.map((p) => ({ value: p, label: label(p) }))}
                data-testid="token-profile-picker"
              />
            </SettingRow>
            {changes.length === 0 ? (
              <SettingNote data-testid="token-profile-nochanges">{t('settings.tokenProfileNoChanges')}</SettingNote>
            ) : (
              <div className="settings-row" data-testid="token-profile-changes">
                {changes.map((c) => (
                  <p key={c.role} className="ui-code m-0 text-[11px] text-[var(--text-sub)]" data-token-change={c.role}>
                    {c.role}: {describeBinding(c.before)} → {describeBinding(c.after)}
                  </p>
                ))}
                <div className="mt-2 flex justify-end">
                  <Button
                    variant="primary"
                    size="sm"
                    data-testid="token-profile-apply"
                    onClick={() => onApply(applyTokenProfile(bindings, picked))}
                  >
                    {t('settings.tokenProfileApply')}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </SettingsSection>

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
