// @vitest-environment jsdom
//
// The role-binding model combobox: opening shows the WHOLE discovered list
// (the native datalist it replaced showed only the current value), typing
// filters, picking commits, and free text is committed per keystroke.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ModelCombobox } from '../ModelCombobox';
import { effortChoicesFor } from '../SettingsPanel';
import type { CatalogModel } from '../../../../shared/modelCatalog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MODELS: CatalogModel[] = [
  { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
  { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
];

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(value: string, onChange = vi.fn()) {
  act(() => {
    root.render(createElement(ModelCombobox, { value, onChange, models: MODELS, 'aria-label': 'Builder model' }));
  });
  return { input: container.querySelector('input') as HTMLInputElement, onChange };
}

const options = () => Array.from(container.querySelectorAll('[role="option"]')) as HTMLButtonElement[];

function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('ModelCombobox', () => {
  it('opens the full list even when a value is already chosen', () => {
    const { input } = mount('gemini-3.8-flash-low');
    act(() => input.focus());
    expect(options()).toHaveLength(3);
    expect(options().find((o) => o.getAttribute('aria-selected') === 'true')?.textContent).toContain(
      'gemini-3.8-flash-low',
    );
  });

  it('filters by id or label while typing and commits each keystroke', () => {
    const { input, onChange } = mount('');
    act(() => input.focus());
    type(input, 'sonnet');
    expect(options()).toHaveLength(1);
    expect(onChange).toHaveBeenLastCalledWith('sonnet');
  });

  it('commits the picked id', () => {
    const { input, onChange } = mount('');
    act(() => input.focus());
    act(() => {
      options()[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith('gemini-3.8-flash-high');
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });
});

describe('effortChoicesFor', () => {
  it('lists agy effort suffixes of the chosen family only', () => {
    expect(effortChoicesFor({ agent: 'agy', model: 'gemini-3.8-flash-low' }, MODELS)).toEqual(['high', 'low']);
    expect(effortChoicesFor({ agent: 'agy', model: 'claude-sonnet-4-6' }, MODELS)).toEqual([]);
  });

  it('uses the codex model\'s reported levels', () => {
    const codex: CatalogModel[] = [{ id: 'gpt-5.5', label: 'GPT-5.5', efforts: ['low', 'medium'] }];
    expect(effortChoicesFor({ agent: 'codex', model: 'gpt-5.5' }, codex)).toEqual(['low', 'medium']);
  });

  it('offers claude its fixed levels and nothing for other agents', () => {
    expect(effortChoicesFor({ agent: 'claude' }, [])).toContain('max');
    expect(effortChoicesFor({ agent: 'opencode' }, [])).toEqual([]);
  });
});
