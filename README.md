# MC Startup Flags

An interactive Minecraft JVM startup flag editor for [Calagopus Panel](https://calagopus.com). Choose from curated performance presets, configure heap sizing with container memory headroom safety, customize JVM flags with strict security validation, and save or share reusable presets across all of your servers.

## Features

- **Startup Page Shortcut Card**: Adds a clickable **Startup Flag Editor** card to the top of eligible servers' Startup page showing the active profile and heap summary.
- **Curated Performance Presets**:
  - **Vanilla / Default** — clean minimal startup with automatic `MaxRAMPercentage` and `-Duser.home=/home/container`
  - **Aikar's Flags (G1GC)** — automatically switches between `<12 GB` and `>=12 GB` G1GC heap tuning parameters
  - **Generational ZGC** (Java 21+) — automatically omits `-XX:+ZGenerational` on Java 24+ and warns on Java `<21`
  - **Shenandoah GC** (Java 17+) — concurrent incremental-update mode (`-XX:ShenandoahGCMode=iu`)
  - **Modded G1GC** — tuned for large Forge, NeoForge, and Fabric modpacks
  - **Proxy (Velocity / Waterfall / BungeeCord)** — low-latency G1GC with 4 MiB regions and deeper inlining
  - **Paper / Pufferfish SIMD** — Aikar's Flags plus `--add-modules=jdk.incubator.vector`
- **Safe Command Rewriting**: Preserves the egg's Java binary, leading environment assignments, and launch target (`-jar {{SERVER_JARFILE}} nogui`, Forge/NeoForge `@libraries/.../unix_args.txt "$@"`, quoted paths), working even when `allow_custom_startup_command` is disabled on the egg.
- **Heap & Container Headroom Protection**:
  - Supports **Automatic (`MaxRAMPercentage`)**, **Custom (`-Xms`/`-Xmx`)**, and **Template (`{{SERVER_MEMORY}}`)** modes.
  - Enforces `xms <= xmx`, caps custom `-Xmx` to preserve admin-configured container overhead, and enforces the admin `MaxRAMPercentage` ceiling.
- **Strict Security Validation**:
  - Blocks shell metacharacters, whitespace injection, non-JVM flags, memory-override bypasses, a hardcoded security denylist (`-javaagent`, `-agentlib`, `-agentpath`, `-XX:OnOutOfMemoryError`, `-XX:OnError`, `-Xlog`, `-cp`/`-classpath`, `@argfile`, etc.), and administrator-configured extra blocked prefixes.
- **Saved Custom Presets & Import / Export**:
  - Account-scoped presets stored in PostgreSQL work across all of a user's servers.
  - Export as compact `mcflags:v1:<base64url>` share codes or formatted JSON.
  - Import share codes, JSON presets, or raw `java ...` commands with automatic memory clamping and security filtering preview.

## Permissions

Server permission group `startup-flags`:

| Permission | Description |
| --- | --- |
| `startup-flags.read` | View startup flags, curated presets, and the flag builder. |
| `startup-flags.update` | Apply JVM startup flags or reset to the egg's default startup command. |
| `startup-flags.presets` | Save, edit, delete, import, and export custom startup flag presets. |

## Admin Settings

Configured in **Admin → Extensions → MC Startup Flags** (`extensions.read` / `extensions.manage`):

| Setting | Default | Description |
| --- | --- | --- |
| `eggs` | `[]` (auto-detect) | Restrict to specific egg UUIDs; leave empty for automatic Java/Minecraft detection. |
| `allow_custom_flags` | `true` | Allow arbitrary validated custom JVM flags. |
| `allow_custom_memory` | `true` | Allow explicit `-Xms`/`-Xmx` custom memory sizing. |
| `memory_overhead_mb` | `512` | Reserved container overhead (0–16384 MiB) when capping custom `-Xmx`. |
| `max_ram_percentage` | `95.0` | Upper ceiling (50.0–100.0%) for `-XX:MaxRAMPercentage`. |
| `max_presets_per_user` | `25` | Maximum saved presets per user account (1–200). |
| `extra_blocked_flags` | `[]` | Additional case-insensitive JVM flag prefixes blocked on top of the built-in denylist. |

## Building a Manual Package

```bash
python3 scripts/package.py
```

Produces `dist/dev_caloptreyx_startupflags.c7s.zip`.
