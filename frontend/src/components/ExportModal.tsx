import { faCopy } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useMemo } from 'react';
import Button from '@/elements/buttons/Button.tsx';
import TextArea from '@/elements/input/TextArea.tsx';
import Group from '@/elements/layout/Group.tsx';
import Stack from '@/elements/layout/Stack.tsx';
import { Modal, ModalFooter } from '@/elements/modals/Modal.tsx';
import Text from '@/elements/typography/Text.tsx';
import { handleRawCopyToClipboard } from '@/lib/clipboard/copy.ts';
import { useToast } from '@/providers/ToastProvider.tsx';
import { encodeShareCode, type FlagConfig } from '../lib/flags.ts';
import { useExtTranslations } from '../translations.ts';

interface ExportModalProps {
  opened: boolean;
  onClose: () => void;
  config: FlagConfig;
  name?: string;
  description?: string;
}

export default function ExportModal({ opened, onClose, config, name, description }: ExportModalProps) {
  const { t } = useExtTranslations();
  const { addToast } = useToast();

  const shareCode = useMemo(() => encodeShareCode(config, { name, description }), [config, name, description]);

  const formattedJson = useMemo(
    () =>
      JSON.stringify(
        {
          v: 1,
          ...(name?.trim() ? { name: name.trim() } : {}),
          ...(description?.trim() ? { description: description.trim() } : {}),
          config,
        },
        null,
        2,
      ),
    [config, name, description],
  );

  return (
    <Modal opened={opened} onClose={onClose} title={t('exportModal.title', {})} size='lg'>
      <Stack gap='md'>
        <Text size='sm' c='dimmed'>
          {t('exportModal.description', {})}
        </Text>

        <Stack gap='xs'>
          <Group justify='space-between'>
            <Text size='sm' fw={600}>
              {t('exportModal.shareCodeLabel', {})}
            </Text>
            <Button
              size='compact-sm'
              variant='light'
              leftSection={<FontAwesomeIcon icon={faCopy} />}
              onClick={() => handleRawCopyToClipboard(shareCode, addToast)}
            >
              {t('exportModal.copyShareCode', {})}
            </Button>
          </Group>
          <TextArea
            value={shareCode}
            readOnly
            autosize
            minRows={2}
            maxRows={4}
            styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
          />
        </Stack>

        <Stack gap='xs'>
          <Group justify='space-between'>
            <Text size='sm' fw={600}>
              {t('exportModal.jsonLabel', {})}
            </Text>
            <Button
              size='compact-sm'
              variant='light'
              leftSection={<FontAwesomeIcon icon={faCopy} />}
              onClick={() => handleRawCopyToClipboard(formattedJson, addToast)}
            >
              {t('exportModal.copyJson', {})}
            </Button>
          </Group>
          <TextArea
            value={formattedJson}
            readOnly
            autosize
            minRows={6}
            maxRows={14}
            styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
          />
        </Stack>
      </Stack>

      <ModalFooter>
        <Button variant='default' onClick={onClose}>
          {t('actions.cancel', {})}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
