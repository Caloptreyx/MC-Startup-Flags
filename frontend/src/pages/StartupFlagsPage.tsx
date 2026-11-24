import {
  faBookmark,
  faCheck,
  faCode,
  faCopy,
  faFileExport,
  faFileImport,
  faGears,
  faMemory,
  faPencil,
  faPlus,
  faRotateLeft,
  faRotateRight,
  faScaleBalanced,
  faSliders,
  faTerminal,
  faTrash,
  faTriangleExclamation,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Progress as MantineProgress, SegmentedControl, Slider } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { httpErrorToHuman } from '@/api/axios.ts';
import ActionIcon from '@/elements/buttons/ActionIcon.tsx';
import Button from '@/elements/buttons/Button.tsx';
import ServerContentContainer from '@/elements/containers/ServerContentContainer.tsx';
import Badge from '@/elements/data-display/Badge.tsx';
import Card from '@/elements/data-display/Card.tsx';
import TitleCard from '@/elements/data-display/TitleCard.tsx';
import Alert from '@/elements/feedback/Alert.tsx';
import EmptyState from '@/elements/feedback/EmptyState.tsx';
import Spinner from '@/elements/feedback/Spinner.tsx';
import NumberInput from '@/elements/input/NumberInput.tsx';
import Select from '@/elements/input/Select.tsx';
import Switch from '@/elements/input/Switch.tsx';
import TextInput from '@/elements/input/TextInput.tsx';
import Group from '@/elements/layout/Group.tsx';
import Stack from '@/elements/layout/Stack.tsx';
import ConfirmationModal from '@/elements/modals/ConfirmationModal.tsx';
import Tooltip from '@/elements/overlays/Tooltip.tsx';
import Code from '@/elements/typography/Code.tsx';
import Text from '@/elements/typography/Text.tsx';
import { handleRawCopyToClipboard } from '@/lib/clipboard/copy.ts';
import { useServerCan } from '@/plugins/usePermissions.ts';
import { SocketRequest } from '@/plugins/websocket/useWebsocketEvent.ts';
import { useToast } from '@/providers/ToastProvider.tsx';
import { useServerStore } from '@/stores/server.ts';
import {
  applyServerStartupFlags,
  createSavedPreset,
  deleteSavedPreset,
  getServerStartupFlags,
  listSavedPresets,
  PACKAGE,
  resetServerStartupFlags,
  type SavedPreset,
  type ServerStartupFlagsState,
  updateSavedPreset,
} from '../api.ts';
import ExportModal from '../components/ExportModal.tsx';
import ImportModal from '../components/ImportModal.tsx';
import PresetSaveModal from '../components/PresetSaveModal.tsx';
import {
  AIKAR_HIGH_MEMORY_THRESHOLD_MB,
  type BuiltInPreset,
  buildStartupCommand,
  cloneConfig,
  effectiveHeapMb,
  type FlagConfig,
  type FlagToggles,
  formatMemoryLabel,
  type GcKind,
  MAX_COMMAND_LEN,
  MAX_CUSTOM_FLAGS,
  maxCustomXmxMb,
  type MemoryMode,
  summarizeActiveConfig,
  validateConfig,
  validateCustomFlag,
  type WorkloadTag,
} from '../lib/flags.ts';
import { useExtTranslations } from '../translations.ts';

const serverKey = (uuid: string) => [PACKAGE, 'server', uuid] as const;
const presetsKey = [PACKAGE, 'presets'] as const;

const GC_OPTIONS: Array<{
  value: GcKind;
  labelKey:
    | 'builder.gcDefault'
    | 'builder.gcAikar'
    | 'builder.gcG1'
    | 'builder.gcZgc'
    | 'builder.gcShenandoah'
    | 'builder.gcParallel';
  descKey:
    | 'builder.gcDefaultDesc'
    | 'builder.gcAikarDesc'
    | 'builder.gcG1Desc'
    | 'builder.gcZgcDesc'
    | 'builder.gcShenandoahDesc'
    | 'builder.gcParallelDesc';
}> = [
  { value: 'default', labelKey: 'builder.gcDefault', descKey: 'builder.gcDefaultDesc' },
  { value: 'aikar', labelKey: 'builder.gcAikar', descKey: 'builder.gcAikarDesc' },
  { value: 'g1gc', labelKey: 'builder.gcG1', descKey: 'builder.gcG1Desc' },
  { value: 'zgc', labelKey: 'builder.gcZgc', descKey: 'builder.gcZgcDesc' },
  { value: 'shenandoah', labelKey: 'builder.gcShenandoah', descKey: 'builder.gcShenandoahDesc' },
  { value: 'parallel', labelKey: 'builder.gcParallel', descKey: 'builder.gcParallelDesc' },
];

type BooleanToggleKey = {
  [K in keyof FlagToggles]: FlagToggles[K] extends boolean ? K : never;
}[keyof FlagToggles];

