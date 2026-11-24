import {
  faBookmark,
  faCheck,
  faFileImport,
  faMagnifyingGlass,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useState } from 'react';
import { httpErrorToHuman } from '@/api/axios.ts';
import Button from '@/elements/buttons/Button.tsx';
import Badge from '@/elements/data-display/Badge.tsx';
import Card from '@/elements/data-display/Card.tsx';
import Alert from '@/elements/feedback/Alert.tsx';
import TextArea from '@/elements/input/TextArea.tsx';
import Group from '@/elements/layout/Group.tsx';
import Stack from '@/elements/layout/Stack.tsx';
import { Modal, ModalFooter } from '@/elements/modals/Modal.tsx';
import Code from '@/elements/typography/Code.tsx';
import Text from '@/elements/typography/Text.tsx';
import { type ParsedImportResult, parseImportedStartupFlags } from '../api.ts';
import { type FlagConfig, summarizeActiveConfig } from '../lib/flags.ts';
import { useExtTranslations } from '../translations.ts';

interface ImportModalProps {
  opened: boolean;
  onClose: () => void;
  serverUuid: string;
  serverMemoryMb: number;
  canUpdate: boolean;
  canManagePresets: boolean;
  onLoadIntoBuilder: (config: FlagConfig) => void;
  onApplyNow: (config: FlagConfig) => Promise<void>;
  onSaveAsPreset: (config: FlagConfig, suggestedName?: string | null, suggestedDescription?: string | null) => void;
}

export default function ImportModal({
  opened,
  onClose,
  serverUuid,
  serverMemoryMb,
  canUpdate,
  canManagePresets,
  onLoadIntoBuilder,
  onApplyNow,
  onSaveAsPreset,
}: ImportModalProps) {
  const { t } = useExtTranslations();
  const [input, setInput] = useState('');
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ParsedImportResult | null>(null);

  const handleClose = () => {
    setInput('');
    setError(null);
    setResult(null);
    onClose();
  };

  const handleInspect = async () => {
    setParsing(true);
    setError(null);
    try {
      const parsed = await parseImportedStartupFlags(serverUuid, input);
      setResult(parsed);
    } catch (err) {
      setResult(null);
      setError(httpErrorToHuman(err));
    } finally {
      setParsing(false);
    }
  };

  const handleApply = async () => {
    if (!result) return;
    setApplying(true);
    try {
      await onApplyNow(result.config);
      handleClose();
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal opened={opened} onClose={handleClose} title={t('importModal.title', {})} size='lg'>
      <Stack gap='md'>
        <Text size='sm' c='dimmed'>
          {t('importModal.description', {})}
        </Text>

        <TextArea
          label={t('importModal.inputLabel', {})}
          placeholder={t('importModal.inputPlaceholder', {})}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setResult(null);
            setError(null);
          }}
          autosize
          minRows={4}
          maxRows={10}
          styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
        />

        <Group justify='flex-end'>
          <Button
            variant='light'
            leftSection={<FontAwesomeIcon icon={faMagnifyingGlass} />}
            loading={parsing}
            disabled={!input.trim()}
            onClick={handleInspect}
          >
            {t('importModal.parseButton', {})}
          </Button>
        </Group>

        {error ? <Alert color='red'>{error}</Alert> : null}

        {result ? (
          <Stack gap='sm'>
            <Card withBorder radius='md' p='sm'>
              <Stack gap='xs'>
                <Group justify='space-between' wrap='wrap' gap='xs'>
                  <Group gap='xs'>
                    <Badge variant='light' color='blue'>
                      {t('importModal.detectedFormat', { format: result.source_format })}
                    </Badge>
                    <Badge variant='outline' color='gray'>
                      {summarizeActiveConfig(result.config, serverMemoryMb)}
                    </Badge>
                  </Group>
                  {result.name ? (
                    <Text size='sm' fw={600}>
                      {result.name}
                    </Text>
                  ) : null}
                </Group>

                {result.description ? (
                  <Text size='xs' c='dimmed'>
                    {result.description}
                  </Text>
                ) : null}

                <Stack gap={4}>
                  <Text size='xs' fw={600} c='dimmed'>
                    {t('importModal.previewCommand', {})}
                  </Text>
                  <Code block className='whitespace-pre-wrap! break-all! text-xs!'>
                    {result.preview_command}
                  </Code>
                </Stack>
              </Stack>
            </Card>

            {result.warnings.length > 0 ? (
              <Alert
                color='yellow'
                icon={<FontAwesomeIcon icon={faTriangleExclamation} />}
                title={t('importModal.warningsTitle', {})}
              >
                <Stack gap={4}>
                  {result.warnings.map((warning, i) => (
                    <Text key={i} size='xs'>
                      {warning}
                    </Text>
                  ))}
                </Stack>
              </Alert>
            ) : null}

            {result.rejected_flags.length > 0 ? (
              <Alert
                color='red'
                icon={<FontAwesomeIcon icon={faTriangleExclamation} />}
                title={t('importModal.rejectedTitle', { count: result.rejected_flags.length })}
              >
                <Stack gap={4}>
                  {result.rejected_flags.map((item, i) => (
                    <Text key={i} size='xs'>
                      <Code>{item.flag}</Code> — {item.reason}
                    </Text>
                  ))}
                </Stack>
              </Alert>
            ) : null}
          </Stack>
        ) : null}
      </Stack>

      <ModalFooter>
        <Button variant='default' onClick={handleClose}>
          {t('actions.cancel', {})}
        </Button>
        {result ? (
          <>
            <Button
              variant='light'
              leftSection={<FontAwesomeIcon icon={faFileImport} />}
              onClick={() => {
                onLoadIntoBuilder(result.config);
                handleClose();
              }}
            >
              {t('importModal.loadIntoBuilder', {})}
            </Button>
            {canManagePresets ? (
              <Button
                variant='light'
                color='grape'
                leftSection={<FontAwesomeIcon icon={faBookmark} />}
                onClick={() => {
                  const { config, name, description } = result;
                  handleClose();
                  onSaveAsPreset(config, name, description);
                }}
              >
                {t('importModal.saveAsPreset', {})}
              </Button>
            ) : null}
            {canUpdate ? (
              <Button leftSection={<FontAwesomeIcon icon={faCheck} />} loading={applying} onClick={handleApply}>
                {t('importModal.applyNow', {})}
              </Button>
            ) : null}
          </>
        ) : null}
      </ModalFooter>
    </Modal>
  );
}
