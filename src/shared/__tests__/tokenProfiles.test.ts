import { describe, expect, it } from 'vitest';
import type { OrchestratorRoleBindings } from '../orchestratorRole';
import { applyTokenProfile, matchTokenProfile, tokenProfileChanges } from '../tokenProfiles';

// The operator's real setup: Planner claude, Builder+Tester agy (one pane), Reviewer codex.
const BOUND: OrchestratorRoleBindings = {
  Planner: { agent: 'claude', model: 'claude-opus-5-5', effort: 'high', skipPermissions: true },
  Builder: { agent: 'agy', model: 'gemini-3.8-flash-high', skipPermissions: true, args: '--foo' },
  Tester: { agent: 'agy', model: 'gemini-3.7-flash-high' },
  Reviewer: { agent: 'codex', model: 'gpt-6-sol', effort: 'high' },
};

describe('token profiles', () => {
  it('minimal writes model/effort per role and never touches permissions or args', () => {
    const next = applyTokenProfile(BOUND, 'minimal');
    expect(next.Planner).toEqual({ agent: 'claude', model: 'claude-sonnet-5-5', effort: 'medium', skipPermissions: true });
    expect(next.Builder).toEqual({ agent: 'agy', model: 'gemini-3.8-flash-low', skipPermissions: true, args: '--foo' });
    // Tester keeps its own Flash family, only the suffix changes.
    expect(next.Tester).toEqual({ agent: 'agy', model: 'gemini-3.7-flash-medium' });
    // codex keeps the operator's model.
    expect(next.Reviewer).toEqual({ agent: 'codex', model: 'gpt-6-sol', effort: 'low' });
  });

  it('agy never gets a separate effort field, and a non-Flash family moves to the default Flash', () => {
    const next = applyTokenProfile({ Builder: { agent: 'agy', model: 'gemini-3.1-pro-high', effort: 'high' } }, 'balanced');
    expect(next.Builder).toEqual({ agent: 'agy', model: 'gemini-3.8-flash-medium' });
  });

  it('leaves a role bound to another agent, an unknown role and an unbound role alone', () => {
    const b: OrchestratorRoleBindings = {
      Reviewer: { agent: 'claude', model: 'opus' },
      Custom: { agent: 'codex', effort: 'high' },
    };
    const next = applyTokenProfile(b, 'minimal');
    expect(next.Reviewer).toBe(b.Reviewer);
    expect(next.Custom).toBe(b.Custom);
    expect(Object.keys(next)).toEqual(['Reviewer', 'Custom']);
  });

  it('matchTokenProfile derives the profile from the bindings, else custom', () => {
    expect(matchTokenProfile(BOUND)).toBe('custom');
    expect(matchTokenProfile(applyTokenProfile(BOUND, 'minimal'))).toBe('minimal');
    expect(matchTokenProfile(applyTokenProfile(BOUND, 'balanced'))).toBe('balanced');
    // A hand edit after applying drops back to custom.
    const edited = { ...applyTokenProfile(BOUND, 'minimal'), Reviewer: { agent: 'codex', model: 'gpt-6-sol', effort: 'xhigh' } };
    expect(matchTokenProfile(edited)).toBe('custom');
    // Nothing the profile acts on → not a match.
    expect(matchTokenProfile({})).toBe('custom');
  });

  it('tokenProfileChanges lists only the roles that would change', () => {
    const once = applyTokenProfile(BOUND, 'minimal');
    expect(tokenProfileChanges(once, 'minimal')).toEqual([]);
    expect(tokenProfileChanges(BOUND, 'minimal').map((c) => c.role)).toEqual(['Planner', 'Builder', 'Tester', 'Reviewer']);
  });
});
