import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildJvmFlags,
  buildStartupCommand,
  decodeShareCode,
  defaultConfig,
  defaultToggles,
  detectJavaVersion,
  encodeShareCode,
  isServerEligible,
  maxCustomXmxMb,
  parseStartupCommand,
  summarizeActiveConfig,
  validateConfig,
  validateCustomFlag,
} from '../frontend/src/lib/flags.ts';

const defaultLimits = {
  allow_custom_flags: true,
  allow_custom_memory: true,
  memory_overhead_mb: 512,
  max_ram_percentage: 95.0,
  max_presets_per_user: 25,
  max_custom_xmx_mb: 3584,
  extra_blocked_flags: ['-Dblocked.by.admin'],
};

describe('MC Startup Flags frontend library', () => {
  test('detects Java major versions from Docker images', () => {
    assert.equal(detectJavaVersion('ghcr.io/caloptreyx/java:21'), 21);
    assert.equal(detectJavaVersion('ghcr.io/pterodactyl/yolks:java_17'), 17);
    assert.equal(detectJavaVersion('eclipse-temurin:25'), 25);
    assert.equal(detectJavaVersion('eclipse-temurin:21.0.4_7-jre-alpine'), 21);
    assert.equal(detectJavaVersion('my-registry.internal:5000/java:17'), 17);
    assert.equal(detectJavaVersion('openjdk:8-jre'), 8);
    assert.equal(detectJavaVersion('ghcr.io/pterodactyl/yolks:nodejs_20'), null);
  });

  test('checks server eligibility with egg allowlist and auto-detection', () => {
    assert.equal(
      isServerEligible({ egg: { uuid: 'egg-1', features: [] }, startup: 'node index.js', image: 'node:22' }, ['egg-1']),
      true,
    );
    assert.equal(
      isServerEligible(
        { egg: { uuid: 'egg-2', features: ['eula'] }, startup: 'java -jar server.jar', image: 'java:21' },
        ['egg-1'],
      ),
      false,
    );
    assert.equal(
      isServerEligible({ egg: { uuid: 'egg-2', features: ['java_version'] }, startup: './run.sh', image: 'alpine' }, []),
      true,
    );
    assert.equal(
      isServerEligible(
        { egg: { uuid: 'egg-2', features: [] }, startup: 'FOO=1 /opt/java/bin/java -jar paper.jar', image: 'alpine' },
        [],
      ),
      true,
    );
    assert.equal(
      isServerEligible({ egg: { uuid: 'egg-2', features: [] }, startup: 'node app.js', image: 'node:20' }, []),
      false,
    );
  });

  test('parses and rebuilds vanilla, Forge argfile, and template startup commands', () => {
    const forge =
      'TZ=UTC /opt/java/bin/java -Xms4G -Xmx4G -XX:+UseG1GC -XX:+AlwaysPreTouch @libraries/net/minecraftforge/forge/1.20.1/unix_args.txt "$@"';
    const parsed = parseStartupCommand(forge, 6144);
    assert.equal(parsed.parseable, true);
    assert.equal(parsed.leading_prefix, 'TZ=UTC');
    assert.equal(parsed.java_binary, '/opt/java/bin/java');
    assert.equal(parsed.trailing_target, '@libraries/net/minecraftforge/forge/1.20.1/unix_args.txt "$@"');
    assert.equal(parsed.config.memory_mode, 'custom');
    assert.equal(parsed.config.xms_mb, 4096);
    assert.equal(parsed.config.xmx_mb, 4096);
    assert.equal(parsed.config.gc, 'g1gc');

    const rebuilt = buildStartupCommand(parsed.config, parsed, 21, 6144);
    assert.ok(rebuilt.startsWith('TZ=UTC /opt/java/bin/java -Xms4096M -Xmx4096M'));
    assert.ok(rebuilt.endsWith('@libraries/net/minecraftforge/forge/1.20.1/unix_args.txt "$@"'));

    const tpl = parseStartupCommand('java -Xms{{SERVER_MEMORY}}M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}} nogui', 8192);
    assert.equal(tpl.config.memory_mode, 'template');
    assert.equal(tpl.config.template_match_xms, true);
  });

  test('switches Aikar flags at 12 GB and omits ZGenerational on Java 24+', () => {
    const aikarSmall = defaultConfig({
      preset_id: 'aikars',
      gc: 'aikar',
      memory_mode: 'custom',
      xms_mb: 8192,
      xmx_mb: 8192,
      toggles: defaultToggles({ always_pre_touch: true, disable_explicit_gc: true }),
    });
    const smallFlags = buildJvmFlags(aikarSmall, 21, 10240);
    assert.ok(smallFlags.includes('-XX:G1HeapRegionSize=8M'));
    assert.ok(smallFlags.includes('-XX:G1NewSizePercent=30'));

    const aikarLarge = { ...aikarSmall, xms_mb: 12288, xmx_mb: 12288 };
    const largeFlags = buildJvmFlags(aikarLarge, 21, 16384);
    assert.ok(largeFlags.includes('-XX:G1HeapRegionSize=16M'));
    assert.ok(largeFlags.includes('-XX:G1NewSizePercent=40'));

    const zgc = defaultConfig({ preset_id: 'zgc', gc: 'zgc' });
    assert.ok(buildJvmFlags(zgc, 21, 8192).includes('-XX:+ZGenerational'));
    assert.ok(!buildJvmFlags(zgc, 24, 8192).includes('-XX:+ZGenerational'));
  });

  test('enforces memory safety caps and security denylist', () => {
    assert.equal(maxCustomXmxMb(0, 512), null);
    assert.equal(maxCustomXmxMb(4096, 512), 3584);
    assert.equal(maxCustomXmxMb(512, 512), 512);
    assert.equal(maxCustomXmxMb(600, 512), 128);

    assert.equal(validateCustomFlag('-XX:+UseNUMA', defaultLimits.extra_blocked_flags), null);
    assert.notEqual(validateCustomFlag('-javaagent:/evil.jar', defaultLimits.extra_blocked_flags), null);
    assert.notEqual(validateCustomFlag('-Dfoo=bar;rm -rf /', defaultLimits.extra_blocked_flags), null);
    assert.notEqual(validateCustomFlag('-Dblocked.by.admin=1', defaultLimits.extra_blocked_flags), null);
    assert.notEqual(validateCustomFlag('-Xmx8G', defaultLimits.extra_blocked_flags), null);

    const overCap = defaultConfig({ memory_mode: 'custom', xms_mb: 2048, xmx_mb: 3900 });
    assert.ok(validateConfig(overCap, defaultLimits, 4096).length > 0);

    const valid = defaultConfig({ memory_mode: 'custom', xms_mb: 2048, xmx_mb: 3584 });
    assert.equal(validateConfig(valid, defaultLimits, 4096).length, 0);
  });

  test('encodes and decodes mcflags:v1 share codes and summarizes configs', () => {
    const cfg = defaultConfig({
      preset_id: 'aikars',
      gc: 'aikar',
      memory_mode: 'custom',
      xms_mb: 6144,
      xmx_mb: 6144,
    });
    const code = encodeShareCode(cfg, { name: 'Survival 6G', description: 'Paper tuning' });
    assert.ok(code.startsWith('mcflags:v1:'));

    const decoded = decodeShareCode(code);
    assert.equal(decoded.v, 1);
    assert.equal(decoded.name, 'Survival 6G');
    assert.equal(decoded.description, 'Paper tuning');
    assert.equal(decoded.config.xmx_mb, 6144);
    assert.equal(decoded.config.gc, 'aikar');

    assert.equal(summarizeActiveConfig(cfg, 8192), "Aikar's Flags · 6 GB");
  });
});
