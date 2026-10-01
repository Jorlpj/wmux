import { describe, expect, it } from 'vitest';
import { applyRolePreset, rolePresetApplied } from '../rolePresets';
import { normalizeRoleBinding } from '../orchestratorRole';

describe('role presets', () => {
  it('gives Builder and Tester different settings on the same agy', () => {
    const builder = applyRolePreset('Builder', { agent: 'agy' });
    const tester = applyRolePreset('Tester', { agent: 'agy' });
    expect(builder).toEqual({ agent: 'agy', model: 'gemini-3.8-flash-high', skipPermissions: true });
    expect(tester).toEqual({ agent: 'agy', model: 'gemini-3.8-flash-medium', skipPermissions: true });
  });

  it('binds an unbound role to agy', () => {
    expect(applyRolePreset('Tester', undefined).agent).toBe('agy');
  });

  it('keeps a chosen Flash family, and moves a Pro family (no -medium) to Flash', () => {
    expect(applyRolePreset('Tester', { agent: 'agy', model: 'gemini-3.7-flash-low' }).model).toBe('gemini-3.7-flash-medium');
    expect(applyRolePreset('Tester', { agent: 'agy', model: 'gemini-3.1-pro-high' }).model).toBe('gemini-3.8-flash-medium');
  });

  it('keeps extra args and writes effort through the agent grammar', () => {
    const claude = applyRolePreset('Builder', { agent: 'claude', args: '--verbose' });
    expect(claude).toMatchObject({ agent: 'claude', model: 'claude-sonnet-5-5', effort: 'high', args: '--verbose' });
    expect(applyRolePreset('Tester', { agent: 'codex', model: 'gpt-5.5' })).toMatchObject({ model: 'gpt-5.5', effort: 'medium' });
  });

  it('never sets skip permissions for an agent without a verified flag', () => {
    expect(applyRolePreset('Builder', { agent: 'gemini' }).skipPermissions).toBeUndefined();
  });

  it('survives normalization and reports itself as applied', () => {
    const b = applyRolePreset('Builder', undefined);
    expect(normalizeRoleBinding(b)).toEqual(b);
    expect(rolePresetApplied('Builder', { Builder: b })).toBe(true);
    expect(rolePresetApplied('Tester', { Tester: b })).toBe(false);
    expect(rolePresetApplied('Tester', {})).toBe(false);
  });
});