const TOGGLE_ITEMS: Array<{ key: BooleanToggleKey; label: string; flag: string }> = [
  { key: 'always_pre_touch', label: 'Always Pre-Touch Memory', flag: '-XX:+AlwaysPreTouch' },
  { key: 'disable_explicit_gc', label: 'Disable Explicit GC', flag: '-XX:+DisableExplicitGC' },
  { key: 'parallel_ref_proc', label: 'Parallel Reference Processing', flag: '-XX:+ParallelRefProcEnabled' },
  { key: 'perf_disable_shared_mem', label: 'Disable Shared Perf Data', flag: '-XX:+PerfDisableSharedMem' },
  { key: 'use_string_deduplication', label: 'G1 String Deduplication', flag: '-XX:+UseStringDeduplication' },
  { key: 'unlock_experimental', label: 'Unlock Experimental VM Options', flag: '-XX:+UnlockExperimentalVMOptions' },
  { key: 'user_home_container', label: 'Container Home Directory', flag: '-Duser.home=/home/container' },
  { key: 'file_encoding_utf8', label: 'Force UTF-8 Encoding', flag: '-Dfile.encoding=UTF-8' },
  { key: 'terminal_jline_false', label: 'Disable JLine Terminal', flag: '-Dterminal.jline=false' },
  { key: 'log4j_no_lookups', label: 'Log4j2 No-Lookups Mitigation', flag: '-Dlog4j2.formatMsgNoLookups=true' },
  { key: 'simd_vector_module', label: 'Vector API SIMD Module', flag: '--add-modules=jdk.incubator.vector' },
];

