import { SettingNote, SettingsSection } from '../../SettingsLayout';

export interface CustomPanelProps {
  t?: (key: string, vars?: Record<string, string | number>) => string;
}

export function CustomPanel({ t }: CustomPanelProps = {}) {
  const title = t ? t('settings.tokenProfileCustom') || 'Custom' : 'Custom';

  return (
    <SettingsSection
      id="tokencustom"
      title={title}
      data-testid="token-custom-panel"
    >
      <SettingNote>
        Per-provider MCP/tool/skill/plugin/hook editing is not implemented yet.
      </SettingNote>
    </SettingsSection>
  );
}
