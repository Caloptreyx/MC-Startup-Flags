// Pure TypeScript mirror of `src/flags.rs` and `src/settings.rs` eligibility helpers.
// Keep this module free of React/DOM/panel imports so `node --test` can import it directly.

export type MemoryMode = 'percentage' | 'custom' | 'template';
export type GcKind = 'default' | 'aikar' | 'g1gc' | 'zgc' | 'shenandoah' | 'parallel';
export type WorkloadTag = 'paper' | 'modded' | 'vanilla' | 'proxy';

export interface FlagToggles {
  always_pre_touch: boolean;
  disable_explicit_gc: boolean;
  parallel_ref_proc: boolean;
  perf_disable_shared_mem: boolean;
  use_string_deduplication: boolean;
  unlock_experimental: boolean;
  user_home_container: boolean;
  file_encoding_utf8: boolean;
  terminal_jline_false: boolean;
  log4j_no_lookups: boolean;
  simd_vector_module: boolean;
  max_gc_pause_millis: number | null;
  g1_heap_region_size_mb: number | null;
}

export interface FlagConfig {
  preset_id: string | null;
  memory_mode: MemoryMode;
  xms_mb: number;
  xmx_mb: number;
  max_ram_percentage: number;
  template_match_xms: boolean;
  gc: GcKind;
  toggles: FlagToggles;
  custom_flags: string[];
}

export interface BuiltInPreset {
  id: string;
  name: string;
  tagline: string;
  description: string;
  workloads: WorkloadTag[];
  min_java: number | null;
  max_recommended_java: number | null;
  recommends_match_xms: boolean;
  config: FlagConfig;
}

export interface ParsedStartup {
  parseable: boolean;
  leading_prefix: string;
  java_binary: string;
  trailing_target: string;
  config: FlagConfig;
  unrecognized_flags: string[];
}

export interface SharePayload {
  v: number;
  name?: string;
  description?: string;
  config: FlagConfig;
}

export interface ServerLimitsSettings {
  allow_custom_flags: boolean;
  allow_custom_memory: boolean;
  memory_overhead_mb: number;
  max_ram_percentage: number;
  max_presets_per_user: number;
  max_custom_xmx_mb: number | null;
  extra_blocked_flags: string[];
}

export interface ServerEligibilityInput {
  egg?: {
    uuid?: string;
    features?: string[];
  } | null;
  startup?: string | null;
  image?: string | null;
}

export const MAX_CUSTOM_FLAGS = 64;
export const MAX_COMMAND_LEN = 8192;
export const SHARE_PREFIX = 'mcflags:v1:';
export const AIKAR_HIGH_MEMORY_THRESHOLD_MB = 12 * 1024;
export const VALID_G1_REGION_SIZES_MB = [1, 2, 4, 8, 16, 32] as const;

const ALLOWED_EXACT_FLAGS = new Set(['--enable-preview', '-ea', '-da', '-server']);

const ALLOWED_VALUE_PREFIXES = ['--add-opens=', '--add-exports=', '--add-modules=', '--enable-native-access='];

export const HARDCODED_DENYLIST = [
  '-javaagent',
  '-agentlib',
  '-agentpath',
  '-xx:onoutofmemoryerror',
  '-xx:onerror',
  '-xx:heapdumppath',
  '-xx:errorfile',
  '-xlog',
  '-xx:compilecommand',
  '-xx:flags',
  '-xx:sharedarchivefile',
  '-xx:archiveclassesatexit',
  '-djava.library.path',
  '-djava.ext.dirs',
  '-djava.endorsed.dirs',
  '-djava.security',
  '-xbootclasspath',
  '-cp',
  '-classpath',
  '--class-path',
  '--module-path',
  '-p',
  '@',
] as const;

const MEMORY_OVERRIDE_PREFIXES = [
  '-xms',
  '-xmx',
  '-xx:maxrampercentage',
  '-xx:initialrampercentage',
  '-xx:minrampercentage',
  '-xx:maxheapsize',
  '-xx:initialheapsize',
  '-xx:maxram=',
];