export default function StartupFlagsPage() {
  const { t } = useExtTranslations();
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const { server, power, socketInstance, updateServer } = useServerStore(
    useShallow((state) => ({
      server: state.server,
      power: state.state,
      socketInstance: state.socketInstance,
      updateServer: state.updateServer,
    })),
  );
  const canRestart = useServerCan('control.restart');

  const stateQuery = useQuery({
    queryKey: serverKey(server.uuid),
    queryFn: () => getServerStartupFlags(server.uuid),
    enabled: Boolean(server.uuid),
  });

  const presetsQuery = useQuery({
    queryKey: presetsKey,
    queryFn: listSavedPresets,
    enabled: Boolean(server.uuid),
  });

  const [draft, setDraft] = useState<FlagConfig | null>(null);
  const [workloadFilter, setWorkloadFilter] = useState<'all' | WorkloadTag>('all');
  const [customFlagInput, setCustomFlagInput] = useState('');
  const [customFlagError, setCustomFlagError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [appliedThisSession, setAppliedThisSession] = useState(false);

  const [resetOpen, setResetOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportTarget, setExportTarget] = useState<{ config: FlagConfig; name?: string; description?: string } | null>(
    null,
  );
  const [presetModal, setPresetModal] = useState<{
    mode: 'create' | 'edit';
    presetId?: string;
    name: string;
    description: string;
    config: FlagConfig;
  } | null>(null);
  const [savingPreset, setSavingPreset] = useState(false);
  const [deletingPreset, setDeletingPreset] = useState<SavedPreset | null>(null);

  const data = stateQuery.data;

  useEffect(() => {
    if (data) {
      setDraft(cloneConfig(data.config));
    }
  }, [data?.current_startup, server.uuid]);

  const previewCommand = useMemo(() => {
    if (!data || !draft) return '';
    return buildStartupCommand(draft, data.parsed, data.java_version, data.server_memory_mb);
  }, [data, draft]);

  const validationErrors = useMemo(() => {
    if (!data || !draft) return [];
    return validateConfig(draft, data.settings, data.server_memory_mb, previewCommand);
  }, [data, draft, previewCommand]);

  const hasUnsavedChanges = useMemo(() => {
    if (!data || !draft) return false;
    return previewCommand.trim() !== data.current_startup.trim();
  }, [data, draft, previewCommand]);

  const filteredPresets = useMemo(() => {
    if (!data) return [];
    if (workloadFilter === 'all') return data.presets;
    return data.presets.filter((preset) => preset.workloads.includes(workloadFilter));
  }, [data, workloadFilter]);

  const syncServerState = (updated: ServerStartupFlagsState) => {
    queryClient.setQueryData(serverKey(server.uuid), updated);
    setDraft(cloneConfig(updated.config));
    updateServer({ startup: updated.current_startup });
  };

  const handleApply = async (configToApply: FlagConfig) => {
    if (!data) return;
    setApplying(true);
    try {
      const updated = await applyServerStartupFlags(server.uuid, configToApply);
      syncServerState(updated);
      setAppliedThisSession(true);
      addToast(t('toasts.applied', {}), 'success');
    } catch (error) {
      addToast(httpErrorToHuman(error), 'error');
    } finally {
      setApplying(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      const updated = await resetServerStartupFlags(server.uuid);
      syncServerState(updated);
      setAppliedThisSession(true);
      setResetOpen(false);
      addToast(t('toasts.reset', {}), 'success');
    } catch (error) {
      addToast(httpErrorToHuman(error), 'error');
    } finally {
      setResetting(false);
    }
  };

  const handleSelectBuiltInPreset = (preset: BuiltInPreset) => {
    if (!draft) return;
    setDraft({
      ...cloneConfig(preset.config),
      memory_mode: draft.memory_mode,
      xms_mb: draft.xms_mb,
      xmx_mb: draft.xmx_mb,
      max_ram_percentage: draft.max_ram_percentage,
      template_match_xms: preset.recommends_match_xms,
    });
  };

  const handleSelectGc = (gc: GcKind) => {
    if (!draft) return;
    const nextToggles = { ...draft.toggles };
    if (gc === 'aikar') {
      nextToggles.always_pre_touch = true;
      nextToggles.disable_explicit_gc = true;
      nextToggles.parallel_ref_proc = true;
      nextToggles.perf_disable_shared_mem = true;
      nextToggles.unlock_experimental = true;
      nextToggles.max_gc_pause_millis = nextToggles.max_gc_pause_millis ?? 200;
    } else if (gc === 'zgc') {
      nextToggles.always_pre_touch = true;
      nextToggles.disable_explicit_gc = true;
      nextToggles.perf_disable_shared_mem = true;
    } else if (gc === 'shenandoah') {
      nextToggles.always_pre_touch = true;
      nextToggles.disable_explicit_gc = true;
      nextToggles.parallel_ref_proc = true;
      nextToggles.unlock_experimental = true;
    }
    const nextPresetId =
      gc === 'aikar'
        ? nextToggles.simd_vector_module
          ? 'simd_aikars'
          : 'aikars'
        : gc === 'zgc'
          ? 'zgc'
          : gc === 'shenandoah'
            ? 'shenandoah'
            : gc === 'default'
              ? 'vanilla'
              : null;
    setDraft({
      ...draft,
      preset_id: nextPresetId,
      gc,
      toggles: nextToggles,
    });
  };

  const handleAddCustomFlags = () => {
    if (!draft || !data) return;
    const tokens = customFlagInput
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (tokens.length === 0) return;

    const next = [...draft.custom_flags];
    for (const token of tokens) {
      const err = validateCustomFlag(token, data.settings.extra_blocked_flags);
      if (err) {
        setCustomFlagError(err);
        return;
      }
      if (!next.includes(token)) {
        if (next.length >= MAX_CUSTOM_FLAGS) {
          setCustomFlagError(`At most ${MAX_CUSTOM_FLAGS} custom JVM flags are allowed.`);
          return;
        }
        next.push(token);
      }
    }

    setCustomFlagError(null);
    setCustomFlagInput('');
    setDraft({ ...draft, preset_id: null, custom_flags: next });
  };

  const handleSavePresetSubmit = async (name: string, description: string) => {
    if (!presetModal) return;
    setSavingPreset(true);
    try {
      if (presetModal.mode === 'create') {
        await createSavedPreset({ name, description, config: presetModal.config });
        addToast(t('toasts.presetCreated', { name }), 'success');
      } else if (presetModal.presetId) {
        await updateSavedPreset(presetModal.presetId, { name, description, config: presetModal.config });
        addToast(t('toasts.presetUpdated', { name }), 'success');
      }
      await queryClient.invalidateQueries({ queryKey: presetsKey });
      setPresetModal(null);
    } catch (error) {
      addToast(httpErrorToHuman(error), 'error');
    } finally {
      setSavingPreset(false);
    }
  };

  const handleDeletePreset = async () => {
    if (!deletingPreset) return;
    try {
      await deleteSavedPreset(deletingPreset.id);
      addToast(t('toasts.presetDeleted', { name: deletingPreset.name }), 'success');
      setDeletingPreset(null);
      await queryClient.invalidateQueries({ queryKey: presetsKey });
    } catch (error) {
      addToast(httpErrorToHuman(error), 'error');
    }
  };

  if (stateQuery.isLoading) {
    return (
      <ServerContentContainer title={t('title', {})} subtitle={t('subtitle', {})}>
        <Spinner.Centered />
      </ServerContentContainer>
    );
  }

  if (stateQuery.error || !data || !draft) {
    return (
      <ServerContentContainer title={t('title', {})} subtitle={t('subtitle', {})}>
        <Alert color='red'>{stateQuery.error ? httpErrorToHuman(stateQuery.error) : null}</Alert>
      </ServerContentContainer>
    );
  }

  if (!data.eligible) {
    return (
      <ServerContentContainer title={t('title', {})} subtitle={t('subtitle', {})}>
        <EmptyState
          icon={faScaleBalanced}
          title={t('unsupported.title', {})}
          description={t('unsupported.description', {})}
        />
      </ServerContentContainer>
    );
  }

  const canUpdate = data.permissions.can_update;
  const canManagePresets = data.permissions.can_manage_presets;
  const isRunning = power === 'running' || power === 'starting';
  const safeCapMb = maxCustomXmxMb(data.server_memory_mb, data.settings.memory_overhead_mb);
  const currentEffectiveHeap = effectiveHeapMb(draft, data.server_memory_mb);
  const isAikarHighMem = currentEffectiveHeap >= AIKAR_HIGH_MEMORY_THRESHOLD_MB;
  const savedPresets = presetsQuery.data?.presets ?? [];
  const maxPresets = presetsQuery.data?.max_presets_per_user ?? data.settings.max_presets_per_user;

  const heapPercentOfContainer =
    data.server_memory_mb > 0 ? Math.min(100, (draft.xmx_mb / data.server_memory_mb) * 100) : 0;
  const overheadPercentOfContainer =
    data.server_memory_mb > 0
      ? Math.min(100 - heapPercentOfContainer, (data.settings.memory_overhead_mb / data.server_memory_mb) * 100)
      : 0;
  const exceedsSafeCap = safeCapMb !== null && draft.xmx_mb > safeCapMb;

  return (
    <ServerContentContainer
      title={t('title', {})}
      subtitle={t('subtitle', {})}
      contentRight={
        <Group gap='xs'>
          <Button
            variant='default'
            size='sm'
            leftSection={<FontAwesomeIcon icon={faFileImport} />}
            onClick={() => setImportOpen(true)}
          >
            {t('actions.import', {})}
          </Button>
          {canManagePresets ? (
            <Button
              variant='default'
              size='sm'
              leftSection={<FontAwesomeIcon icon={faFileExport} />}
              onClick={() => setExportTarget({ config: draft })}
            >
              {t('actions.export', {})}
            </Button>
          ) : null}
          {canUpdate && data.egg_default_startup ? (
            <Button
              variant='light'
              color='gray'
              size='sm'
              leftSection={<FontAwesomeIcon icon={faRotateLeft} />}
              disabled={data.is_egg_default}
              onClick={() => setResetOpen(true)}
            >
              {t('actions.resetDefault', {})}
            </Button>
          ) : null}
        </Group>
      }
    >
      <Stack gap='md' mt='xs'>
        <Group gap='xs' wrap='wrap'>
          <Badge variant='light' color={data.java_version ? 'blue' : 'gray'}>
            {data.java_version
              ? t('builder.detectedRuntime', { version: data.java_version })
              : t('builder.unknownRuntime', {})}
          </Badge>
          <Badge variant='light' color='teal'>
            {data.server_memory_mb > 0
              ? t('builder.serverMemory', { memory: formatMemoryLabel(data.server_memory_mb) })
              : t('builder.serverMemoryUnlimited', {})}
          </Badge>
          <Badge variant='outline' color='gray'>
            {summarizeActiveConfig(draft, data.server_memory_mb)}
          </Badge>
          <Badge variant='dot' color={hasUnsavedChanges ? 'yellow' : 'green'}>
            {hasUnsavedChanges ? t('builder.unsavedChanges', {}) : t('builder.upToDate', {})}
          </Badge>
        </Group>

        {isRunning ? (
          <Alert
            color={appliedThisSession ? 'orange' : 'yellow'}
            icon={<FontAwesomeIcon icon={faTriangleExclamation} />}
          >
            <Group justify='space-between' wrap='wrap' gap='sm'>
              <Text size='sm'>
                {appliedThisSession ? t('restartBanner.applied', {}) : t('restartBanner.running', {})}
              </Text>
              {canRestart && socketInstance ? (
                <Button
                  size='compact-sm'
                  variant='light'
                  color='yellow'
                  leftSection={<FontAwesomeIcon icon={faRotateRight} />}
                  onClick={() => socketInstance.send(SocketRequest.SET_STATE, 'restart')}
                >
                  {t('restartBanner.restartNow', {})}
                </Button>
              ) : null}
            </Group>
          </Alert>
        ) : null}

        {!data.parsed.parseable ? (
          <Alert color='blue' icon={<FontAwesomeIcon icon={faTriangleExclamation} />}>
            <Text size='sm'>{t('builder.unparseableNotice', {})}</Text>
          </Alert>
        ) : null}

        {!canUpdate ? (
          <Alert color='gray'>
            <Text size='sm'>{t('builder.noUpdatePermission', {})}</Text>
          </Alert>
        ) : null}

        {/* Curated Presets */}
        <TitleCard
          title={t('presets.title', {})}
          icon={<FontAwesomeIcon icon={faScaleBalanced} />}
          rightSection={
            <SegmentedControl
              size='xs'
              className='ml-auto'
              value={workloadFilter}
              onChange={(val) => setWorkloadFilter(val as 'all' | WorkloadTag)}
              data={[
                { label: t('presets.allWorkloads', {}), value: 'all' },
                { label: t('presets.workloadPaper', {}), value: 'paper' },
                { label: t('presets.workloadModded', {}), value: 'modded' },
                { label: t('presets.workloadVanilla', {}), value: 'vanilla' },
                { label: t('presets.workloadProxy', {}), value: 'proxy' },
              ]}
            />
          }
        >
          <Text size='xs' c='dimmed' mb='sm'>
            {t('presets.subtitle', {})}
          </Text>
          <div className='grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3'>
            {filteredPresets.map((preset) => {
              const selected = draft.preset_id === preset.id;
              const javaTooOld =
                preset.min_java !== null && data.java_version !== null && data.java_version < preset.min_java;
              return (
                <Card
                  key={preset.id}
                  hoverable
                  withBorder
                  radius='md'
                  p='sm'
                  className={selected ? 'border-(--mantine-color-blue-5)! bg-(--mantine-color-blue-light)!' : undefined}
                  onClick={() => handleSelectBuiltInPreset(preset)}
                >
                  <Stack gap={6} h='100%' justify='space-between'>
                    <Stack gap={4}>
                      <Group justify='space-between' wrap='nowrap' gap='xs'>
                        <Text fw={600} size='sm'>
                          {preset.name}
                        </Text>
                        {selected ? (
                          <Badge size='xs' color='blue' variant='filled'>
                            {t('presets.active', {})}
                          </Badge>
                        ) : null}
                      </Group>
                      <Text size='xs' c='dimmed'>
                        {preset.description}
                      </Text>
                    </Stack>

                    <Group gap={6} wrap='wrap' mt={4}>
                      {preset.workloads.map((w) => (
                        <Badge key={w} size='xs' variant='light' color='gray'>
                          {w}
                        </Badge>
                      ))}
                      {preset.min_java !== null ? (
                        <Badge size='xs' variant='light' color={javaTooOld ? 'red' : 'cyan'}>
                          {javaTooOld && data.java_version !== null
                            ? t('presets.javaWarning', { required: preset.min_java, detected: data.java_version })
                            : preset.max_recommended_java
                              ? t('presets.javaRangeNote', {
                                  min: preset.min_java,
                                  max: preset.max_recommended_java,
                                })
                              : t('presets.minJava', { version: preset.min_java })}
                        </Badge>
                      ) : null}
                      {preset.recommends_match_xms ? (
                        <Badge size='xs' variant='outline' color='indigo'>
                          {t('presets.recommendsMatchXms', {})}
                        </Badge>
                      ) : null}
                    </Group>
                  </Stack>
                </Card>
              );
            })}
          </div>
        </TitleCard>

        {/* Saved Custom Presets */}
        <TitleCard
          title={t('presets.savedTitle', {})}
          icon={<FontAwesomeIcon icon={faBookmark} />}
          rightSection={
            canManagePresets ? (
              <Button
                size='compact-sm'
                variant='light'
                className='ml-auto'
                leftSection={<FontAwesomeIcon icon={faPlus} />}
                disabled={savedPresets.length >= maxPresets}
                onClick={() =>
                  setPresetModal({
                    mode: 'create',
                    name: '',
                    description: '',
                    config: cloneConfig(draft),
                  })
                }
              >
                {t('actions.savePreset', {})}
              </Button>
            ) : null
          }
        >
          <Text size='xs' c='dimmed' mb='sm'>
            {t('presets.savedSubtitle', { count: savedPresets.length, max: maxPresets })}
          </Text>
          {presetsQuery.isLoading ? (
            <Spinner size={18} />
          ) : savedPresets.length === 0 ? (
            <Text size='sm' c='dimmed'>
              {t('presets.savedEmpty', {})}
            </Text>
          ) : (
            <div className='grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3'>
              {savedPresets.map((preset) => (
                <Card key={preset.id} withBorder radius='md' p='sm'>
                  <Stack gap='xs' h='100%' justify='space-between'>
                    <Stack gap={4}>
                      <Group justify='space-between' wrap='nowrap' gap='xs'>
                        <Text fw={600} size='sm' truncate>
                          {preset.name}
                        </Text>
                        <Badge size='xs' variant='light' color='grape'>
                          {summarizeActiveConfig(preset.config, data.server_memory_mb)}
                        </Badge>
                      </Group>
                      {preset.description ? (
                        <Text size='xs' c='dimmed' lineClamp={2}>
                          {preset.description}
                        </Text>
                      ) : null}
                    </Stack>

                    <Group justify='space-between' gap='xs'>
                      <Button
                        size='compact-xs'
                        variant='light'
                        onClick={() => {
                          setDraft(cloneConfig(preset.config));
                          addToast(t('toasts.loadedPreset', { name: preset.name }), 'info');
                        }}
                      >
                        {t('actions.load', {})}
                      </Button>
                      <Group gap={4}>
                        <Tooltip label={t('actions.export', {})}>
                          <ActionIcon
                            size='sm'
                            variant='subtle'
                            onClick={() =>
                              setExportTarget({
                                config: preset.config,
                                name: preset.name,
                                description: preset.description,
                              })
                            }
                          >
                            <FontAwesomeIcon icon={faFileExport} size='xs' />
                          </ActionIcon>
                        </Tooltip>
                        {canManagePresets ? (
                          <>
                            <Tooltip label={t('actions.edit', {})}>
                              <ActionIcon
                                size='sm'
                                variant='subtle'
                                color='blue'
                                onClick={() =>
                                  setPresetModal({
                                    mode: 'edit',
                                    presetId: preset.id,
                                    name: preset.name,
                                    description: preset.description,
                                    config: cloneConfig(draft),
                                  })
                                }
                              >
                                <FontAwesomeIcon icon={faPencil} size='xs' />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label={t('actions.delete', {})}>
                              <ActionIcon
                                size='sm'
                                variant='subtle'
                                color='red'
                                onClick={() => setDeletingPreset(preset)}
                              >
                                <FontAwesomeIcon icon={faTrash} size='xs' />
                              </ActionIcon>
                            </Tooltip>
                          </>
                        ) : null}
                      </Group>
                    </Group>
                  </Stack>
                </Card>
              ))}
            </div>
          )}
        </TitleCard>

        {/* Interactive Builder Grid */}
        <div className='grid grid-cols-1 xl:grid-cols-2 gap-4'>
          {/* Garbage Collector */}
          <TitleCard title={t('builder.gcTitle', {})} icon={<FontAwesomeIcon icon={faGears} />}>
            <Stack gap='sm'>
              <Text size='xs' c='dimmed'>
                {t('builder.gcSubtitle', {})}
              </Text>
              <div className='grid grid-cols-1 sm:grid-cols-2 gap-2'>
                {GC_OPTIONS.map((option) => {
                  const active = draft.gc === option.value;
                  return (
                    <Card
                      key={option.value}
                      hoverable
                      withBorder
                      radius='md'
                      p='xs'
                      className={
                        active ? 'border-(--mantine-color-blue-5)! bg-(--mantine-color-blue-light)!' : undefined
                      }
                      onClick={() => handleSelectGc(option.value)}
                    >
                      <Stack gap={2}>
                        <Text fw={600} size='sm'>
                          {t(option.labelKey, {})}
                        </Text>
                        <Text size='xs' c='dimmed'>
                          {t(option.descKey, {})}
                        </Text>
                      </Stack>
                    </Card>
                  );
                })}
              </div>

              {draft.gc === 'aikar' ? (
                <Alert color='blue'>
                  <Text size='xs'>
                    {isAikarHighMem ? t('builder.aikarTierHigh', {}) : t('builder.aikarTierLow', {})}
                  </Text>
                </Alert>
              ) : null}

              {draft.gc === 'zgc' && data.java_version !== null && data.java_version < 21 ? (
                <Alert color='red' icon={<FontAwesomeIcon icon={faTriangleExclamation} />}>
                  <Text size='xs'>{t('builder.zgcJavaWarning', { version: data.java_version })}</Text>
                </Alert>
              ) : null}

              {draft.gc === 'zgc' && data.java_version !== null && data.java_version >= 24 ? (
                <Alert color='blue'>
                  <Text size='xs'>{t('builder.zgcJava24Note', { version: data.java_version })}</Text>
                </Alert>
              ) : null}

              {draft.gc === 'shenandoah' && data.java_version !== null && data.java_version < 17 ? (
                <Alert color='yellow' icon={<FontAwesomeIcon icon={faTriangleExclamation} />}>
                  <Text size='xs'>{t('builder.shenandoahJavaWarning', { version: data.java_version })}</Text>
                </Alert>
              ) : null}
            </Stack>
          </TitleCard>

          {/* Heap & Memory */}
          <TitleCard title={t('builder.memoryTitle', {})} icon={<FontAwesomeIcon icon={faMemory} />}>
            <Stack gap='sm'>
              <Text size='xs' c='dimmed'>
                {t('builder.memorySubtitle', {})}
              </Text>

              <SegmentedControl
                fullWidth
                value={draft.memory_mode}
                onChange={(val) => setDraft({ ...draft, memory_mode: val as MemoryMode })}
                data={[
                  { label: t('builder.modePercentage', {}), value: 'percentage' },
                  {
                    label: t('builder.modeCustom', {}),
                    value: 'custom',
                    disabled: !data.settings.allow_custom_memory,
                  },
                  { label: t('builder.modeTemplate', { expr: '{{SERVER_MEMORY}}' }), value: 'template' },
                ]}
              />

              {!data.settings.allow_custom_memory ? (
                <Text size='xs' c='dimmed'>
                  {t('builder.customMemoryDisabled', {})}
                </Text>
              ) : null}

              {draft.memory_mode === 'percentage' ? (
                <Stack gap='sm'>
                  <Stack gap={4}>
                    <Group justify='space-between'>
                      <Text size='sm' fw={500}>
                        {t('builder.maxRamPercentage', {})}
                      </Text>
                      <Badge variant='light' color='blue'>
                        {draft.max_ram_percentage.toFixed(1)}%
                      </Badge>
                    </Group>
                    <Slider
                      min={10}
                      max={data.settings.max_ram_percentage}
                      step={0.5}
                      value={Math.min(draft.max_ram_percentage, data.settings.max_ram_percentage)}
                      onChange={(value) => setDraft({ ...draft, max_ram_percentage: value })}
                    />
                    <Text size='xs' c='dimmed'>
                      {t('builder.maxRamPercentageDesc', {
                        max: data.settings.max_ram_percentage.toFixed(1),
                        heap: data.server_memory_mb > 0 ? formatMemoryLabel(currentEffectiveHeap) : 'Dynamic',
                      })}
                    </Text>
                  </Stack>

                  <NumberInput
                    label={t('builder.initialHeapXms', {})}
                    min={64}
                    max={safeCapMb ?? 262_144}
                    step={128}
                    allowDecimal={false}
                    value={draft.xms_mb}
                    onChange={(value) => typeof value === 'number' && setDraft({ ...draft, xms_mb: value })}
                  />
                </Stack>
              ) : null}

              {draft.memory_mode === 'custom' ? (
                <Stack gap='sm'>
                  <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
                    <NumberInput
                      label={t('builder.initialHeapXms', {})}
                      min={64}
                      max={draft.xmx_mb}
                      step={256}
                      allowDecimal={false}
                      value={draft.xms_mb}
                      onChange={(value) => typeof value === 'number' && setDraft({ ...draft, xms_mb: value })}
                    />
                    <NumberInput
                      label={t('builder.maxHeapXmx', {})}
                      min={128}
                      max={safeCapMb ?? 262_144}
                      step={256}
                      allowDecimal={false}
                      value={draft.xmx_mb}
                      onChange={(value) =>
                        typeof value === 'number' &&
                        setDraft({
                          ...draft,
                          xmx_mb: value,
                          xms_mb: Math.min(draft.xms_mb, value),
                        })
                      }
                    />
                  </div>

                  <Group gap='xs' wrap='wrap'>
                    {safeCapMb !== null ? (
                      <Button
                        size='compact-xs'
                        variant='light'
                        onClick={() =>
                          setDraft({
                            ...draft,
                            xmx_mb: safeCapMb,
                            xms_mb: Math.min(draft.xms_mb, safeCapMb),
                          })
                        }
                      >
                        {t('builder.recommendedOverhead', {})} ({formatMemoryLabel(safeCapMb)})
                      </Button>
                    ) : null}
                    <Button
                      size='compact-xs'
                      variant='light'
                      color='indigo'
                      onClick={() => setDraft({ ...draft, xms_mb: draft.xmx_mb })}
                    >
                      {t('builder.matchXmsXmx', {})}
                    </Button>
                  </Group>

                  <Stack gap={4}>
                    <Group justify='space-between'>
                      <Text size='xs' fw={500}>
                        {t('builder.headroomLabel', {})}
                      </Text>
                      {safeCapMb !== null ? (
                        <Text size='xs' c={exceedsSafeCap ? 'red' : 'dimmed'}>
                          {t('builder.headroomSafeCap', { cap: formatMemoryLabel(safeCapMb) })}
                        </Text>
                      ) : (
                        <Text size='xs' c='dimmed'>
                          {t('builder.headroomUnlimited', {})}
                        </Text>
                      )}
                    </Group>
                    {data.server_memory_mb > 0 ? (
                      <>
                        <MantineProgress.Root size='md' radius='sm'>
                          <MantineProgress.Section
                            value={heapPercentOfContainer}
                            color={exceedsSafeCap ? 'red' : 'blue'}
                          />
                          <MantineProgress.Section value={overheadPercentOfContainer} color='teal' />
                        </MantineProgress.Root>
                        <Text size='xs' c='dimmed'>
                          {t('builder.headroomSummary', {
                            heap: formatMemoryLabel(draft.xmx_mb),
                            overhead: formatMemoryLabel(data.settings.memory_overhead_mb),
                            total: formatMemoryLabel(data.server_memory_mb),
                          })}
                        </Text>
                      </>
                    ) : null}
                  </Stack>
                </Stack>
              ) : null}

              {draft.memory_mode === 'template' ? (
                <Stack gap='sm'>
                  <Switch
                    label={t('builder.templateMatchXms', { expr: '{{SERVER_MEMORY}}' })}
                    description={t('builder.templateMatchXmsDesc', {})}
                    checked={draft.template_match_xms}
                    onChange={(e) => setDraft({ ...draft, template_match_xms: e.currentTarget.checked })}
                  />
                  {!draft.template_match_xms ? (
                    <NumberInput
                      label={t('builder.initialHeapXms', {})}
                      min={64}
                      max={safeCapMb ?? 262_144}
                      step={128}
                      allowDecimal={false}
                      value={draft.xms_mb}
                      onChange={(value) => typeof value === 'number' && setDraft({ ...draft, xms_mb: value })}
                    />
                  ) : null}
                </Stack>
              ) : null}
            </Stack>
          </TitleCard>
        </div>

        {/* Toggleable JVM Flags */}
        <TitleCard title={t('builder.togglesTitle', {})} icon={<FontAwesomeIcon icon={faSliders} />}>
          <Stack gap='md'>
            <Text size='xs' c='dimmed'>
              {t('builder.togglesSubtitle', {})}
            </Text>

            <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3'>
              {TOGGLE_ITEMS.map((item) => (
                <Switch
                  key={item.key}
                  label={item.label}
                  description={item.flag}
                  checked={draft.toggles[item.key]}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      toggles: { ...draft.toggles, [item.key]: e.currentTarget.checked },
                    })
                  }
                />
              ))}
            </div>

            <div className='grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-(--mantine-color-default-border)'>
              <NumberInput
                label={t('builder.maxGcPauseMillis', {})}
                description={t('builder.maxGcPauseMillisDesc', {})}
                min={10}
                max={2000}
                allowDecimal={false}
                placeholder='200'
                value={draft.toggles.max_gc_pause_millis ?? ''}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    toggles: {
                      ...draft.toggles,
                      max_gc_pause_millis: typeof value === 'number' ? value : null,
                    },
                  })
                }
              />
              <Select
                label={t('builder.g1HeapRegionSize', {})}
                description={t('builder.g1HeapRegionSizeDesc', {})}
                value={draft.toggles.g1_heap_region_size_mb ? String(draft.toggles.g1_heap_region_size_mb) : 'auto'}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    toggles: {
                      ...draft.toggles,
                      g1_heap_region_size_mb: !value || value === 'auto' ? null : Number.parseInt(value, 10),
                    },
                  })
                }
                data={[
                  { value: 'auto', label: t('builder.g1Auto', {}) },
                  { value: '1', label: '1M' },
                  { value: '2', label: '2M' },
                  { value: '4', label: '4M' },
                  { value: '8', label: '8M' },
                  { value: '16', label: '16M' },
                  { value: '32', label: '32M' },
                ]}
              />
            </div>
          </Stack>
        </TitleCard>

        {/* Custom JVM Flags */}
        <TitleCard title={t('builder.customFlagsTitle', {})} icon={<FontAwesomeIcon icon={faCode} />}>
          {data.settings.allow_custom_flags ? (
            <Stack gap='sm'>
              <Text size='xs' c='dimmed'>
                {t('builder.customFlagsSubtitle', { max: MAX_CUSTOM_FLAGS })}
              </Text>
              <Group gap='xs' align='flex-start' wrap='nowrap'>
                <TextInput
                  className='flex-1'
                  placeholder={t('builder.customFlagsPlaceholder', {})}
                  value={customFlagInput}
                  error={customFlagError}
                  onChange={(e) => {
                    setCustomFlagInput(e.target.value);
                    setCustomFlagError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCustomFlags();
                    }
                  }}
                />
                <Button
                  variant='light'
                  leftSection={<FontAwesomeIcon icon={faPlus} />}
                  disabled={!customFlagInput.trim()}
                  onClick={handleAddCustomFlags}
                >
                  {t('builder.addFlags', {})}
                </Button>
              </Group>

              {draft.custom_flags.length === 0 ? (
                <Text size='xs' c='dimmed'>
                  {t('builder.noCustomFlags', {})}
                </Text>
              ) : (
                <Group gap='xs' wrap='wrap'>
                  {draft.custom_flags.map((flag) => {
                    const err = validateCustomFlag(flag, data.settings.extra_blocked_flags);
                    return (
                      <Tooltip key={flag} label={err ?? flag} disabled={!err}>
                        <Badge
                          size='lg'
                          variant='light'
                          color={err ? 'red' : 'blue'}
                          rightSection={
                            <ActionIcon
                              size='xs'
                              variant='transparent'
                              color={err ? 'red' : 'blue'}
                              aria-label={`Remove ${flag}`}
                              onClick={() =>
                                setDraft({
                                  ...draft,
                                  custom_flags: draft.custom_flags.filter((item) => item !== flag),
                                })
                              }
                            >
                              <FontAwesomeIcon icon={faXmark} size='xs' />
                            </ActionIcon>
                          }
                        >
                          <span className='font-mono text-xs'>{flag}</span>
                        </Badge>
                      </Tooltip>
                    );
                  })}
                </Group>
              )}
            </Stack>
          ) : (
            <Alert color='gray'>
              <Text size='sm'>{t('builder.customFlagsDisabled', {})}</Text>
            </Alert>
          )}
        </TitleCard>

        {/* Live Command Preview & Apply Bar */}
        <TitleCard
          title={t('builder.previewTitle', {})}
          icon={<FontAwesomeIcon icon={faTerminal} />}
          rightSection={
            <Badge className='ml-auto' variant='light' color={previewCommand.length > MAX_COMMAND_LEN ? 'red' : 'gray'}>
              {t('builder.commandLength', { count: previewCommand.length, max: MAX_COMMAND_LEN })}
            </Badge>
          }
        >
          <Stack gap='sm'>
            <Text size='xs' c='dimmed'>
              {t('builder.previewSubtitle', {})}
            </Text>

            <Code block className='whitespace-pre-wrap! break-all! text-xs! p-3!'>
              {previewCommand}
            </Code>

            {validationErrors.length > 0 ? (
              <Alert color='red' icon={<FontAwesomeIcon icon={faTriangleExclamation} />}>
                <Stack gap={2}>
                  {validationErrors.map((err, i) => (
                    <Text key={i} size='xs'>
                      {err}
                    </Text>
                  ))}
                </Stack>
              </Alert>
            ) : null}

            <Group justify='space-between' wrap='wrap' gap='sm'>
              <Group gap='xs' wrap='wrap'>
                <Button
                  variant='default'
                  size='sm'
                  leftSection={<FontAwesomeIcon icon={faCopy} />}
                  onClick={() => handleRawCopyToClipboard(previewCommand, addToast)}
                >
                  {t('actions.copyCommand', {})}
                </Button>
                {canManagePresets ? (
                  <>
                    <Button
                      variant='light'
                      color='grape'
                      size='sm'
                      leftSection={<FontAwesomeIcon icon={faBookmark} />}
                      disabled={savedPresets.length >= maxPresets || validationErrors.length > 0}
                      onClick={() =>
                        setPresetModal({
                          mode: 'create',
                          name: '',
                          description: '',
                          config: cloneConfig(draft),
                        })
                      }
                    >
                      {t('actions.savePreset', {})}
                    </Button>
                    <Button
                      variant='default'
                      size='sm'
                      leftSection={<FontAwesomeIcon icon={faFileExport} />}
                      onClick={() => setExportTarget({ config: draft })}
                    >
                      {t('actions.export', {})}
                    </Button>
                  </>
                ) : null}
              </Group>

              {canUpdate ? (
                <Button
                  size='sm'
                  leftSection={<FontAwesomeIcon icon={faCheck} />}
                  loading={applying}
                  disabled={validationErrors.length > 0 || !hasUnsavedChanges}
                  onClick={() => handleApply(draft)}
                >
                  {t('actions.applyFlags', {})}
                </Button>
              ) : null}
            </Group>
          </Stack>
        </TitleCard>
      </Stack>

      {/* Modals */}
      <ConfirmationModal
        opened={resetOpen}
        onClose={() => setResetOpen(false)}
        title={t('resetModal.title', {})}
        confirm={t('resetModal.confirm', {})}
        onConfirmed={handleReset}
      >
        <Text size='sm'>{t('resetModal.content', {})}</Text>
        {resetting ? (
          <Group mt='sm'>
            <Spinner size={18} />
          </Group>
        ) : null}
      </ConfirmationModal>

      <ConfirmationModal
        opened={Boolean(deletingPreset)}
        onClose={() => setDeletingPreset(null)}
        title={t('presets.deleteConfirmTitle', {})}
        confirm={t('actions.delete', {})}
        onConfirmed={handleDeletePreset}
      >
        <Text size='sm'>{t('presets.deleteConfirmContent', { name: deletingPreset?.name ?? '' })}</Text>
      </ConfirmationModal>

      <ImportModal
        opened={importOpen}
        onClose={() => setImportOpen(false)}
        serverUuid={server.uuid}
        serverMemoryMb={data.server_memory_mb}
        canUpdate={canUpdate}
        canManagePresets={canManagePresets}
        onLoadIntoBuilder={(config) => {
          setDraft(cloneConfig(config));
          addToast(t('toasts.imported', {}), 'success');
        }}
        onApplyNow={handleApply}
        onSaveAsPreset={(config, suggestedName, suggestedDescription) =>
          setPresetModal({
            mode: 'create',
            name: suggestedName ?? '',
            description: suggestedDescription ?? '',
            config: cloneConfig(config),
          })
        }
      />

      {exportTarget ? (
        <ExportModal
          opened
          onClose={() => setExportTarget(null)}
          config={exportTarget.config}
          name={exportTarget.name}
          description={exportTarget.description}
        />
      ) : null}

      {presetModal ? (
        <PresetSaveModal
          opened
          mode={presetModal.mode}
          initialName={presetModal.name}
          initialDescription={presetModal.description}
          saving={savingPreset}
          onClose={() => setPresetModal(null)}
          onSubmit={handleSavePresetSubmit}
        />
      ) : null}
    </ServerContentContainer>
  );
}
