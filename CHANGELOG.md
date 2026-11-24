# Changelog

## 0.1.0

- First version: interactive Minecraft JVM Startup Flag Editor for Calagopus Panel (`>=1.2.10`).
- Curated presets for Vanilla, Aikar's Flags (automatic `<12 GB` / `>=12 GB` sizing), Generational ZGC (Java 21+, auto-omitting `-XX:+ZGenerational` on Java 24+), Shenandoah GC, Modded G1GC, Proxy (Velocity / Waterfall / BungeeCord), and Paper / Pufferfish SIMD.
- Safe startup command parser and builder preserving Java binaries, leading env vars, `-jar` targets, and Forge/NeoForge `@libraries/.../unix_args.txt` argfiles even when custom startup commands are disabled on the egg.
- Automatic (`MaxRAMPercentage`), Custom (`-Xms`/`-Xmx` with container headroom protection), and Template (`{{SERVER_MEMORY}}`) memory modes.
- Strict backend and frontend security sanitizer blocking shell metacharacters, invalid prefixes, hardcoded dangerous JVM options, and admin-configured extra blocked prefixes.
- Account-scoped saved custom presets (`dev_caloptreyx_startupflags_presets`) with `mcflags:v1:` share code, JSON, and raw `java ...` command import/export.
- Clickable **Startup Flag Editor** card on the server Startup page, eligibility-filtered sidebar route, `startup-flags.{read,update,presets}` server permissions, and admin extension configuration page.