const SHELL_METACHAR_RE = /[;&|`$()<>\n\r'"\\\t ]/;

function hasForbiddenChars(flag: string): boolean {
  if (SHELL_METACHAR_RE.test(flag)) return true;
  for (let i = 0; i < flag.length; i += 1) {
    const code = flag.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

const AIKAR_TUNING_FLAGS = new Set([
  '-XX:G1NewSizePercent=30',
  '-XX:G1NewSizePercent=40',
  '-XX:G1MaxNewSizePercent=40',
  '-XX:G1MaxNewSizePercent=50',
  '-XX:G1ReservePercent=20',
  '-XX:G1ReservePercent=15',
  '-XX:G1HeapWastePercent=5',
  '-XX:InitiatingHeapOccupancyPercent=15',
  '-XX:InitiatingHeapOccupancyPercent=20',
  '-XX:G1MixedGCCountTarget=4',
  '-XX:G1MixedGCLiveThresholdPercent=90',
  '-XX:G1RSetUpdatingPauseTimePercent=5',
  '-XX:SurvivorRatio=32',
  '-XX:MaxTenuringThreshold=1',
  '-Dusing.aikars.flags=https://mcflags.emc.gs',
  '-Daikars.new.flags=true',
]);

const MODDED_G1_TUNING_FLAGS = [
  '-XX:G1NewSizePercent=30',
  '-XX:G1MaxNewSizePercent=40',
  '-XX:G1ReservePercent=15',
  '-XX:InitiatingHeapOccupancyPercent=20',
];

export function defaultToggles(overrides: Partial<FlagToggles> = {}): FlagToggles {
  return {
    always_pre_touch: false,
    disable_explicit_gc: false,
    parallel_ref_proc: false,
    perf_disable_shared_mem: false,
    use_string_deduplication: false,
    unlock_experimental: false,
    user_home_container: true,
    file_encoding_utf8: false,
    terminal_jline_false: false,
    log4j_no_lookups: false,
    simd_vector_module: false,
    max_gc_pause_millis: null,
    g1_heap_region_size_mb: null,
    ...overrides,
  };
}

export function defaultConfig(overrides: Partial<FlagConfig> = {}): FlagConfig {
  return {
    preset_id: 'vanilla',
    memory_mode: 'percentage',
    xms_mb: 128,
    xmx_mb: 2048,
    max_ram_percentage: 95.0,
    template_match_xms: false,
    gc: 'default',
    toggles: defaultToggles(),
    custom_flags: [],
    ...overrides,
  };
}

export function cloneConfig(config: FlagConfig): FlagConfig {
  return {
    ...config,
    toggles: { ...config.toggles },
    custom_flags: [...config.custom_flags],
  };
}

export function maxCustomXmxMb(serverMemoryMb: number, overheadMb: number): number | null {
  if (!Number.isFinite(serverMemoryMb) || serverMemoryMb <= 0) {
    return null;
  }
  const mem = Math.floor(serverMemoryMb);
  const overhead = Math.max(0, Math.floor(overheadMb));
  if (mem <= overhead) {
    return mem;
  }
  return Math.max(128, mem - overhead);
}

export function detectJavaVersion(image: string | null | undefined): number | null {
  if (!image) return null;
  const trimmed = image.trim();
  if (!trimmed) return null;

  const withoutDigest = trimmed.split('@')[0];
  const lastSlash = withoutDigest.lastIndexOf('/');
  const lastColon = withoutDigest.lastIndexOf(':');
  const hasTag = lastColon > lastSlash;
  const repo = hasTag ? withoutDigest.slice(0, lastColon) : withoutDigest;
  const tag = hasTag ? withoutDigest.slice(lastColon + 1) : null;

  if (tag) {
    const v = findPrefixedJavaNumber(tag);
    if (v !== null) return v;
  }
  const repoMatch = findPrefixedJavaNumber(repo);
  if (repoMatch !== null) return repoMatch;

  const repoLower = repo.toLowerCase();
  const javaRepos = [
    'java',
    'openjdk',
    'temurin',
    'corretto',
    'zulu',
    'graalvm',
    'sapmachine',
    'semeru',
    'liberica',
    'dragonwell',
  ];
  if (tag && javaRepos.some((kw) => repoLower.includes(kw))) {
    return parseLeadingJavaMajor(tag);
  }
  return null;
}

function findPrefixedJavaNumber(haystack: string): number | null {
  const lower = haystack.toLowerCase();
  for (const prefix of ['openjdk', 'java', 'jdk', 'jre', 'graalvm']) {
    let from = 0;
    while (from < lower.length) {
      const pos = lower.indexOf(prefix, from);
      if (pos === -1) break;
      const after = pos + prefix.length;
      const prevOk = pos === 0 || !/[a-z0-9]/.test(lower[pos - 1]);
      if (prevOk && after < lower.length) {
        let idx = after;
        if ('_-:/'.includes(lower[idx])) idx += 1;
        const v = parseLeadingJavaMajor(lower.slice(idx));
        if (v !== null) return v;
      }
      from = after;
    }
  }
  return null;
}

function parseLeadingJavaMajor(s: string): number | null {
  if (s.startsWith('1.')) {
    const m = /^1\.(\d+)/.exec(s);
    if (!m) return null;
    const v = Number.parseInt(m[1], 10);
    return v >= 7 && v <= 99 ? v : null;
  }
  const m = /^(\d{1,2})/.exec(s);
  if (!m) return null;
  const nextChar = s[m[1].length];
  if (nextChar && /[a-z]/i.test(nextChar) && nextChar.toLowerCase() !== 'u') {
    return null;
  }
  const v = Number.parseInt(m[1], 10);
  return v >= 7 && v <= 99 ? v : null;
}

function isEnvAssignment(token: string): boolean {
  const eq = token.indexOf('=');
  if (eq <= 0) return false;
  const name = token.slice(0, eq);
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function isJavaBinary(token: string): boolean {
  const unquoted = token.replace(/^['"]|['"]$/g, '');
  const parts = unquoted.split(/[/\\]/);
  const base = (parts[parts.length - 1] ?? '').toLowerCase();
  return base === 'java' || base === 'java.exe';
}

export function startupStartsWithJava(startup: string | null | undefined): boolean {
  if (!startup) return false;
  const tokens = tokenizeWithSpans(startup.trim());
  for (const tok of tokens) {
    if (isEnvAssignment(tok.text)) continue;
    return isJavaBinary(tok.text);
  }
  return false;
}

export function isServerEligible(server: ServerEligibilityInput | null | undefined, configuredEggs: string[]): boolean {
  if (!server) return false;
  const eggUuid = server.egg?.uuid;
  if (configuredEggs.length > 0) {
    return Boolean(eggUuid && configuredEggs.includes(eggUuid));
  }
  const features = server.egg?.features ?? [];
  if (features.some((f) => f.toLowerCase() === 'java_version' || f.toLowerCase() === 'eula')) {
    return true;
  }
  if (startupStartsWithJava(server.startup)) {
    return true;
  }
  return Boolean(server.image && server.image.toLowerCase().includes('java'));
}

interface TokenSpan {
  text: string;
  start: number;
  end: number;
}

function tokenizeWithSpans(input: string): TokenSpan[] {
  const tokens: TokenSpan[] = [];
  const len = input.length;
  let i = 0;

  while (i < len) {
    while (i < len && /\s/.test(input[i])) i += 1;
    if (i >= len) break;
    const start = i;
    let quote: string | null = null;
    let subshell = 0;
    let text = '';

    while (i < len) {
      const ch = input[i];
      if (quote) {
        if (ch === '\\' && quote === '"' && i + 1 < len) {
          text += input[i + 1];
          i += 2;
          continue;
        }
        if (ch === quote) {
          quote = null;
          i += 1;
          continue;
        }
        text += ch;
        i += 1;
        continue;
      }

      if (ch === '$' && input[i + 1] === '(') {
        subshell += 1;
        text += '$(';
        i += 2;
        continue;
      }
      if (subshell > 0) {
        if (ch === '(') subshell += 1;
        else if (ch === ')') subshell -= 1;
        text += ch;
        i += 1;
        continue;
      }

      if (/\s/.test(ch)) break;
      if (ch === "'" || ch === '"') {
        quote = ch;
        i += 1;
        continue;
      }
      if (ch === '\\' && i + 1 < len) {
        text += input[i + 1];
        i += 2;
        continue;
      }

      text += ch;
      i += 1;
    }

    tokens.push({ text, start, end: i });
  }

  return tokens;
}

export function parseMemoryMb(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const m = /^(\d+)([kKmMgGtT]?)$/.exec(trimmed);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  if (!Number.isFinite(n)) return null;
  const unit = m[2].toLowerCase();
  let mb: number;
  if (unit === 'g') mb = n * 1024;
  else if (unit === 'm') mb = n;
  else if (unit === 'k') mb = Math.floor(n / 1024);
  else if (unit === 't') mb = n * 1024 * 1024;
  else mb = Math.floor(n / (1024 * 1024));
  return Math.max(1, mb);
}

function isLaunchTargetToken(token: string): boolean {
  if (token.startsWith('@') || token.startsWith('$(')) return true;
  if (['-jar', '-m', '--module', '-cp', '-classpath', '--class-path', '-p', '--module-path'].includes(token)) {
    return true;
  }
  return !token.startsWith('-');
}

export function parseStartupCommand(command: string, serverMemoryMb: number): ParsedStartup {
  const trimmed = command.trim();
  const tokens = tokenizeWithSpans(trimmed);
  const fallbackXmx = maxCustomXmxMb(serverMemoryMb, 512) ?? 2048;

  let idx = 0;
  while (idx < tokens.length && isEnvAssignment(tokens[idx].text)) {
    idx += 1;
  }

  if (idx >= tokens.length || !isJavaBinary(tokens[idx].text)) {
    return {
      parseable: false,
      leading_prefix: '',
      java_binary: 'java',
      trailing_target: '-jar {{SERVER_JARFILE}} nogui',
      config: defaultConfig({ xmx_mb: fallbackXmx }),
      unrecognized_flags: [],
    };
  }

  const javaIdx = idx;
  const leadingPrefix = javaIdx > 0 ? trimmed.slice(0, tokens[javaIdx].start).trim() : '';
  const javaBinary = trimmed.slice(tokens[javaIdx].start, tokens[javaIdx].end);

  let targetIdx = tokens.length;
  const rawFlags: string[] = [];
  let scan = javaIdx + 1;
  while (scan < tokens.length) {
    const tok = tokens[scan].text;
    if (isLaunchTargetToken(tok)) {
      targetIdx = scan;
      break;
    }
    if (
      ['--add-modules', '--add-opens', '--add-exports', '--enable-native-access'].includes(tok) &&
      scan + 1 < tokens.length &&
      !tokens[scan + 1].text.startsWith('-')
    ) {
      rawFlags.push(`${tok}=${tokens[scan + 1].text}`);
      scan += 2;
      continue;
    }
    rawFlags.push(tok);
    scan += 1;
  }

  const trailingTarget = targetIdx < tokens.length ? trimmed.slice(tokens[targetIdx].start).trim() : '';

  let xmsMb: number | null = null;
  let xmxMb: number | null = null;
  let xmsTemplate = false;
  let xmxTemplate = false;
  let maxRamPct: number | null = null;

  let sawG1 = false;
  let sawZgc = false;
  let sawShenandoah = false;
  let sawParallel = false;
  let sawAikarsMarker = false;
  let sawProxyInline = false;

  const toggles = defaultToggles({ user_home_container: false });
  const leftover: string[] = [];

  for (const flag of rawFlags) {
    const lower = flag.toLowerCase();

    if (flag.startsWith('-Xms')) {
      const rest = flag.slice(4);
      if (rest.includes('{{SERVER_MEMORY}}')) xmsTemplate = true;
      else {
        const mb = parseMemoryMb(rest);
        if (mb !== null) xmsMb = mb;
      }
      continue;
    }
    if (flag.startsWith('-Xmx')) {
      const rest = flag.slice(4);
      if (rest.includes('{{SERVER_MEMORY}}')) xmxTemplate = true;
      else {
        const mb = parseMemoryMb(rest);
        if (mb !== null) xmxMb = mb;
      }
      continue;
    }
    if (lower.startsWith('-xx:maxrampercentage=')) {
      const parsed = Number.parseFloat(lower.slice('-xx:maxrampercentage='.length));
      if (Number.isFinite(parsed)) maxRamPct = parsed;
      continue;
    }
    if (lower.startsWith('-xx:initialrampercentage=') || lower.startsWith('-xx:minrampercentage=')) {
      continue;
    }

    if (flag === '-XX:+UseG1GC') {
      sawG1 = true;
      continue;
    }
    if (flag === '-XX:+UseZGC' || flag === '-XX:+ZGenerational') {
      sawZgc = true;
      continue;
    }
    if (flag === '-XX:+UseShenandoahGC' || lower === '-xx:shenandoahgcmode=iu') {
      sawShenandoah = true;
      continue;
    }
    if (flag === '-XX:+UseParallelGC') {
      sawParallel = true;
      continue;
    }

    switch (flag) {
      case '-XX:+AlwaysPreTouch':
        toggles.always_pre_touch = true;
        continue;
      case '-XX:+DisableExplicitGC':
        toggles.disable_explicit_gc = true;
        continue;
      case '-XX:+ParallelRefProcEnabled':
        toggles.parallel_ref_proc = true;
        continue;
      case '-XX:+PerfDisableSharedMem':
        toggles.perf_disable_shared_mem = true;
        continue;
      case '-XX:+UseStringDeduplication':
        toggles.use_string_deduplication = true;
        continue;
      case '-XX:+UnlockExperimentalVMOptions':
        toggles.unlock_experimental = true;
        continue;
      case '-Duser.home=/home/container':
        toggles.user_home_container = true;
        continue;
      case '-Dfile.encoding=UTF-8':
        toggles.file_encoding_utf8 = true;
        continue;
      case '-Dterminal.jline=false':
        toggles.terminal_jline_false = true;
        continue;
      case '-Dlog4j2.formatMsgNoLookups=true':
        toggles.log4j_no_lookups = true;
        continue;
      case '--add-modules=jdk.incubator.vector':
        toggles.simd_vector_module = true;
        continue;
      default:
        break;
    }

    if (flag.startsWith('-XX:MaxGCPauseMillis=')) {
      const ms = Number.parseInt(flag.slice('-XX:MaxGCPauseMillis='.length), 10);
      if (Number.isFinite(ms)) {
        toggles.max_gc_pause_millis = ms;
        continue;
      }
    }
    if (flag.startsWith('-XX:G1HeapRegionSize=')) {
      const mb = parseMemoryMb(flag.slice('-XX:G1HeapRegionSize='.length));
      if (mb !== null && (VALID_G1_REGION_SIZES_MB as readonly number[]).includes(mb)) {
        toggles.g1_heap_region_size_mb = mb;
        continue;
      }
    }

    if (flag === '-Dusing.aikars.flags=https://mcflags.emc.gs' || flag === '-Daikars.new.flags=true') {
      sawAikarsMarker = true;
      continue;
    }
    if (flag === '-XX:MaxInlineLevel=15') {
      sawProxyInline = true;
      leftover.push(flag);
      continue;
    }

    leftover.push(flag);
  }

  let gc: GcKind = 'default';
  const hasAikarCore =
    sawG1 &&
    (sawAikarsMarker || (leftover.includes('-XX:SurvivorRatio=32') && leftover.includes('-XX:MaxTenuringThreshold=1')));

  if (sawZgc) gc = 'zgc';
  else if (sawShenandoah) gc = 'shenandoah';
  else if (hasAikarCore) gc = 'aikar';
  else if (sawG1) gc = 'g1gc';
  else if (sawParallel) gc = 'parallel';

  const sawModdedG1 = gc === 'g1gc' && MODDED_G1_TUNING_FLAGS.every((f) => leftover.includes(f));

  const customFlags: string[] = [];
  const unrecognizedFlags: string[] = [];
  for (const flag of leftover) {
    if (gc === 'aikar' && AIKAR_TUNING_FLAGS.has(flag)) continue;
    if (sawModdedG1 && MODDED_G1_TUNING_FLAGS.includes(flag)) continue;
    if (gc === 'g1gc' && sawProxyInline && flag === '-XX:MaxInlineLevel=15') continue;
    if (validateCustomFlag(flag, []) === null) {
      customFlags.push(flag);
    } else {
      unrecognizedFlags.push(flag);
    }
  }

  if (gc === 'aikar' && (toggles.g1_heap_region_size_mb === 8 || toggles.g1_heap_region_size_mb === 16)) {
    toggles.g1_heap_region_size_mb = null;
  }

  let memoryMode: MemoryMode = 'percentage';
  let resolvedXms = xmsMb ?? 128;
  let resolvedXmx = fallbackXmx;
  let resolvedPct = 95.0;
  let templateMatchXms = false;

  if (xmxTemplate) {
    memoryMode = 'template';
    templateMatchXms = xmsTemplate;
  } else if (maxRamPct !== null) {
    memoryMode = 'percentage';
    resolvedPct = maxRamPct;
  } else if (xmxMb !== null) {
    memoryMode = 'custom';
    resolvedXmx = xmxMb;
    resolvedXms = Math.min(resolvedXms, xmxMb);
  }

  let presetId: string | null = null;
  if (gc === 'aikar') {
    presetId = toggles.simd_vector_module ? 'simd_aikars' : 'aikars';
  } else if (gc === 'zgc') {
    presetId = 'zgc';
  } else if (gc === 'shenandoah') {
    presetId = 'shenandoah';
  } else if (sawModdedG1) {
    presetId = 'modded_g1gc';
  } else if (gc === 'g1gc' && sawProxyInline) {
    presetId = 'proxy';
  } else if (
    gc === 'default' &&
    !toggles.always_pre_touch &&
    !toggles.disable_explicit_gc &&
    !toggles.parallel_ref_proc &&
    !toggles.perf_disable_shared_mem &&
    !toggles.use_string_deduplication &&
    !toggles.unlock_experimental &&
    !toggles.simd_vector_module &&
    toggles.max_gc_pause_millis === null &&
    toggles.g1_heap_region_size_mb === null &&
    customFlags.length === 0
  ) {
    presetId = 'vanilla';
  }

  return {
    parseable: true,
    leading_prefix: leadingPrefix,
    java_binary: javaBinary,
    trailing_target: trailingTarget,
    config: {
      preset_id: presetId,
      memory_mode: memoryMode,
      xms_mb: resolvedXms,
      xmx_mb: resolvedXmx,
      max_ram_percentage: resolvedPct,
      template_match_xms: templateMatchXms,
      gc,
      toggles,
      custom_flags: customFlags,
    },
    unrecognized_flags: unrecognizedFlags,
  };
}

function matchesBlockedPrefix(lowerFlag: string, lowerBlocked: string): boolean {
  if (lowerBlocked === '-p') {
    return lowerFlag === '-p' || lowerFlag.startsWith('-p=');
  }
  if (lowerBlocked === '-cp') {
    return lowerFlag === '-cp' || lowerFlag.startsWith('-cp=') || lowerFlag.startsWith('-cp:');
  }
  return lowerFlag.startsWith(lowerBlocked);
}

function isAllowedJvmFlag(flag: string): boolean {
  if (ALLOWED_EXACT_FLAGS.has(flag)) return true;
  if ((flag.startsWith('-ea:') || flag.startsWith('-da:')) && flag.length > 4) return true;
  for (const prefix of ALLOWED_VALUE_PREFIXES) {
    if (flag.startsWith(prefix)) return flag.length > prefix.length;
  }
  if (flag.startsWith('-XX:')) return flag.length > 4;
  if (flag.startsWith('-X')) return flag.length > 2 && !flag.startsWith('-XX');
  if (flag.startsWith('-D')) {
    const rest = flag.slice(2);
    const key = rest.split('=')[0];
    return key.length > 0 && /^[A-Za-z0-9._-]+$/.test(key);
  }
  return false;
}

/** Returns null if valid, or a human-readable error message if invalid or blocked. */
export function validateCustomFlag(flag: string, extraBlockedFlags: string[]): string | null {
  if (!flag) return 'Flag cannot be empty.';
  if (flag.length > 256) return `Flag \`${flag}\` exceeds maximum length of 256 characters.`;
  if (hasForbiddenChars(flag)) {
    return `Flag \`${flag}\` contains forbidden shell metacharacters or whitespace.`;
  }

  const lower = flag.toLowerCase();
  for (const blocked of HARDCODED_DENYLIST) {
    if (matchesBlockedPrefix(lower, blocked)) {
      return `Flag \`${flag}\` is blocked for security reasons (matches \`${blocked}\`).`;
    }
  }
  for (const blocked of extraBlockedFlags) {
    const needle = blocked.trim().toLowerCase();
    if (needle && matchesBlockedPrefix(lower, needle)) {
      return `Flag \`${flag}\` is blocked by administrator policy (matches \`${blocked.trim()}\`).`;
    }
  }
  for (const mem of MEMORY_OVERRIDE_PREFIXES) {
    if (lower.startsWith(mem)) {
      return `Flag \`${flag}\` overrides JVM memory; configure heap size in the Heap & Memory section instead.`;
    }
  }
  if (!isAllowedJvmFlag(flag)) {
    return `Flag \`${flag}\` does not use an allowed JVM flag prefix (-X, -XX:, -D, --add-opens=, --add-exports=, --add-modules=, --enable-native-access=, --enable-preview, -ea, -da, -server).`;
  }
  return null;
}

