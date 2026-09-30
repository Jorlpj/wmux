import { SettingNote, SettingsSection } from '../../SettingsLayout';

export interface QuotaSectionProps {
  t?: (key: string, vars?: Record<string, string | number>) => string;
}

export function QuotaSection({ t }: QuotaSectionProps = {}) {
  const title = t && t('settings.tokenQuota') !== 'settings.tokenQuota'
    ? t('settings.tokenQuota')
    : 'Quota';

  return (
    <SettingsSection id="tokenquota" title={title} data-testid="token-quota-section">
      <SettingNote>Quota reporting is not implemented yet.</SettingNote>
    </SettingsSection>
  );
}
