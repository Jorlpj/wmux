/**
 * Settings › Agents › Token usage. The repo's vitest config is node-env, so the
 * view is rendered with renderToStaticMarkup (same as the role-binding tests);
 * what Apply writes is covered by src/shared/__tests__/tokenProfiles.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TokenUsageView, type TokenUsageViewProps } from '../tabs/TokenUsageTab';
import { t as translate } from '../../../i18n';
import { applyTokenProfile } from '../../../../shared/tokenProfiles';
import type { OrchestratorRoleBindings } from '../../../../shared/orchestratorRole';

const t = translate as unknown as TokenUsageViewProps['t'];

const BOUND: OrchestratorRoleBindings = {
  Planner: { agent: 'claude', model: 'claude-opus-5-5', effort: 'high' },
  Builder: { agent: 'agy', model: 'gemini-3.8-flash-high', skipPermissions: true },
  Tester: { agent: 'agy', model: 'gemini-3.8-flash-high' },
  Reviewer: { agent: 'codex', model: 'gpt-6-sol', effort: 'high' },
};

function render(bindings: OrchestratorRoleBindings): string {
  return renderToStaticMarkup(
    createElement(TokenUsageView, {
      bindings,
      onApply: () => undefined,
      onOpenTab: () => undefined,
      deckBrainModel: 'claude-sonnet-5-5',
      deckBrainEffort: 'medium',
      t,
    }),
  );
}

describe('TokenUsageView', () => {
  it('with no bound role offers only the way to Roles & fan-out', () => {
    const html = render({});
    expect(html).toContain('Bind roles first');
    expect(html).not.toContain('token-profile-apply');
    expect(html).not.toContain('data-token-role=');
  });

  it('shows Custom and previews every change before Apply', () => {
    const html = render(BOUND);
    expect(html).toMatch(/data-testid="token-profile-current"[^>]*>Custom</);
    expect(html).toContain('data-testid="token-profile-apply"');
    expect(html).toContain('Planner: claude-opus-5-5 · high → claude-sonnet-5-5 · low · tools role');
    expect(html).toContain('Builder: gemini-3.8-flash-high · high → gemini-3.8-flash-low · low · tools role');
    expect(html).toContain('Reviewer: gpt-6-sol · high → gpt-6-sol · low · tools role');
    expect(html).toContain('>Full<');
    expect(html).toContain('>Coding<');
  });

  it('once applied, reads Minimal and has nothing to apply', () => {
    const html = render(applyTokenProfile(BOUND, 'minimal'));
    expect(html).toMatch(/data-testid="token-profile-current"[^>]*>Minimal</);
    expect(html).toContain('token-profile-nochanges');
    expect(html).not.toContain('token-profile-apply');
  });

  it('lists each role with its launch, tool surface size and the shared-pane note', () => {
    expect(render(BOUND)).toContain('wmux tools: CLI default');
    const html = render(applyTokenProfile(BOUND, 'minimal'));
    expect(html).toContain('6 wmux tools'); // Planner
    expect(html).toContain('5 wmux tools'); // Reviewer
    expect(html).toContain('0 wmux tools'); // Builder / Tester
    expect(render(applyTokenProfile(BOUND, 'full'))).toContain('all wmux tools');
    expect(html).toContain('agy --model gemini-3.8-flash-low --dangerously-skip-permissions');
    expect(html).toContain('Builder and Tester share one agy pane');
    // Permissions are shown, never offered as a profile lever.
    expect(html).not.toMatch(/Skip permissions/);
  });

  it('shows the Deck brain model and effort with a link to Orchestrator', () => {
    const html = render(BOUND);
    expect(html).toContain('claude-sonnet-5-5 · medium');
    expect(html).toContain('Open Orchestrator');
  });
});