export function effectiveHeapMb(config: FlagConfig, serverMemoryMb: number): number {
  if (config.memory_mode === 'custom') return config.xmx_mb;
  if (config.memory_mode === 'percentage') {
    if (serverMemoryMb > 0) {
      return Math.max(128, Math.round(serverMemoryMb * (config.max_ram_percentage / 100)));
    }
    return config.xmx_mb;
  }
  return serverMemoryMb > 0 ? serverMemoryMb : config.xmx_mb;
}

function formatPercentage(pct: number): string {
  return (Math.round(pct * 10) / 10).toFixed(1);
}

export function buildJvmFlags(config: FlagConfig, javaVersion: number | null, serverMemoryMb: number): string[] {
  const flags: string[] = [];
  const pushUnique = (flag: string) => {
    if (!flags.includes(flag)) flags.push(flag);
  };

  if (config.memory_mode === 'percentage') {
    pushUnique(`-Xms${config.xms_mb}M`);
    pushUnique(`-XX:MaxRAMPercentage=${formatPercentage(config.max_ram_percentage)}`);
  } else if (config.memory_mode === 'custom') {
    pushUnique(`-Xms${config.xms_mb}M`);
    pushUnique(`-Xmx${config.xmx_mb}M`);
  } else {
    pushUnique(config.template_match_xms ? '-Xms{{SERVER_MEMORY}}M' : `-Xms${config.xms_mb}M`);
    pushUnique('-Xmx{{SERVER_MEMORY}}M');
  }

  const { toggles } = config;
  const preset = config.preset_id;

  if (config.gc === 'aikar') {
    const highMem = effectiveHeapMb(config, serverMemoryMb) >= AIKAR_HIGH_MEMORY_THRESHOLD_MB;
    const pauseMs = toggles.max_gc_pause_millis ?? 200;
    const regionMb = toggles.g1_heap_region_size_mb ?? (highMem ? 16 : 8);

    pushUnique('-XX:+UseG1GC');
    if (toggles.parallel_ref_proc) pushUnique('-XX:+ParallelRefProcEnabled');
    pushUnique(`-XX:MaxGCPauseMillis=${pauseMs}`);
    if (toggles.unlock_experimental) pushUnique('-XX:+UnlockExperimentalVMOptions');
    if (toggles.disable_explicit_gc) pushUnique('-XX:+DisableExplicitGC');
    if (toggles.always_pre_touch) pushUnique('-XX:+AlwaysPreTouch');
    pushUnique(`-XX:G1NewSizePercent=${highMem ? 40 : 30}`);
    pushUnique(`-XX:G1MaxNewSizePercent=${highMem ? 50 : 40}`);
    pushUnique(`-XX:G1HeapRegionSize=${regionMb}M`);
    pushUnique(`-XX:G1ReservePercent=${highMem ? 15 : 20}`);
    pushUnique('-XX:G1HeapWastePercent=5');
    pushUnique('-XX:G1MixedGCCountTarget=4');
    pushUnique(`-XX:InitiatingHeapOccupancyPercent=${highMem ? 20 : 15}`);
    pushUnique('-XX:G1MixedGCLiveThresholdPercent=90');
    pushUnique('-XX:G1RSetUpdatingPauseTimePercent=5');
    pushUnique('-XX:SurvivorRatio=32');
    if (toggles.perf_disable_shared_mem) pushUnique('-XX:+PerfDisableSharedMem');
    pushUnique('-XX:MaxTenuringThreshold=1');
    pushUnique('-Dusing.aikars.flags=https://mcflags.emc.gs');
    pushUnique('-Daikars.new.flags=true');
  } else if (config.gc === 'g1gc') {
    pushUnique('-XX:+UseG1GC');
    if (preset === 'modded_g1gc') {
      for (const flag of MODDED_G1_TUNING_FLAGS) pushUnique(flag);
    } else if (preset === 'proxy') {
      pushUnique('-XX:MaxInlineLevel=15');
    }
  } else if (config.gc === 'zgc') {
    pushUnique('-XX:+UseZGC');
    if (javaVersion === null || javaVersion < 24) {
      pushUnique('-XX:+ZGenerational');
    }
  } else if (config.gc === 'shenandoah') {
    pushUnique('-XX:+UseShenandoahGC');
    pushUnique('-XX:ShenandoahGCMode=iu');
  } else if (config.gc === 'parallel') {
    pushUnique('-XX:+UseParallelGC');
  }

  if (toggles.unlock_experimental) pushUnique('-XX:+UnlockExperimentalVMOptions');
  if (toggles.parallel_ref_proc) pushUnique('-XX:+ParallelRefProcEnabled');
  if (toggles.always_pre_touch) pushUnique('-XX:+AlwaysPreTouch');
  if (toggles.disable_explicit_gc) pushUnique('-XX:+DisableExplicitGC');
  if (toggles.perf_disable_shared_mem) pushUnique('-XX:+PerfDisableSharedMem');
  if (toggles.use_string_deduplication) pushUnique('-XX:+UseStringDeduplication');
  if (config.gc !== 'aikar') {
    if (toggles.max_gc_pause_millis !== null) {
      pushUnique(`-XX:MaxGCPauseMillis=${toggles.max_gc_pause_millis}`);
    }
    if (toggles.g1_heap_region_size_mb !== null) {
      pushUnique(`-XX:G1HeapRegionSize=${toggles.g1_heap_region_size_mb}M`);
    }
  }
  if (toggles.simd_vector_module) pushUnique('--add-modules=jdk.incubator.vector');
  if (toggles.user_home_container) pushUnique('-Duser.home=/home/container');
  if (toggles.file_encoding_utf8) pushUnique('-Dfile.encoding=UTF-8');
  if (toggles.terminal_jline_false) pushUnique('-Dterminal.jline=false');
  if (toggles.log4j_no_lookups) pushUnique('-Dlog4j2.formatMsgNoLookups=true');

  for (const flag of config.custom_flags) {
    pushUnique(flag);
  }

  return flags;
}

