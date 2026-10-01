import type { SurfaceProviderId } from '../../../../../../shared/tokenUsage/surfaceTypes';
import Button from '../../../../ui/Button';
import Checkbox from '../../../../ui/Checkbox';
import Input from '../../../../ui/Input';
import SegmentedControl from '../../../../ui/SegmentedControl';

interface CustomControlsProps {
  provider: SurfaceProviderId;
  onProviderChange: (p: SurfaceProviderId) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onlyChanged: boolean;
  onOnlyChangedChange: (val: boolean) => void;
  onRefresh: () => void;
  loading: boolean;
}

export function CustomControls({
  provider,
  onProviderChange,
  searchQuery,
  onSearchChange,
  onlyChanged,
  onOnlyChangedChange,
  onRefresh,
  loading,
}: CustomControlsProps) {
  const providerOptions = [
    { value: 'claude' as const, label: 'Claude Code' },
    { value: 'codex' as const, label: 'Codex' },
    { value: 'agy' as const, label: 'Antigravity' },
  ];

  return (
    <div className="flex flex-col gap-3 my-3" data-testid="token-custom-controls">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <SegmentedControl
          value={provider}
          options={providerOptions}
          onValueChange={onProviderChange}
          ariaLabel="Surface provider"
          data-testid="token-custom-provider-tabs"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={onRefresh}
          disabled={loading}
          data-testid="token-custom-refresh"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <Input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search items by name or path..."
            data-testid="token-custom-search"
          />
        </div>
        <label className="flex items-center gap-2 text-[13px] text-[var(--text-main)] cursor-pointer select-none">
          <Checkbox
            checked={onlyChanged}
            onCheckedChange={onOnlyChangedChange}
            data-testid="token-custom-only-changed"
          />
          <span>Only changed</span>
        </label>
      </div>
    </div>
  );
}
