import { useStore } from '../../../../../stores';
import Field from '../../../../ui/Field';
import Switch from '../../../../ui/Switch';

export interface RefreshOnTurnEndToggleProps {
  className?: string;
}

export default function RefreshOnTurnEndToggle({ className }: RefreshOnTurnEndToggleProps = {}) {
  const enabled = useStore((s) => s.refreshQuotaOnTurnEnd);
  const setEnabled = useStore((s) => s.setRefreshQuotaOnTurnEnd);

  return (
    <div className={className} data-testid="refresh-quota-on-turn-end-row">
      <Field
        label="Also refresh quota at the end of each agent turn"
        description="Off by default; each refresh is a request to the provider"
        layout="inline"
      >
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          aria-label="Also refresh quota at the end of each agent turn"
          data-testid="refresh-quota-on-turn-end-toggle"
        />
      </Field>
    </div>
  );
}
