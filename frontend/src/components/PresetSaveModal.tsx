import { useEffect, useState } from 'react';
import Button from '@/elements/buttons/Button.tsx';
import TextArea from '@/elements/input/TextArea.tsx';
import TextInput from '@/elements/input/TextInput.tsx';
import Stack from '@/elements/layout/Stack.tsx';
import { Modal, ModalFooter } from '@/elements/modals/Modal.tsx';
import { useExtTranslations } from '../translations.ts';

interface PresetSaveModalProps {
  opened: boolean;
  mode: 'create' | 'edit';
  initialName?: string;
  initialDescription?: string;
  saving: boolean;
  onClose: () => void;
  onSubmit: (name: string, description: string) => Promise<void>;
}

export default function PresetSaveModal({
  opened,
  mode,
  initialName = '',
  initialDescription = '',
  saving,
  onClose,
  onSubmit,
}: PresetSaveModalProps) {
  const { t } = useExtTranslations();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);

  useEffect(() => {
    if (opened) {
      setName(initialName);
      setDescription(initialDescription);
    }
  }, [opened, initialName, initialDescription]);

  const trimmedName = name.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmedName || trimmedName.length > 80) return;
    await onSubmit(trimmedName, description.trim());
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t(mode === 'create' ? 'presetModal.createTitle' : 'presetModal.editTitle', {})}
    >
      <form onSubmit={handleSubmit}>
        <Stack gap='sm'>
          <TextInput
            withAsterisk
            label={t('presetModal.nameLabel', {})}
            placeholder={t('presetModal.namePlaceholder', {})}
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <TextArea
            label={t('presetModal.descriptionLabel', {})}
            placeholder={t('presetModal.descriptionPlaceholder', {})}
            maxLength={255}
            autosize
            minRows={2}
            maxRows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Stack>

        <ModalFooter>
          <Button variant='default' onClick={onClose}>
            {t('actions.cancel', {})}
          </Button>
          <Button type='submit' loading={saving} disabled={!trimmedName || trimmedName.length > 80}>
            {t('actions.save', {})}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