export function buildStartupCommand(
  config: FlagConfig,
  template: Pick<ParsedStartup, 'leading_prefix' | 'java_binary' | 'trailing_target'>,
  javaVersion: number | null,
  serverMemoryMb: number,
): string {
  const parts: string[] = [];
  if (template.leading_prefix.trim()) parts.push(template.leading_prefix.trim());
  parts.push(template.java_binary.trim() || 'java');
  parts.push(...buildJvmFlags(config, javaVersion, serverMemoryMb));
  if (template.trailing_target.trim()) parts.push(template.trailing_target.trim());
  return parts.join(' ');
}

export function validateConfig(
  config: FlagConfig,
  limits: ServerLimitsSettings,
  serverMemoryMb: number,
  previewCommand?: string,
): string[] {
  const errors: string[] = [];
  const cap = maxCustomXmxMb(serverMemoryMb, limits.memory_overhead_mb);

  if (config.memory_mode === 'percentage') {
    if (
      !Number.isFinite(config.max_ram_percentage) ||
      config.max_ram_percentage < 10 ||
      config.max_ram_percentage > limits.max_ram_percentage
    ) {
      errors.push(`MaxRAMPercentage must be between 10% and ${limits.max_ram_percentage.toFixed(1)}%.`);
    }
    if (config.xms_mb < 64) errors.push('Initial heap (-Xms) must be at least 64 MiB.');
    if (cap !== null && config.xms_mb > cap) {
      errors.push(`Initial heap (-Xms ${config.xms_mb} MiB) exceeds safe container heap cap (${cap} MiB).`);
    }
  } else if (config.memory_mode === 'custom') {
    if (!limits.allow_custom_memory) {
      errors.push('Custom memory limits are disabled by the administrator.');
    }
    if (config.xms_mb < 64) errors.push('Initial heap (-Xms) must be at least 64 MiB.');
    if (config.xmx_mb < 128) errors.push('Maximum heap (-Xmx) must be at least 128 MiB.');
    if (config.xms_mb > config.xmx_mb) {
      errors.push(`Initial heap (-Xms ${config.xms_mb} MiB) cannot exceed maximum heap (-Xmx ${config.xmx_mb} MiB).`);
    }
    if (cap !== null && config.xmx_mb > cap) {
      errors.push(
        `Maximum heap (-Xmx ${config.xmx_mb} MiB) exceeds safe container heap cap (${cap} MiB with ${limits.memory_overhead_mb} MiB overhead).`,
      );
    }
  } else if (!config.template_match_xms && config.xms_mb < 64) {
    errors.push('Initial heap (-Xms) must be at least 64 MiB.');
  }

  if (
    config.toggles.max_gc_pause_millis !== null &&
    (config.toggles.max_gc_pause_millis < 10 || config.toggles.max_gc_pause_millis > 2000)
  ) {
    errors.push('MaxGCPauseMillis must be between 10 and 2000 ms.');
  }
  if (
    config.toggles.g1_heap_region_size_mb !== null &&
    !(VALID_G1_REGION_SIZES_MB as readonly number[]).includes(config.toggles.g1_heap_region_size_mb)
  ) {
    errors.push('G1HeapRegionSize must be 1, 2, 4, 8, 16, or 32 MiB.');
  }

  if (!limits.allow_custom_flags && config.custom_flags.length > 0) {
    errors.push('Custom JVM flags are disabled by the administrator.');
  }
  if (config.custom_flags.length > MAX_CUSTOM_FLAGS) {
    errors.push(`At most ${MAX_CUSTOM_FLAGS} custom JVM flags are allowed.`);
  }
  for (const flag of config.custom_flags) {
    const err = validateCustomFlag(flag, limits.extra_blocked_flags);
    if (err) errors.push(err);
  }
  if (previewCommand && previewCommand.length > MAX_COMMAND_LEN) {
    errors.push(`Generated startup command exceeds maximum length of ${MAX_COMMAND_LEN} characters.`);
  }

  return errors;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function encodeShareCode(config: FlagConfig, meta?: { name?: string; description?: string }): string {
  const payload: SharePayload = {
    v: 1,
    ...(meta?.name?.trim() ? { name: meta.name.trim() } : {}),
    ...(meta?.description?.trim() ? { description: meta.description.trim() } : {}),
    config,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return `${SHARE_PREFIX}${bytesToBase64Url(bytes)}`;
}

export function decodeShareCode(raw: string): SharePayload {
  const trimmed = raw.trim();
  if (!trimmed.startsWith(SHARE_PREFIX)) {
    throw new Error('Share code must start with mcflags:v1:');
  }
  const encoded = trimmed.slice(SHARE_PREFIX.length);
  if (!encoded || encoded.length > 24_576) {
    throw new Error('Share code payload is empty or too large.');
  }
  const json = new TextDecoder().decode(base64UrlToBytes(encoded));
  const parsed = JSON.parse(json) as SharePayload;
  if (!parsed || typeof parsed !== 'object' || parsed.v !== 1 || !parsed.config) {
    throw new Error('Invalid or unsupported share code payload.');
  }
  return parsed;
}

export function formatMemoryLabel(mb: number): string {
  if (mb >= 1024 && mb % 1024 === 0) {
    return `${mb / 1024} GB`;
  }
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }
  return `${mb} MB`;
}

export function summarizeActiveConfig(config: FlagConfig, serverMemoryMb: number): string {
  const profileLabel = (() => {
    switch (config.preset_id) {
      case 'vanilla':
        return 'Vanilla';
      case 'aikars':
        return "Aikar's Flags";
      case 'zgc':
        return 'Generational ZGC';
      case 'shenandoah':
        return 'Shenandoah GC';
      case 'modded_g1gc':
        return 'Modded G1GC';
      case 'proxy':
        return 'Proxy G1GC';
      case 'simd_aikars':
        return 'Paper SIMD';
      default:
        break;
    }
    switch (config.gc) {
      case 'aikar':
        return "Aikar's G1GC";
      case 'g1gc':
        return 'G1GC';
      case 'zgc':
        return 'ZGC';
      case 'shenandoah':
        return 'Shenandoah';
      case 'parallel':
        return 'Parallel GC';
      default:
        return 'Custom JVM';
    }
  })();

  const memoryLabel =
    config.memory_mode === 'percentage'
      ? `${formatPercentage(config.max_ram_percentage)}% RAM`
      : config.memory_mode === 'custom'
        ? formatMemoryLabel(config.xmx_mb)
        : serverMemoryMb > 0
          ? `${formatMemoryLabel(serverMemoryMb)} (template)`
          : 'Auto template';

  return `${profileLabel} · ${memoryLabel}`;
}
