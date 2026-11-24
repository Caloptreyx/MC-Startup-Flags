import { faMemory, faServer, faShieldHalved } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import getAllEggs from '@/api/admin/nests/getAllEggs.ts';
import { httpErrorToHuman } from '@/api/axios.ts';
import Button from '@/elements/buttons/Button.tsx';
import TitleCard from '@/elements/data-display/TitleCard.tsx';
import Alert from '@/elements/feedback/Alert.tsx';
import Spinner from '@/elements/feedback/Spinner.tsx';
import MultiSelect from '@/elements/input/MultiSelect.tsx';
import NumberInput from '@/elements/input/NumberInput.tsx';
import Switch from '@/elements/input/Switch.tsx';
import TagsInput from '@/elements/input/TagsInput.tsx';
import Group from '@/elements/layout/Group.tsx';
import Stack from '@/elements/layout/Stack.tsx';
import { useAdminCan } from '@/plugins/usePermissions.ts';
import { useToast } from '@/providers/ToastProvider.tsx';
import { getSettings, PACKAGE, type Settings, updateSettings } from '../api.ts';
import { useExtTranslations } from '../translations.ts';

const settingsKey = [PACKAGE, 'settings'] as const;

export default function SettingsPage() {
  const { t } = useExtTranslations();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const canRead = useAdminCan('extensions.read');
  const canManage = useAdminCan('extensions.manage');

  const query = useQuery({ queryKey: settingsKey, queryFn: getSettings, enabled: canRead });
  const eggs = useQuery({ queryKey: [PACKAGE, 'eggs'], queryFn: getAllEggs, enabled: canRead });

  const [form, setForm] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (query.data) setForm(query.data);
  }, [query.data]);

  if (query.isLoading) {
    return (
      <Group justify='center' py='lg'>
        <Spinner />
      </Group>
    );
  }
  if (query.error || !form) {
    return <Alert color='red'>{query.error ? httpErrorToHuman(query.error) : null}</Alert>;
  }

  const update = (patch: Partial<Settings>) => setForm({ ...form, ...patch });

  const save = async () => {
    setSaving(true);
    try {
      const saved = await updateSettings(form);
      setForm(saved);
      queryClient.setQueryData(settingsKey, saved);
      queryClient.invalidateQueries({ queryKey: [PACKAGE] });
      addToast(t('settings.saved', {}), 'success');
    } catch (error) {
      addToast(httpErrorToHuman(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack>
      <TitleCard title={t('settings.access', {})} icon={<FontAwesomeIcon icon={faServer} />}>
        <MultiSelect
          label={t('settings.eggs', {})}
          description={t('settings.eggsDescription', {})}
          searchable
          data={(eggs.data ?? []).map(({ nest, eggs: nestEggs }) => ({
            group: nest.name,
            items: nestEggs.map((egg) => ({ value: egg.uuid, label: egg.name })),
          }))}
          value={form.eggs}
          onChange={(value) => update({ eggs: value })}
          disabled={!canManage}
        />
      </TitleCard>

      <TitleCard title={t('settings.memoryAndLimits', {})} icon={<FontAwesomeIcon icon={faMemory} />}>
        <Stack>
          <Switch
            label={t('settings.allowCustomMemory', {})}
            description={t('settings.allowCustomMemoryDescription', { expr: '{{SERVER_MEMORY}}' })}
            checked={form.allow_custom_memory}
            onChange={(event) => update({ allow_custom_memory: event.currentTarget.checked })}
            disabled={!canManage}
          />
          <NumberInput
            label={t('settings.memoryOverheadMb', {})}
            description={t('settings.memoryOverheadMbDescription', {})}
            min={0}
            max={16384}
            allowDecimal={false}
            value={form.memory_overhead_mb}
            onChange={(value) => typeof value === 'number' && update({ memory_overhead_mb: value })}
            disabled={!canManage}
          />
          <NumberInput
            label={t('settings.maxRamPercentage', {})}
            description={t('settings.maxRamPercentageDescription', {})}
            min={50}
            max={100}
            step={0.5}
            decimalScale={1}
            value={form.max_ram_percentage}
            onChange={(value) => typeof value === 'number' && update({ max_ram_percentage: value })}
            disabled={!canManage}
          />
          <NumberInput
            label={t('settings.maxPresetsPerUser', {})}
            min={1}
            max={200}
            allowDecimal={false}
            value={form.max_presets_per_user}
            onChange={(value) => typeof value === 'number' && update({ max_presets_per_user: value })}
            disabled={!canManage}
          />
        </Stack>
      </TitleCard>

      <TitleCard title={t('settings.security', {})} icon={<FontAwesomeIcon icon={faShieldHalved} />}>
        <Stack>
          <Switch
            label={t('settings.allowCustomFlags', {})}
            description={t('settings.allowCustomFlagsDescription', {})}
            checked={form.allow_custom_flags}
            onChange={(event) => update({ allow_custom_flags: event.currentTarget.checked })}
            disabled={!canManage}
          />
          <TagsInput
            label={t('settings.extraBlockedFlags', {})}
            description={t('settings.extraBlockedFlagsDescription', {})}
            placeholder={t('settings.extraBlockedFlagsPlaceholder', {})}
            value={form.extra_blocked_flags}
            onChange={(value) => canManage && update({ extra_blocked_flags: value })}
            allowReordering={false}
          />
        </Stack>
      </TitleCard>

      {canManage && (
        <Group justify='flex-end'>
          <Button loading={saving} onClick={save}>
            {t('settings.save', {})}
          </Button>
        </Group>
      )}
    </Stack>
  );
}
