import { axiosInstance } from '@/api/axios.ts';
import type { BuiltInPreset, FlagConfig, ParsedStartup, ServerLimitsSettings } from './lib/flags.ts';

export const PACKAGE = 'dev.caloptreyx.startupflags';
export const ADMIN_BASE = `/api/admin/extensions/${PACKAGE}`;
const serverBase = (server: string) => `/api/client/servers/${server}/startup-flags`;
const presetsBase = '/api/client/startup-flags/presets';

export interface ServerStartupFlagsState {
  eligible: boolean;
  current_startup: string;
  egg_default_startup: string;
  is_egg_default: boolean;
  java_version: number | null;
  server_image: string;
  server_memory_mb: number;
  parsed: ParsedStartup;
  config: FlagConfig;
  presets: BuiltInPreset[];
  settings: ServerLimitsSettings;
  permissions: {
    can_update: boolean;
    can_manage_presets: boolean;
  };
}

export interface SavedPreset {
  id: string;
  name: string;
  description: string;
  config: FlagConfig;
  created: string;
  updated: string;
}

export interface RejectedFlag {
  flag: string;
  reason: string;
}

export interface ParsedImportResult {
  source_format: 'share_code' | 'json' | 'command';
  name: string | null;
  description: string | null;
  config: FlagConfig;
  preview_command: string;
  warnings: string[];
  rejected_flags: RejectedFlag[];
}

export interface Settings {
  eggs: string[];
  allow_custom_flags: boolean;
  allow_custom_memory: boolean;
  memory_overhead_mb: number;
  max_ram_percentage: number;
  max_presets_per_user: number;
  extra_blocked_flags: string[];
}

export const getServerStartupFlags = async (server: string): Promise<ServerStartupFlagsState> =>
  (await axiosInstance.get(serverBase(server))).data;

export const applyServerStartupFlags = async (server: string, config: FlagConfig): Promise<ServerStartupFlagsState> =>
  (await axiosInstance.put(serverBase(server), config)).data;

export const resetServerStartupFlags = async (server: string): Promise<ServerStartupFlagsState> =>
  (await axiosInstance.post(`${serverBase(server)}/reset`)).data;

export const parseImportedStartupFlags = async (server: string, input: string): Promise<ParsedImportResult> =>
  (await axiosInstance.post(`${serverBase(server)}/parse`, { input })).data;

export const listSavedPresets = async (): Promise<{ presets: SavedPreset[]; max_presets_per_user: number }> =>
  (await axiosInstance.get(presetsBase)).data;

export const createSavedPreset = async (payload: {
  name: string;
  description: string;
  config: FlagConfig;
}): Promise<SavedPreset> => (await axiosInstance.post(presetsBase, payload)).data.preset;

export const updateSavedPreset = async (
  id: string,
  payload: { name: string; description: string; config: FlagConfig },
): Promise<SavedPreset> => (await axiosInstance.put(`${presetsBase}/${id}`, payload)).data.preset;

export const deleteSavedPreset = async (id: string): Promise<void> => {
  await axiosInstance.delete(`${presetsBase}/${id}`);
};

export const getSettings = async (): Promise<Settings> =>
  (await axiosInstance.get(`${ADMIN_BASE}/settings`)).data.settings;

export const updateSettings = async (settings: Settings): Promise<Settings> =>
  (await axiosInstance.put(`${ADMIN_BASE}/settings`, settings)).data.settings;
