import type { ReactElement } from 'react';
import { useServerStore } from '@/stores/server.ts';
import { isServerEligible } from '../lib/flags.ts';
import { getConfiguredEggs } from '../lib/indexConfig.ts';

export default function EligibleSidebarLink({ element }: { element: ReactElement }) {
  const server = useServerStore((state) => state.server);

  if (!server?.uuid) {
    return null;
  }

  return isServerEligible(server, getConfiguredEggs()) ? element : null;
}
