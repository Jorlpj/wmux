// ─── Token profiles (Settings → Agents → Token usage) ─────────────────────────
//
// A profile is a SHORTCUT that writes model/effort into the role bindings; the
// bindings stay the source of truth and remain editable in Roles & fan-out.
// Nothing is stored about the profile itself: the tab derives which profile the
// current bindings match (or "custom"), so editing a row by hand can never
// leave a stale "Minimal" label behind.
//
// Rules, per role, only for a role that is already bound:
//   - a profile touches model/effort only; agent, extra args, skip-permissions
//     and fresh-context are the operator's and are never changed;
//   - it only acts when the bound agent is the one the profile names for that
//     role — a Reviewer bound to claude is left alone by a codex preset;
//   - agy carries effort in the model id suffix (D3): the family is kept when it
//     is a Flash family, otherwise the profile's default Flash family is used;
//   - codex keeps the operator's model and gets the effort only.

import { agyEffortOf, agyFamilyOf } from './modelCatalog';
import type { OrchestratorRoleBindings, RoleBinding } from './orchestratorRole';

export const TOKEN_PROFILES = ['balanced', 'minimal'] as const;
export type TokenProfile = (typeof TOKEN_PROFILES)[number];

interface RolePreset {
  agent: 'claude' | 'codex' | 'agy';
  /** Full model id; for agy the default family when the bound one is not Flash. */
  model?: string;
  effort: string;
}

const DEFAULT_AGY_FLASH = 'gemini-3.8-flash';

export const TOKEN_PROFILE_PRESETS: Readonly<Record<TokenProfile, Readonly<Record<string, RolePreset>>>> = {
  balanced: {
    Planner: { agent: 'claude', model: 'claude-sonnet-5-5', effort: 'high' },
    Builder: { agent: 'agy', model: DEFAULT_AGY_FLASH, effort: 'medium' },
    Tester: { agent: 'agy', model: DEFAULT_AGY_FLASH, effort: 'medium' },
    Reviewer: { agent: 'codex', effort: 'medium' },
  },
  minimal: {
    Planner: { agent: 'claude', model: 'claude-sonnet-5-5', effort: 'medium' },
    Builder: { agent: 'agy', model: DEFAULT_AGY_FLASH, effort: 'low' },
    Tester: { agent: 'agy', model: DEFAULT_AGY_FLASH, effort: 'medium' },
    Reviewer: { agent: 'codex', effort: 'low' },
  },
};

function applyPreset(binding: RoleBinding, preset: RolePreset): RoleBinding {
  if (binding.agent !== preset.agent) return binding;
  if (preset.agent === 'agy') {
    const current = binding.model ? agyFamilyOf(binding.model) : '';
    const family = /-flash$/.test(current) ? current : preset.model ?? DEFAULT_AGY_FLASH;
    const next: RoleBinding = { ...binding, model: `${family}-${preset.effort}` };
    delete next.effort;
    return next;
  }
  return { ...binding, ...(preset.model ? { model: preset.model } : {}), effort: preset.effort };
}

/** The bindings a profile would produce. Unbound roles and roles bound to a
 *  different agent come back unchanged (same object). */
export function applyTokenProfile(
  bindings: OrchestratorRoleBindings,
  profile: TokenProfile,
): OrchestratorRoleBindings {
  const presets = TOKEN_PROFILE_PRESETS[profile];
  const out: OrchestratorRoleBindings = {};
  for (const [role, binding] of Object.entries(bindings)) {
    const preset = presets[role];
    out[role] = preset ? applyPreset(binding, preset) : binding;
  }
  return out;
}

function sameModelEffort(a: RoleBinding, b: RoleBinding): boolean {
  const effortOf = (x: RoleBinding) => (x.agent === 'agy' && x.model ? agyEffortOf(x.model) : x.effort) ?? '';
  return (a.model ?? '') === (b.model ?? '') && effortOf(a) === effortOf(b);
}

/** Which profile the bindings currently match: the first profile that would
 *  change nothing AND acts on at least one role; otherwise 'custom'. */
export function matchTokenProfile(bindings: OrchestratorRoleBindings): TokenProfile | 'custom' {
  for (const profile of TOKEN_PROFILES) {
    const presets = TOKEN_PROFILE_PRESETS[profile];
    const next = applyTokenProfile(bindings, profile);
    const roles = Object.keys(bindings);
    const acts = roles.some((r) => presets[r] && bindings[r].agent === presets[r].agent);
    if (acts && roles.every((r) => sameModelEffort(bindings[r], next[r]))) return profile;
  }
  return 'custom';
}

/** Roles whose binding a profile would change (for the Apply preview). */
export function tokenProfileChanges(
  bindings: OrchestratorRoleBindings,
  profile: TokenProfile,
): Array<{ role: string; before: RoleBinding; after: RoleBinding }> {
  const next = applyTokenProfile(bindings, profile);
  return Object.keys(bindings)
    .filter((role) => !sameModelEffort(bindings[role], next[role]))
    .map((role) => ({ role, before: bindings[role], after: next[role] }));
}
