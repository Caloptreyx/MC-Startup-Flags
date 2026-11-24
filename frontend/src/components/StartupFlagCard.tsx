import { faChevronRight, faScaleBalanced } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useShallow } from 'zustand/react/shallow';
import Badge from '@/elements/data-display/Badge.tsx';
import Card from '@/elements/data-display/Card.tsx';
import ThemeIcon from '@/elements/data-display/ThemeIcon.tsx';
import Group from '@/elements/layout/Group.tsx';
import Stack from '@/elements/layout/Stack.tsx';
import Text from '@/elements/typography/Text.tsx';
import { useServerCan } from '@/plugins/usePermissions.ts';
import { useServerStore } from '@/stores/server.ts';
import { isServerEligible, parseStartupCommand, summarizeActiveConfig } from '../lib/flags.ts';
import { getConfiguredEggs } from '../lib/indexConfig.ts';
import { useExtTranslations } from '../translations.ts';

export default function StartupFlagCard() {
  const { t } = useExtTranslations();
  const navigate = useNavigate();
  const canRead = useServerCan('startup-flags.read');
  const server = useServerStore(useShallow((state) => state.server));

  const eligible = useMemo(() => isServerEligible(server, getConfiguredEggs()), [server]);

  const summary = useMemo(() => {
    if (!eligible || !server.startup) return null;
    const parsed = parseStartupCommand(server.startup, server.limits?.memory ?? 0);
    return summarizeActiveConfig(parsed.config, server.limits?.memory ?? 0);
  }, [eligible, server.startup, server.limits?.memory]);

  if (!canRead || !eligible || !server.uuidShort) {
    return null;
  }

  const openEditor = () => navigate(`/server/${server.uuidShort}/startup-flags`);

  return (
    <Card
      hoverable
      withBorder
      radius='md'
      p='md'
      mb='md'
      role='button'
      tabIndex={0}
      onClick={openEditor}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openEditor();
        }
      }}
    >
      <Group justify='space-between' wrap='nowrap' gap='md'>
        <Group wrap='nowrap' gap='md' className='min-w-0'>
          <ThemeIcon variant='light' color='blue' size={42} radius='md' className='shrink-0'>
            <FontAwesomeIcon icon={faScaleBalanced} size='lg' />
          </ThemeIcon>
          <Stack gap={2} className='min-w-0'>
            <Text fw={600} size='sm'>
              {t('card.title', {})}
            </Text>
            <Text size='xs' c='dimmed' lineClamp={1}>
              {t('card.subtitle', {})}
            </Text>
          </Stack>
        </Group>

        <Group gap='sm' wrap='nowrap' className='shrink-0'>
          {summary ? (
            <Badge variant='light' color='blue' size='sm' className='hidden! sm:inline-flex!'>
              {summary}
            </Badge>
          ) : null}
          <FontAwesomeIcon icon={faChevronRight} className='text-(--mantine-color-dimmed)' size='sm' />
        </Group>
      </Group>
    </Card>
  );
}
