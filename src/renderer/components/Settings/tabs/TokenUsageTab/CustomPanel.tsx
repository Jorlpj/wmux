import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProviderInventory, SurfaceProviderId } from '../../../../../shared/tokenUsage/surfaceTypes';
import { SettingNote, SettingsSection } from '../../SettingsLayout';
import Badge from '../../../ui/Badge';
import { CustomBuiltinsGroup } from './custom/CustomBuiltinsGroup';
import { CustomControls } from './custom/CustomControls';
import { CustomHooksGroup } from './custom/CustomHooksGroup';
import { CustomMcpGroup } from './custom/CustomMcpGroup';
import { CustomPluginsGroup } from './custom/CustomPluginsGroup';
import { CustomSkillsGroup } from './custom/CustomSkillsGroup';
import { CustomWarnings } from './custom/CustomWarnings';

export interface CustomPanelProps {
  t?: (key: string, vars?: Record<string, string | number>) => string;
}

export function CustomPanel({ t }: CustomPanelProps = {}) {
  const title = t ? t('settings.tokenProfileCustom') || 'Custom' : 'Custom';
  const [provider, setProvider] = useState<SurfaceProviderId>('claude');
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [inventory, setInventory] = useState<ProviderInventory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInventory = useCallback(async (p: SurfaceProviderId) => {
    if (typeof window === 'undefined' || !window.electronAPI?.tokenUsage?.readInventory) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await window.electronAPI.tokenUsage.readInventory({ provider: p });
      setInventory(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchInventory(provider);
  }, [provider, fetchInventory]);

  const filteredItems = useMemo(() => {
    if (!inventory) return [];
    return inventory.items.filter((item) => {
      if (onlyChanged && item.enabled !== false) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = item.name.toLowerCase().includes(q);
        const matchesParent = item.parent ? item.parent.toLowerCase().includes(q) : false;
        const matchesOrigin = item.originPath ? item.originPath.toLowerCase().includes(q) : false;
        if (!matchesName && !matchesParent && !matchesOrigin) return false;
      }
      return true;
    });
  }, [inventory, onlyChanged, searchQuery]);

  const mcpServers = useMemo(
    () => filteredItems.filter((i) => i.kind === 'mcp-server'),
    [filteredItems],
  );
  const allMcpServers = useMemo(
    () => (inventory ? inventory.items.filter((i) => i.kind === 'mcp-server') : []),
    [inventory],
  );
  const mcpTools = useMemo(
    () => filteredItems.filter((i) => i.kind === 'mcp-tool'),
    [filteredItems],
  );
  const skills = useMemo(
    () => filteredItems.filter((i) => i.kind === 'skill'),
    [filteredItems],
  );
  const plugins = useMemo(
    () => filteredItems.filter((i) => i.kind === 'plugin'),
    [filteredItems],
  );
  const hooks = useMemo(
    () => filteredItems.filter((i) => i.kind === 'hook'),
    [filteredItems],
  );
  const builtins = useMemo(
    () => filteredItems.filter((i) => i.kind === 'builtin-tool' || i.kind === 'context-setting'),
    [filteredItems],
  );

  return (
    <SettingsSection
      id="tokencustom"
      title={title}
      data-testid="token-custom-panel"
    >
      <SettingNote>
        Per-provider MCP/tool/skill/plugin/hook editing is not implemented yet.
      </SettingNote>

      <CustomControls
        provider={provider}
        onProviderChange={setProvider}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onlyChanged={onlyChanged}
        onOnlyChangedChange={setOnlyChanged}
        onRefresh={() => void fetchInventory(provider)}
        loading={loading}
      />

      {inventory && (
        <div className="flex items-center gap-2 text-[11px] text-[var(--text-sub)] my-2 flex-wrap">
          <span>CLI version:</span>
          <span className="ui-code text-[var(--text-main)]">
            {inventory.cliVersion ?? 'Not detected'}
          </span>
          {inventory.cliVersion && (
            <Badge tone={inventory.versionSupported ? 'success' : 'warning'}>
              {inventory.versionSupported ? 'Supported' : 'Unsupported (read-only)'}
            </Badge>
          )}
        </div>
      )}

      <SettingNote>Changes take effect on the next CLI session.</SettingNote>

      {inventory && <CustomWarnings warnings={inventory.warnings} />}

      {loading && !inventory && (
        <div className="text-[12px] text-[var(--text-sub)] py-4 text-center">
          Loading surface inventory...
        </div>
      )}

      {error && (
        <div className="text-[12px] text-[var(--danger)] py-3">
          Failed to load inventory: {error}
        </div>
      )}

      {inventory && filteredItems.length === 0 && (
        <div className="text-[12px] text-[var(--text-sub)] py-4 text-center">
          No surface items match the current filter.
        </div>
      )}

      {inventory && (
        <>
          <CustomMcpGroup servers={mcpServers} tools={mcpTools} allServers={allMcpServers} />
          <CustomSkillsGroup skills={skills} />
          <CustomPluginsGroup plugins={plugins} />
          <CustomHooksGroup hooks={hooks} />
          <CustomBuiltinsGroup items={builtins} />
        </>
      )}
    </SettingsSection>
  );
}
