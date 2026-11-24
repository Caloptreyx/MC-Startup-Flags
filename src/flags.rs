//! Minecraft JVM startup command parser, builder, curated presets, security sanitizer, and
//! share-code import/export helpers.
use crate::settings::Settings;
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};

pub const MAX_CUSTOM_FLAGS: usize = 64;
pub const MAX_COMMAND_LEN: usize = 8192;
pub const SHARE_PREFIX: &str = "mcflags:v1:";
pub const AIKAR_HIGH_MEMORY_THRESHOLD_MB: u32 = 12 * 1024;

/// Allowed JVM flag prefixes for custom flags.
const ALLOWED_EXACT_FLAGS: &[&str] = &["--enable-preview", "-ea", "-da", "-server"];

const ALLOWED_VALUE_PREFIXES: &[&str] = &[
    "--add-opens=",
    "--add-exports=",
    "--add-modules=",
    "--enable-native-access=",
];

/// Hardcoded security denylist (always blocked, case-insensitive prefix match).
pub const HARDCODED_DENYLIST: &[&str] = &[
    "-javaagent",
    "-agentlib",
    "-agentpath",
    "-xx:onoutofmemoryerror",
    "-xx:onerror",
    "-xx:heapdumppath",
    "-xx:errorfile",
    "-xlog",
    "-xx:compilecommand",
    "-xx:flags",
    "-xx:sharedarchivefile",
    "-xx:archiveclassesatexit",
    "-djava.library.path",
    "-djava.ext.dirs",
    "-djava.endorsed.dirs",
    "-djava.security",
    "-xbootclasspath",
    "-cp",
    "-classpath",
    "--class-path",
    "--module-path",
    "-p",
    "@",
];

/// Memory flags are managed exclusively through the Memory section so container limits cannot be
/// bypassed via custom flags.
const MEMORY_OVERRIDE_PREFIXES: &[&str] = &[
    "-xms",
    "-xmx",
    "-xx:maxrampercentage",
    "-xx:initialrampercentage",
    "-xx:minrampercentage",
    "-xx:maxheapsize",
    "-xx:initialheapsize",
    "-xx:maxram=",
];

const SHELL_METACHARS: &[char] = &[
    ';', '&', '|', '`', '$', '(', ')', '<', '>', '\n', '\r', '\'', '"', '\\', '\t', ' ',
];

const VALID_G1_REGION_SIZES_MB: &[u32] = &[1, 2, 4, 8, 16, 32];

fn default_xms_mb() -> u32 {
    128
}

fn default_xmx_mb() -> u32 {
    2048
}

fn default_ram_percentage() -> f32 {
    95.0
}

fn default_true() -> bool {
    true
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryMode {
    Percentage,
    Custom,
    Template,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GcKind {
    Default,
    Aikar,
    G1gc,
    Zgc,
    Shenandoah,
    Parallel,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FlagToggles {
    #[serde(default)]
    pub always_pre_touch: bool,
    #[serde(default)]
    pub disable_explicit_gc: bool,
    #[serde(default)]
    pub parallel_ref_proc: bool,
    #[serde(default)]
    pub perf_disable_shared_mem: bool,
    #[serde(default)]
    pub use_string_deduplication: bool,
    #[serde(default)]
    pub unlock_experimental: bool,
    #[serde(default = "default_true")]
    pub user_home_container: bool,
    #[serde(default)]
    pub file_encoding_utf8: bool,
    #[serde(default)]
    pub terminal_jline_false: bool,
    #[serde(default)]
    pub log4j_no_lookups: bool,
    #[serde(default)]
    pub simd_vector_module: bool,
    #[serde(default)]
    pub max_gc_pause_millis: Option<u32>,
    #[serde(default)]
    pub g1_heap_region_size_mb: Option<u32>,
}

impl Default for FlagToggles {
    fn default() -> Self {
        Self {
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
            max_gc_pause_millis: None,
            g1_heap_region_size_mb: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FlagConfig {
    #[serde(default)]
    pub preset_id: Option<String>,
    pub memory_mode: MemoryMode,
    #[serde(default = "default_xms_mb")]
    pub xms_mb: u32,
    #[serde(default = "default_xmx_mb")]
    pub xmx_mb: u32,
    #[serde(default = "default_ram_percentage")]
    pub max_ram_percentage: f32,
    #[serde(default)]
    pub template_match_xms: bool,
    pub gc: GcKind,
    #[serde(default)]
    pub toggles: FlagToggles,
    #[serde(default)]
    pub custom_flags: Vec<String>,
}

impl Default for FlagConfig {
    fn default() -> Self {
        Self {
            preset_id: Some("vanilla".into()),
            memory_mode: MemoryMode::Percentage,
            xms_mb: 128,
            xmx_mb: 2048,
            max_ram_percentage: 95.0,
            template_match_xms: false,
            gc: GcKind::Default,
            toggles: FlagToggles::default(),
            custom_flags: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct BuiltInPreset {
    pub id: &'static str,
    pub name: &'static str,
    pub tagline: &'static str,
    pub description: &'static str,
    pub workloads: &'static [&'static str],
    pub min_java: Option<u32>,
    pub max_recommended_java: Option<u32>,
    pub recommends_match_xms: bool,
    pub config: FlagConfig,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ParsedStartup {
    pub parseable: bool,
    pub leading_prefix: String,
    pub java_binary: String,
    pub trailing_target: String,
    pub config: FlagConfig,
    pub unrecognized_flags: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SharePayload {
    pub v: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub config: FlagConfig,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RejectedFlag {
    pub flag: String,
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ParsedImportResult {
    pub source_format: &'static str,
    pub name: Option<String>,
    pub description: Option<String>,
    pub config: FlagConfig,
    pub preview_command: String,
    pub warnings: Vec<String>,
    pub rejected_flags: Vec<RejectedFlag>,
}

/// Returns the 7 curated built-in presets.
pub fn builtin_presets() -> Vec<BuiltInPreset> {
    vec![
        BuiltInPreset {
            id: "vanilla",
            name: "Vanilla / Default",
            tagline: "Clean minimal startup with automatic container memory sizing.",
            description: "Minimal JVM configuration using automatic MaxRAMPercentage sizing and Calagopus container home safety.",
            workloads: &["vanilla", "paper"],
            min_java: None,
            max_recommended_java: None,
            recommends_match_xms: false,
            config: FlagConfig {
                preset_id: Some("vanilla".into()),
                memory_mode: MemoryMode::Percentage,
                xms_mb: 128,
                xmx_mb: 2048,
                max_ram_percentage: 95.0,
                template_match_xms: false,
                gc: GcKind::Default,
                toggles: FlagToggles {
                    user_home_container: true,
                    ..FlagToggles::default()
                },
                custom_flags: Vec::new(),
            },
        },
        BuiltInPreset {
            id: "aikars",
            name: "Aikar's Flags (G1GC)",
            tagline: "Battle-tested G1GC tuning for Paper, Purpur, Spigot, and Fabric.",
            description: "Automatically switches between <12 GB and >=12 GB G1GC heap parameters to keep garbage collection pauses smooth. Recommends matching Xms and Xmx.",
            workloads: &["paper", "vanilla"],
            min_java: None,
            max_recommended_java: None,
            recommends_match_xms: true,
            config: FlagConfig {
                preset_id: Some("aikars".into()),
                memory_mode: MemoryMode::Percentage,
                xms_mb: 128,
                xmx_mb: 4096,
                max_ram_percentage: 95.0,
                template_match_xms: true,
                gc: GcKind::Aikar,
                toggles: FlagToggles {
                    always_pre_touch: true,
                    disable_explicit_gc: true,
                    parallel_ref_proc: true,
                    perf_disable_shared_mem: true,
                    unlock_experimental: true,
                    user_home_container: true,
                    max_gc_pause_millis: Some(200),
                    ..FlagToggles::default()
                },
                custom_flags: Vec::new(),
            },
        },
        BuiltInPreset {
            id: "zgc",
            name: "Generational ZGC",
            tagline: "Ultra-low pause collector for Java 21+ servers with headroom.",
            description: "Uses Generational ZGC for sub-millisecond GC pauses on modern Java runtimes. Automatically omits -XX:+ZGenerational on Java 24+ where it is the default.",
            workloads: &["paper", "modded", "vanilla"],
            min_java: Some(21),
            max_recommended_java: None,
            recommends_match_xms: true,
            config: FlagConfig {
                preset_id: Some("zgc".into()),
                memory_mode: MemoryMode::Percentage,
                xms_mb: 128,
                xmx_mb: 4096,
                max_ram_percentage: 95.0,
                template_match_xms: true,
                gc: GcKind::Zgc,
                toggles: FlagToggles {
                    always_pre_touch: true,
                    disable_explicit_gc: true,
                    perf_disable_shared_mem: true,
                    user_home_container: true,
                    ..FlagToggles::default()
                },
                custom_flags: Vec::new(),
            },
        },
        BuiltInPreset {
            id: "shenandoah",
            name: "Shenandoah GC",
            tagline: "Concurrent low-pause collector tuned with incremental update mode.",
            description: "Keeps GC pause times consistently low independent of heap size using Shenandoah's incremental update mode (Java 17+).",
            workloads: &["paper", "modded"],
            min_java: Some(17),
            max_recommended_java: None,
            recommends_match_xms: true,
            config: FlagConfig {
                preset_id: Some("shenandoah".into()),
                memory_mode: MemoryMode::Percentage,
                xms_mb: 128,
                xmx_mb: 4096,
                max_ram_percentage: 95.0,
                template_match_xms: true,
                gc: GcKind::Shenandoah,
                toggles: FlagToggles {
                    always_pre_touch: true,
                    disable_explicit_gc: true,
                    parallel_ref_proc: true,
                    unlock_experimental: true,
                    user_home_container: true,
                    ..FlagToggles::default()
                },
                custom_flags: Vec::new(),
            },
        },
        BuiltInPreset {
            id: "modded_g1gc",
            name: "Modded G1GC (Large Modpacks)",
            tagline: "Tuned for heavy Forge, NeoForge, and Fabric modpacks.",
            description: "Combines 16 MiB G1 regions, string deduplication, and 100 ms pause targets to handle large modded object graphs without spikes.",
            workloads: &["modded"],
            min_java: None,
            max_recommended_java: None,
            recommends_match_xms: true,
            config: FlagConfig {
                preset_id: Some("modded_g1gc".into()),
                memory_mode: MemoryMode::Percentage,
                xms_mb: 128,
                xmx_mb: 6144,
                max_ram_percentage: 95.0,
                template_match_xms: true,
                gc: GcKind::G1gc,
                toggles: FlagToggles {
                    always_pre_touch: true,
                    disable_explicit_gc: true,
                    parallel_ref_proc: true,
                    use_string_deduplication: true,
                    unlock_experimental: true,
                    user_home_container: true,
                    max_gc_pause_millis: Some(100),
                    g1_heap_region_size_mb: Some(16),
                    ..FlagToggles::default()
                },
                custom_flags: Vec::new(),
            },
        },
        BuiltInPreset {
            id: "proxy",
            name: "Proxy (Velocity / Waterfall / BungeeCord)",
            tagline: "Lightweight low-latency G1GC profile for Minecraft proxies.",
            description: "Uses smaller 4 MiB G1 regions and deeper JIT inlining for high packet-forwarding throughput on Velocity, Waterfall, and BungeeCord.",
            workloads: &["proxy"],
            min_java: None,
            max_recommended_java: None,
            recommends_match_xms: false,
            config: FlagConfig {
                preset_id: Some("proxy".into()),
                memory_mode: MemoryMode::Percentage,
                xms_mb: 128,
                xmx_mb: 1024,
                max_ram_percentage: 95.0,
                template_match_xms: false,
                gc: GcKind::G1gc,
                toggles: FlagToggles {
                    always_pre_touch: true,
                    parallel_ref_proc: true,
                    unlock_experimental: true,
                    user_home_container: true,
                    g1_heap_region_size_mb: Some(4),
                    ..FlagToggles::default()
                },
                custom_flags: Vec::new(),
            },
        },
        BuiltInPreset {
            id: "simd_aikars",
            name: "Paper / Pufferfish SIMD",
            tagline: "Aikar's Flags plus Java Vector API SIMD acceleration.",
            description: "Extends Aikar's G1GC profile with --add-modules=jdk.incubator.vector for Pufferfish, Purpur, and Paper forks with SIMD optimizations (Java 17-21).",
            workloads: &["paper"],
            min_java: Some(17),
            max_recommended_java: Some(21),
            recommends_match_xms: true,
            config: FlagConfig {
                preset_id: Some("simd_aikars".into()),
                memory_mode: MemoryMode::Percentage,
                xms_mb: 128,
                xmx_mb: 4096,
                max_ram_percentage: 95.0,
                template_match_xms: true,
                gc: GcKind::Aikar,
                toggles: FlagToggles {
                    always_pre_touch: true,
                    disable_explicit_gc: true,
                    parallel_ref_proc: true,
                    perf_disable_shared_mem: true,
                    unlock_experimental: true,
                    user_home_container: true,
                    simd_vector_module: true,
                    max_gc_pause_millis: Some(200),
                    ..FlagToggles::default()
                },
                custom_flags: Vec::new(),
            },
        },
    ]
}

/// Maximum allowed custom `-Xmx` in MiB for a server with `server_memory_mb` (0 = unlimited).
pub fn max_custom_xmx_mb(server_memory_mb: u64, overhead_mb: u32) -> Option<u32> {
    if server_memory_mb == 0 {
        return None;
    }
    let mem = server_memory_mb.min(u64::from(u32::MAX)) as u32;
    let cap = if mem <= overhead_mb {
        mem
    } else {
        (mem - overhead_mb).max(128)
    };
    Some(cap)
}

/// Detects the Java major version from a Docker image string (e.g. `ghcr.io/caloptreyx/java:21`,
/// `ghcr.io/pterodactyl/yolks:java_17`, `eclipse-temurin:25-jre`, `openjdk:8-jre`).
pub fn detect_java_version(image: &str) -> Option<u32> {
    let trimmed = image.trim();
    if trimmed.is_empty() {
        return None;
    }
    // Strip digest `@sha256:...` if present.
    let without_digest = trimmed.split('@').next().unwrap_or(trimmed);
    let last_slash = without_digest.rfind('/');
    let (repo, tag) = match without_digest.rfind(':') {
        Some(colon) if last_slash.is_none_or(|slash| colon > slash) => (
            &without_digest[..colon],
            Some(&without_digest[colon + 1..]),
        ),
        _ => (without_digest, None),
    };

    // 1. Explicit `java[_:-]?N`, `jdk[_:-]?N`, `jre[_:-]?N`, `graalvm[_:-]?N` anywhere in tag or repo.
    if let Some(tag_str) = tag
        && let Some(v) = find_prefixed_java_number(tag_str)
    {
        return Some(v);
    }
    if let Some(v) = find_prefixed_java_number(repo) {
        return Some(v);
    }

    // 2. Known Java image repo + leading version in tag (`eclipse-temurin:25-jre`, `java:21`, `openjdk:8`).
    let repo_lower = repo.to_ascii_lowercase();
    let is_java_repo = [
        "java",
        "openjdk",
        "temurin",
        "corretto",
        "zulu",
        "graalvm",
        "sapmachine",
        "semeru",
        "liberica",
        "dragonwell",
    ]
    .iter()
    .any(|kw| repo_lower.contains(kw));

    if is_java_repo
        && let Some(tag_str) = tag
        && let Some(v) = parse_leading_java_major(tag_str)
    {
        return Some(v);
    }

    None
}

fn find_prefixed_java_number(haystack: &str) -> Option<u32> {
    let lower = haystack.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    for prefix in ["openjdk", "java", "jdk", "jre", "graalvm"] {
        let mut search_from = 0;
        while let Some(pos) = lower[search_from..].find(prefix) {
            let start = search_from + pos;
            let after_prefix = start + prefix.len();
            // Ensure prefix starts at a boundary (start of string or non-alphanumeric).
            let boundary_ok = start == 0 || !bytes[start - 1].is_ascii_alphanumeric();
            if boundary_ok && after_prefix < bytes.len() {
                let mut idx = after_prefix;
                if matches!(bytes[idx], b'_' | b'-' | b':' | b'/') {
                    idx += 1;
                }
                if let Some(v) = parse_leading_java_major(&lower[idx..]) {
                    return Some(v);
                }
            }
            search_from = after_prefix;
        }
    }
    None
}

fn parse_leading_java_major(s: &str) -> Option<u32> {
    if let Some(rest) = s.strip_prefix("1.") {
        let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(v) = digits.parse::<u32>()
            && (7..=99).contains(&v)
        {
            return Some(v);
        }
        return None;
    }
    let digits: String = s.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() || digits.len() > 2 {
        return None;
    }
    let rest = &s[digits.len()..];
    if let Some(next_char) = rest.chars().next()
        && next_char.is_ascii_alphabetic()
    {
        // Avoid matching random tokens like `20x` unless it's a version separator or `u` (e.g. `8u392`).
        if next_char != 'u' {
            return None;
        }
    }
    let v = digits.parse::<u32>().ok()?;
    (7..=99).contains(&v).then_some(v)
}

/// Checks whether a startup command starts with a Java executable (ignoring leading `KEY=VAL` env
/// assignments).
pub fn startup_starts_with_java(startup: &str) -> bool {
    let tokens = tokenize_with_spans(startup);
    for token in tokens {
        if is_env_assignment(&token.text) {
            continue;
        }
        return is_java_binary(&token.text);
    }
    false
}

fn is_env_assignment(token: &str) -> bool {
    let Some((name, _)) = token.split_once('=') else {
        return false;
    };
    !name.is_empty()
        && !name.starts_with('-')
        && name
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn is_java_binary(token: &str) -> bool {
    let unquoted = token.trim_matches(|c| c == '"' || c == '\'');
    let base = unquoted
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(unquoted)
        .to_ascii_lowercase();
    base == "java" || base == "java.exe" || base.starts_with("java") && base.ends_with("bin")
}

struct TokenSpan {
    text: String,
    start: usize,
    end: usize,
}

/// Shell-aware tokenizer that preserves byte offsets into the original command string so the
/// leading prefix and trailing launch target can be sliced verbatim.
fn tokenize_with_spans(input: &str) -> Vec<TokenSpan> {
    let mut tokens = Vec::new();
    let bytes = input.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        while i < len && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= len {
            break;
        }
        let start = i;
        let mut quote: Option<u8> = None;
        let mut subshell_depth: usize = 0;
        let mut text = String::new();

        while i < len {
            let b = bytes[i];
            if let Some(q) = quote {
                if b == b'\\' && q == b'"' && i + 1 < len {
                    text.push(bytes[i + 1] as char);
                    i += 2;
                    continue;
                }
                if b == q {
                    quote = None;
                    i += 1;
                    continue;
                }
                let ch = input[i..].chars().next().unwrap();
                text.push(ch);
                i += ch.len_utf8();
                continue;
            }

            if b == b'$' && i + 1 < len && bytes[i + 1] == b'(' {
                subshell_depth += 1;
                text.push_str("$(");
                i += 2;
                continue;
            }
            if subshell_depth > 0 {
                if b == b'(' {
                    subshell_depth += 1;
                } else if b == b')' {
                    subshell_depth -= 1;
                }
                let ch = input[i..].chars().next().unwrap();
                text.push(ch);
                i += ch.len_utf8();
                continue;
            }

            if b.is_ascii_whitespace() {
                break;
            }
            if b == b'\'' || b == b'"' {
                quote = Some(b);
                i += 1;
                continue;
            }
            if b == b'\\' && i + 1 < len {
                let ch = input[i + 1..].chars().next().unwrap();
                text.push(ch);
                i += 1 + ch.len_utf8();
                continue;
            }

            let ch = input[i..].chars().next().unwrap();
            text.push(ch);
            i += ch.len_utf8();
        }

        tokens.push(TokenSpan {
            text,
            start,
            end: i,
        });
    }

    tokens
}

/// Parses a JVM memory size string like `128M`, `4G`, `2048m`, `524288K`, `1073741824` into MiB.
pub fn parse_memory_mb(raw: &str) -> Option<u32> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let last = trimmed.chars().last()?;
    let (num_str, multiplier_div) = match last {
        'g' | 'G' => (&trimmed[..trimmed.len() - 1], (1024u64, 1u64)),
        'm' | 'M' => (&trimmed[..trimmed.len() - 1], (1u64, 1u64)),
        'k' | 'K' => (&trimmed[..trimmed.len() - 1], (1u64, 1024u64)),
        't' | 'T' => (&trimmed[..trimmed.len() - 1], (1024u64 * 1024, 1u64)),
        c if c.is_ascii_digit() => (trimmed, (1u64, 1024u64 * 1024)),
        _ => return None,
    };
    let n: u64 = num_str.parse().ok()?;
    let mb = (n.checked_mul(multiplier_div.0)?) / multiplier_div.1;
    let clamped = mb.max(1).min(u64::from(u32::MAX)) as u32;
    Some(clamped)
}

fn is_launch_target_token(token: &str) -> bool {
    if token.starts_with('@') || token.starts_with("$(") {
        return true;
    }
    if matches!(
        token,
        "-jar" | "-m" | "--module" | "-cp" | "-classpath" | "--class-path" | "-p" | "--module-path"
    ) {
        return true;
    }
    !token.starts_with('-')
}

/// Parses an existing `server.startup` command into its leading prefix, Java binary, trailing
/// launch target, and structured `FlagConfig`.
pub fn parse_startup_command(command: &str, server_memory_mb: u64) -> ParsedStartup {
    let trimmed = command.trim();
    let tokens = tokenize_with_spans(trimmed);

    let mut idx = 0;
    while idx < tokens.len() && is_env_assignment(&tokens[idx].text) {
        idx += 1;
    }

    if idx >= tokens.len() || !is_java_binary(&tokens[idx].text) {
        return ParsedStartup {
            parseable: false,
            leading_prefix: String::new(),
            java_binary: "java".into(),
            trailing_target: "-jar {{SERVER_JARFILE}} nogui".into(),
            config: default_config_for_memory(server_memory_mb),
            unrecognized_flags: Vec::new(),
        };
    }

    let java_idx = idx;
    let leading_prefix = if java_idx > 0 {
        trimmed[..tokens[java_idx].start].trim().to_string()
    } else {
        String::new()
    };
    let java_binary = trimmed[tokens[java_idx].start..tokens[java_idx].end].to_string();

    let mut target_idx = tokens.len();
    let mut jvm_tokens: Vec<&str> = Vec::new();
    let mut scan = java_idx + 1;
    while scan < tokens.len() {
        let tok = tokens[scan].text.as_str();
        if is_launch_target_token(tok) {
            target_idx = scan;
            break;
        }
        // Two-token options like `--add-modules jdk.incubator.vector`
        if matches!(
            tok,
            "--add-modules" | "--add-opens" | "--add-exports" | "--enable-native-access"
        ) && scan + 1 < tokens.len()
            && !tokens[scan + 1].text.starts_with('-')
        {
            // Normalize into `--flag=value` by keeping both raw pieces for parsing below.
            jvm_tokens.push(tok);
            jvm_tokens.push(tokens[scan + 1].text.as_str());
            scan += 2;
            continue;
        }
        jvm_tokens.push(tok);
        scan += 1;
    }

    let trailing_target = if target_idx < tokens.len() {
        trimmed[tokens[target_idx].start..].trim().to_string()
    } else {
        String::new()
    };

    let (config, unrecognized_flags) = parse_jvm_flag_tokens(&jvm_tokens, server_memory_mb);

    ParsedStartup {
        parseable: true,
        leading_prefix,
        java_binary,
        trailing_target,
        config,
        unrecognized_flags,
    }
}

fn default_config_for_memory(server_memory_mb: u64) -> FlagConfig {
    let default_xmx = if server_memory_mb > 0 {
        max_custom_xmx_mb(server_memory_mb, 512).unwrap_or(2048)
    } else {
        2048
    };
    FlagConfig {
        xmx_mb: default_xmx,
        ..FlagConfig::default()
    }
}

fn parse_jvm_flag_tokens(tokens: &[&str], server_memory_mb: u64) -> (FlagConfig, Vec<String>) {
    let mut normalized: Vec<String> = Vec::with_capacity(tokens.len());
    let mut i = 0;
    while i < tokens.len() {
        let tok = tokens[i];
        if matches!(
            tok,
            "--add-modules" | "--add-opens" | "--add-exports" | "--enable-native-access"
        ) && i + 1 < tokens.len()
        {
            normalized.push(format!("{tok}={}", tokens[i + 1]));
            i += 2;
        } else {
            normalized.push(tok.to_string());
            i += 1;
        }
    }

    let mut xms_mb: Option<u32> = None;
    let mut xmx_mb: Option<u32> = None;
    let mut xms_template = false;
    let mut xmx_template = false;
    let mut max_ram_pct: Option<f32> = None;

    let mut gc = GcKind::Default;
    let mut saw_g1 = false;
    let mut saw_zgc = false;
    let mut saw_shenandoah = false;
    let mut saw_parallel = false;
    let mut saw_aikars_marker = false;
    let mut saw_modded_g1 = false;
    let mut saw_proxy_inline = false;

    let mut toggles = FlagToggles {
        user_home_container: false,
        ..FlagToggles::default()
    };

    let mut leftover: Vec<String> = Vec::new();

    for flag in &normalized {
        let lower = flag.to_ascii_lowercase();

        // Memory flags
        if let Some(rest) = flag.strip_prefix("-Xms") {
            if rest.contains("{{SERVER_MEMORY}}") {
                xms_template = true;
            } else if let Some(mb) = parse_memory_mb(rest) {
                xms_mb = Some(mb);
            }
            continue;
        }
        if let Some(rest) = flag.strip_prefix("-Xmx") {
            if rest.contains("{{SERVER_MEMORY}}") {
                xmx_template = true;
            } else if let Some(mb) = parse_memory_mb(rest) {
                xmx_mb = Some(mb);
            }
            continue;
        }
        if let Some(rest) = lower.strip_prefix("-xx:maxrampercentage=") {
            if let Ok(pct) = rest.parse::<f32>()
                && pct.is_finite()
            {
                max_ram_pct = Some(pct);
            }
            continue;
        }
        if lower.starts_with("-xx:initialrampercentage=") || lower.starts_with("-xx:minrampercentage=")
        {
            // Ignore secondary percentage flags so they don't land in custom_flags.
            continue;
        }

        // GC flags
        if flag == "-XX:+UseG1GC" {
            saw_g1 = true;
            continue;
        }
        if flag == "-XX:+UseZGC" {
            saw_zgc = true;
            continue;
        }
        if flag == "-XX:+ZGenerational" {
            saw_zgc = true;
            continue;
        }
        if flag == "-XX:+UseShenandoahGC" || lower == "-xx:shenandoahgcmode=iu" {
            saw_shenandoah = true;
            continue;
        }
        if flag == "-XX:+UseParallelGC" {
            saw_parallel = true;
            continue;
        }

        // Toggleable JVM flags
        match flag.as_str() {
            "-XX:+AlwaysPreTouch" => {
                toggles.always_pre_touch = true;
                continue;
            }
            "-XX:+DisableExplicitGC" => {
                toggles.disable_explicit_gc = true;
                continue;
            }
            "-XX:+ParallelRefProcEnabled" => {
                toggles.parallel_ref_proc = true;
                continue;
            }
            "-XX:+PerfDisableSharedMem" => {
                toggles.perf_disable_shared_mem = true;
                continue;
            }
            "-XX:+UseStringDeduplication" => {
                toggles.use_string_deduplication = true;
                continue;
            }
            "-XX:+UnlockExperimentalVMOptions" => {
                toggles.unlock_experimental = true;
                continue;
            }
            "-Duser.home=/home/container" => {
                toggles.user_home_container = true;
                continue;
            }
            "-Dfile.encoding=UTF-8" => {
                toggles.file_encoding_utf8 = true;
                continue;
            }
            "-Dterminal.jline=false" => {
                toggles.terminal_jline_false = true;
                continue;
            }
            "-Dlog4j2.formatMsgNoLookups=true" => {
                toggles.log4j_no_lookups = true;
                continue;
            }
            "--add-modules=jdk.incubator.vector" => {
                toggles.simd_vector_module = true;
                continue;
            }
            _ => {}
        }

        if let Some(rest) = flag.strip_prefix("-XX:MaxGCPauseMillis=") {
            if let Ok(ms) = rest.parse::<u32>() {
                toggles.max_gc_pause_millis = Some(ms);
                continue;
            }
        }
        if let Some(rest) = flag.strip_prefix("-XX:G1HeapRegionSize=") {
            if let Some(mb) = parse_memory_mb(rest)
                && VALID_G1_REGION_SIZES_MB.contains(&mb)
            {
                toggles.g1_heap_region_size_mb = Some(mb);
                continue;
            }
        }

        // Preset markers & tuning flags recognized cleanly
        if flag == "-Dusing.aikars.flags=https://mcflags.emc.gs" || flag == "-Daikars.new.flags=true"
        {
            saw_aikars_marker = true;
            continue;
        }
        if flag == "-XX:MaxInlineLevel=15" {
            saw_proxy_inline = true;
            leftover.push(flag.clone());
            continue;
        }

        leftover.push(flag.clone());
    }

    // Determine GC & preset match
    let has_aikar_core = saw_g1
        && (saw_aikars_marker
            || (leftover.iter().any(|f| f == "-XX:SurvivorRatio=32")
                && leftover.iter().any(|f| f == "-XX:MaxTenuringThreshold=1")));

    if saw_zgc {
        gc = GcKind::Zgc;
    } else if saw_shenandoah {
        gc = GcKind::Shenandoah;
    } else if has_aikar_core {
        gc = GcKind::Aikar;
    } else if saw_g1 {
        gc = GcKind::G1gc;
    } else if saw_parallel {
        gc = GcKind::Parallel;
    }

    // Check if G1GC matches Modded G1GC tuning flags
    let modded_tuning = [
        "-XX:G1NewSizePercent=30",
        "-XX:G1MaxNewSizePercent=40",
        "-XX:G1ReservePercent=15",
        "-XX:InitiatingHeapOccupancyPercent=20",
    ];
    if gc == GcKind::G1gc && modded_tuning.iter().all(|f| leftover.iter().any(|x| x == f)) {
        saw_modded_g1 = true;
    }

    // Strip built-in tuning flags from `leftover` when they belong to the recognized GC/preset so
    // they do not duplicate or pollute `custom_flags`.
    let mut custom_flags = Vec::new();
    let mut unrecognized_flags = Vec::new();

    for flag in leftover {
        if gc == GcKind::Aikar && is_aikar_tuning_flag(&flag) {
            continue;
        }
        if saw_modded_g1 && modded_tuning.contains(&flag.as_str()) {
            continue;
        }
        if gc == GcKind::G1gc && saw_proxy_inline && flag == "-XX:MaxInlineLevel=15" {
            continue;
        }
        if validate_custom_flag(&flag, &[]).is_ok() {
            custom_flags.push(flag);
        } else {
            unrecognized_flags.push(flag);
        }
    }

    // If Aikar's flags used the standard G1HeapRegionSize (8M or 16M) leave it None so auto-sizing
    // adapts dynamically if RAM changes.
    if gc == GcKind::Aikar && matches!(toggles.g1_heap_region_size_mb, Some(8) | Some(16)) {
        toggles.g1_heap_region_size_mb = None;
    }

    // Determine memory mode
    let default_xmx = if server_memory_mb > 0 {
        max_custom_xmx_mb(server_memory_mb, 512).unwrap_or(2048)
    } else {
        2048
    };

    let (memory_mode, resolved_xms, resolved_xmx, resolved_pct, template_match_xms) =
        if xmx_template {
            (
                MemoryMode::Template,
                xms_mb.unwrap_or(128),
                default_xmx,
                95.0,
                xms_template,
            )
        } else if let Some(pct) = max_ram_pct {
            (
                MemoryMode::Percentage,
                xms_mb.unwrap_or(128),
                default_xmx,
                pct,
                false,
            )
        } else if let Some(xmx) = xmx_mb {
            (
                MemoryMode::Custom,
                xms_mb.unwrap_or(128).min(xmx),
                xmx,
                95.0,
                false,
            )
        } else {
            (
                MemoryMode::Percentage,
                xms_mb.unwrap_or(128),
                default_xmx,
                95.0,
                false,
            )
        };

    // Detect matching preset ID
    let preset_id = if gc == GcKind::Aikar {
        if toggles.simd_vector_module {
            Some("simd_aikars".into())
        } else {
            Some("aikars".into())
        }
    } else if gc == GcKind::Zgc {
        Some("zgc".into())
    } else if gc == GcKind::Shenandoah {
        Some("shenandoah".into())
    } else if saw_modded_g1 {
        Some("modded_g1gc".into())
    } else if gc == GcKind::G1gc && saw_proxy_inline {
        Some("proxy".into())
    } else if gc == GcKind::Default
        && !toggles.always_pre_touch
        && !toggles.disable_explicit_gc
        && !toggles.parallel_ref_proc
        && !toggles.perf_disable_shared_mem
        && !toggles.use_string_deduplication
        && !toggles.unlock_experimental
        && !toggles.simd_vector_module
        && toggles.max_gc_pause_millis.is_none()
        && toggles.g1_heap_region_size_mb.is_none()
        && custom_flags.is_empty()
    {
        Some("vanilla".into())
    } else {
        None
    };

    let config = FlagConfig {
        preset_id,
        memory_mode,
        xms_mb: resolved_xms,
        xmx_mb: resolved_xmx,
        max_ram_percentage: resolved_pct,
        template_match_xms,
        gc,
        toggles,
        custom_flags,
    };

    (config, unrecognized_flags)
}

fn is_aikar_tuning_flag(flag: &str) -> bool {
    matches!(
        flag,
        "-XX:G1NewSizePercent=30"
            | "-XX:G1NewSizePercent=40"
            | "-XX:G1MaxNewSizePercent=40"
            | "-XX:G1MaxNewSizePercent=50"
            | "-XX:G1ReservePercent=20"
            | "-XX:G1ReservePercent=15"
            | "-XX:G1HeapWastePercent=5"
            | "-XX:InitiatingHeapOccupancyPercent=15"
            | "-XX:InitiatingHeapOccupancyPercent=20"
            | "-XX:G1MixedGCCountTarget=4"
            | "-XX:G1MixedGCLiveThresholdPercent=90"
            | "-XX:G1RSetUpdatingPauseTimePercent=5"
            | "-XX:SurvivorRatio=32"
            | "-XX:MaxTenuringThreshold=1"
            | "-Dusing.aikars.flags=https://mcflags.emc.gs"
            | "-Daikars.new.flags=true"
    )
}

/// Validates a single custom JVM flag token against syntax, allowed prefixes, hardcoded security
/// denylist, memory-override rules, and admin extra blocked prefixes.
pub fn validate_custom_flag(flag: &str, extra_blocked_flags: &[String]) -> Result<(), String> {
    if flag.is_empty() {
        return Err("flag cannot be empty".into());
    }
    if flag.len() > 256 {
        return Err(format!("flag `{flag}` exceeds maximum length of 256 characters"));
    }
    if flag.chars().any(|c| c.is_control() || SHELL_METACHARS.contains(&c)) {
        return Err(format!(
            "flag `{flag}` contains forbidden shell metacharacters or whitespace"
        ));
    }

    let lower = flag.to_ascii_lowercase();

    for blocked in HARDCODED_DENYLIST {
        if matches_blocked_prefix(&lower, blocked) {
            return Err(format!(
                "flag `{flag}` is blocked for security reasons (matches `{blocked}`)"
            ));
        }
    }

    for blocked in extra_blocked_flags {
        let needle = blocked.trim().to_ascii_lowercase();
        if !needle.is_empty() && matches_blocked_prefix(&lower, &needle) {
            return Err(format!(
                "flag `{flag}` is blocked by administrator policy (matches `{}`)",
                blocked.trim()
            ));
        }
    }

    for mem_prefix in MEMORY_OVERRIDE_PREFIXES {
        if lower.starts_with(mem_prefix) {
            return Err(format!(
                "flag `{flag}` overrides JVM memory; configure heap size in the Heap & Memory section instead"
            ));
        }
    }

    if is_allowed_jvm_flag(flag) {
        Ok(())
    } else {
        Err(format!(
            "flag `{flag}` does not use an allowed JVM flag prefix (-X, -XX:, -D, --add-opens=, --add-exports=, --add-modules=, --enable-native-access=, --enable-preview, -ea, -da, -server)"
        ))
    }
}

fn matches_blocked_prefix(lower_flag: &str, lower_blocked: &str) -> bool {
    if lower_blocked == "-p" {
        return lower_flag == "-p" || lower_flag.starts_with("-p=");
    }
    if lower_blocked == "-cp" {
        return lower_flag == "-cp" || lower_flag.starts_with("-cp=") || lower_flag.starts_with("-cp:");
    }
    lower_flag.starts_with(lower_blocked)
}

fn is_allowed_jvm_flag(flag: &str) -> bool {
    if ALLOWED_EXACT_FLAGS.contains(&flag) {
        return true;
    }
    if flag.starts_with("-ea:") && flag.len() > 4 {
        return true;
    }
    if flag.starts_with("-da:") && flag.len() > 4 {
        return true;
    }
    for prefix in ALLOWED_VALUE_PREFIXES {
        if let Some(val) = flag.strip_prefix(prefix) {
            return !val.is_empty();
        }
    }
    if let Some(rest) = flag.strip_prefix("-XX:") {
        return !rest.is_empty();
    }
    if let Some(rest) = flag.strip_prefix("-X") {
        // `-X` followed by option name (not `-XX` without colon).
        return !rest.is_empty() && !rest.starts_with('X');
    }
    if let Some(rest) = flag.strip_prefix("-D") {
        let key = rest.split('=').next().unwrap_or("");
        return !key.is_empty()
            && key
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    }
    false
}

/// Validates a preset configuration for saving to a user's account (not tied to a single server's
/// RAM limit, so memory caps are only sanity-checked while security rules are strictly enforced).
pub fn validate_preset_config(config: &FlagConfig, settings: &Settings) -> Result<(), Vec<String>> {
    validate_config_inner(config, settings, None)
}

/// Validates a configuration before applying it to a specific server.
pub fn validate_config(
    config: &FlagConfig,
    settings: &Settings,
    server_memory_mb: u64,
) -> Result<(), Vec<String>> {
    validate_config_inner(config, settings, Some(server_memory_mb))
}

fn validate_config_inner(
    config: &FlagConfig,
    settings: &Settings,
    server_memory_mb: Option<u64>,
) -> Result<(), Vec<String>> {
    let mut errors = Vec::new();

    match config.memory_mode {
        MemoryMode::Percentage => {
            if !config.max_ram_percentage.is_finite()
                || config.max_ram_percentage < 10.0
                || config.max_ram_percentage > settings.max_ram_percentage
            {
                errors.push(format!(
                    "max_ram_percentage must be between 10.0 and {:.1}",
                    settings.max_ram_percentage
                ));
            }
            if config.xms_mb < 64 {
                errors.push("xms_mb must be at least 64 MiB".into());
            }
            if let Some(mem) = server_memory_mb
                && let Some(cap) = max_custom_xmx_mb(mem, settings.memory_overhead_mb)
                && config.xms_mb > cap
            {
                errors.push(format!(
                    "xms_mb ({} MiB) exceeds safe container heap cap ({cap} MiB)",
                    config.xms_mb
                ));
            }
        }
        MemoryMode::Custom => {
            if !settings.allow_custom_memory {
                errors.push("custom memory limits are disabled by the administrator".into());
            }
            if config.xms_mb < 64 {
                errors.push("xms_mb must be at least 64 MiB".into());
            }
            if config.xmx_mb < 128 {
                errors.push("xmx_mb must be at least 128 MiB".into());
            }
            if config.xms_mb > config.xmx_mb {
                errors.push(format!(
                    "xms_mb ({} MiB) cannot exceed xmx_mb ({} MiB)",
                    config.xms_mb, config.xmx_mb
                ));
            }
            if let Some(mem) = server_memory_mb
                && let Some(cap) = max_custom_xmx_mb(mem, settings.memory_overhead_mb)
                && config.xmx_mb > cap
            {
                errors.push(format!(
                    "xmx_mb ({} MiB) exceeds safe container heap cap ({cap} MiB for {mem} MiB server with {} MiB overhead)",
                    config.xmx_mb, settings.memory_overhead_mb
                ));
            }
        }
        MemoryMode::Template => {
            if !config.template_match_xms && config.xms_mb < 64 {
                errors.push("xms_mb must be at least 64 MiB".into());
            }
        }
    }

    if let Some(ms) = config.toggles.max_gc_pause_millis
        && !(10..=2000).contains(&ms)
    {
        errors.push("max_gc_pause_millis must be between 10 and 2000".into());
    }

    if let Some(region) = config.toggles.g1_heap_region_size_mb
        && !VALID_G1_REGION_SIZES_MB.contains(&region)
    {
        errors.push("g1_heap_region_size_mb must be one of 1, 2, 4, 8, 16, or 32".into());
    }

    if !settings.allow_custom_flags && !config.custom_flags.is_empty() {
        errors.push("custom JVM flags are disabled by the administrator".into());
    }

    if config.custom_flags.len() > MAX_CUSTOM_FLAGS {
        errors.push(format!(
            "at most {MAX_CUSTOM_FLAGS} custom JVM flags are allowed"
        ));
    }

    for flag in &config.custom_flags {
        if let Err(err) = validate_custom_flag(flag, &settings.extra_blocked_flags) {
            errors.push(err);
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

/// Estimates effective max heap in MiB for choosing Aikar `<12 GB` vs `>=12 GB` parameters.
pub fn effective_heap_mb(config: &FlagConfig, server_memory_mb: u64) -> u32 {
    match config.memory_mode {
        MemoryMode::Custom => config.xmx_mb,
        MemoryMode::Percentage => {
            if server_memory_mb > 0 {
                let raw = (server_memory_mb as f64) * (f64::from(config.max_ram_percentage) / 100.0);
                raw.round().clamp(128.0, f64::from(u32::MAX)) as u32
            } else {
                config.xmx_mb
            }
        }
        MemoryMode::Template => {
            if server_memory_mb > 0 {
                server_memory_mb.min(u64::from(u32::MAX)) as u32
            } else {
                config.xmx_mb
            }
        }
    }
}

fn format_percentage(pct: f32) -> String {
    let rounded = (pct * 10.0).round() / 10.0;
    format!("{rounded:.1}")
}

/// Builds the list of JVM flags for `config` (excluding leading binary and trailing target).
pub fn build_jvm_flags(
    config: &FlagConfig,
    java_version: Option<u32>,
    server_memory_mb: u64,
) -> Vec<String> {
    let mut flags: Vec<String> = Vec::new();
    let mut push_unique = |flag: String| {
        if !flags.contains(&flag) {
            flags.push(flag);
        }
    };

    // 1. Memory flags
    match config.memory_mode {
        MemoryMode::Percentage => {
            push_unique(format!("-Xms{}M", config.xms_mb));
            push_unique(format!(
                "-XX:MaxRAMPercentage={}",
                format_percentage(config.max_ram_percentage)
            ));
        }
        MemoryMode::Custom => {
            push_unique(format!("-Xms{}M", config.xms_mb));
            push_unique(format!("-Xmx{}M", config.xmx_mb));
        }
        MemoryMode::Template => {
            if config.template_match_xms {
                push_unique("-Xms{{SERVER_MEMORY}}M".into());
            } else {
                push_unique(format!("-Xms{}M", config.xms_mb));
            }
            push_unique("-Xmx{{SERVER_MEMORY}}M".into());
        }
    }

    let toggles = &config.toggles;
    let preset = config.preset_id.as_deref();

    // 2. Garbage Collector & preset tuning flags
    match config.gc {
        GcKind::Default => {}
        GcKind::Aikar => {
            let high_mem = effective_heap_mb(config, server_memory_mb) >= AIKAR_HIGH_MEMORY_THRESHOLD_MB;
            let pause_ms = toggles.max_gc_pause_millis.unwrap_or(200);
            let region_mb = toggles
                .g1_heap_region_size_mb
                .unwrap_or(if high_mem { 16 } else { 8 });

            push_unique("-XX:+UseG1GC".into());
            if toggles.parallel_ref_proc {
                push_unique("-XX:+ParallelRefProcEnabled".into());
            }
            push_unique(format!("-XX:MaxGCPauseMillis={pause_ms}"));
            if toggles.unlock_experimental {
                push_unique("-XX:+UnlockExperimentalVMOptions".into());
            }
            if toggles.disable_explicit_gc {
                push_unique("-XX:+DisableExplicitGC".into());
            }
            if toggles.always_pre_touch {
                push_unique("-XX:+AlwaysPreTouch".into());
            }
            push_unique(format!(
                "-XX:G1NewSizePercent={}",
                if high_mem { 40 } else { 30 }
            ));
            push_unique(format!(
                "-XX:G1MaxNewSizePercent={}",
                if high_mem { 50 } else { 40 }
            ));
            push_unique(format!("-XX:G1HeapRegionSize={region_mb}M"));
            push_unique(format!(
                "-XX:G1ReservePercent={}",
                if high_mem { 15 } else { 20 }
            ));
            push_unique("-XX:G1HeapWastePercent=5".into());
            push_unique("-XX:G1MixedGCCountTarget=4".into());
            push_unique(format!(
                "-XX:InitiatingHeapOccupancyPercent={}",
                if high_mem { 20 } else { 15 }
            ));
            push_unique("-XX:G1MixedGCLiveThresholdPercent=90".into());
            push_unique("-XX:G1RSetUpdatingPauseTimePercent=5".into());
            push_unique("-XX:SurvivorRatio=32".into());
            if toggles.perf_disable_shared_mem {
                push_unique("-XX:+PerfDisableSharedMem".into());
            }
            push_unique("-XX:MaxTenuringThreshold=1".into());
            push_unique("-Dusing.aikars.flags=https://mcflags.emc.gs".into());
            push_unique("-Daikars.new.flags=true".into());
        }
        GcKind::G1gc => {
            push_unique("-XX:+UseG1GC".into());
            if preset == Some("modded_g1gc") {
                push_unique("-XX:G1NewSizePercent=30".into());
                push_unique("-XX:G1MaxNewSizePercent=40".into());
                push_unique("-XX:G1ReservePercent=15".into());
                push_unique("-XX:InitiatingHeapOccupancyPercent=20".into());
            } else if preset == Some("proxy") {
                push_unique("-XX:MaxInlineLevel=15".into());
            }
        }
        GcKind::Zgc => {
            push_unique("-XX:+UseZGC".into());
            if java_version.is_none_or(|v| v < 24) {
                push_unique("-XX:+ZGenerational".into());
            }
        }
        GcKind::Shenandoah => {
            push_unique("-XX:+UseShenandoahGC".into());
            push_unique("-XX:ShenandoahGCMode=iu".into());
        }
        GcKind::Parallel => {
            push_unique("-XX:+UseParallelGC".into());
        }
    }

    // 3. Toggleable performance & runtime flags (deduplicated against GC block above)
    if toggles.unlock_experimental {
        push_unique("-XX:+UnlockExperimentalVMOptions".into());
    }
    if toggles.parallel_ref_proc {
        push_unique("-XX:+ParallelRefProcEnabled".into());
    }
    if toggles.always_pre_touch {
        push_unique("-XX:+AlwaysPreTouch".into());
    }
    if toggles.disable_explicit_gc {
        push_unique("-XX:+DisableExplicitGC".into());
    }
    if toggles.perf_disable_shared_mem {
        push_unique("-XX:+PerfDisableSharedMem".into());
    }
    if toggles.use_string_deduplication {
        push_unique("-XX:+UseStringDeduplication".into());
    }
    if config.gc != GcKind::Aikar {
        if let Some(ms) = toggles.max_gc_pause_millis {
            push_unique(format!("-XX:MaxGCPauseMillis={ms}"));
        }
        if let Some(region_mb) = toggles.g1_heap_region_size_mb {
            push_unique(format!("-XX:G1HeapRegionSize={region_mb}M"));
        }
    }
    if toggles.simd_vector_module {
        push_unique("--add-modules=jdk.incubator.vector".into());
    }
    if toggles.user_home_container {
        push_unique("-Duser.home=/home/container".into());
    }
    if toggles.file_encoding_utf8 {
        push_unique("-Dfile.encoding=UTF-8".into());
    }
    if toggles.terminal_jline_false {
        push_unique("-Dterminal.jline=false".into());
    }
    if toggles.log4j_no_lookups {
        push_unique("-Dlog4j2.formatMsgNoLookups=true".into());
    }

    // 4. Custom JVM flags
    for flag in &config.custom_flags {
        push_unique(flag.clone());
    }

    flags
}

/// Assembles the full startup command, preserving the leading prefix, Java binary, and trailing
/// launch target from `template`.
pub fn build_startup_command(
    config: &FlagConfig,
    template: &ParsedStartup,
    java_version: Option<u32>,
    server_memory_mb: u64,
) -> Result<String, String> {
    let mut parts: Vec<String> = Vec::new();
    if !template.leading_prefix.trim().is_empty() {
        parts.push(template.leading_prefix.trim().to_string());
    }
    let binary = if template.java_binary.trim().is_empty() {
        "java"
    } else {
        template.java_binary.trim()
    };
    parts.push(binary.to_string());
    parts.extend(build_jvm_flags(config, java_version, server_memory_mb));
    if !template.trailing_target.trim().is_empty() {
        parts.push(template.trailing_target.trim().to_string());
    }

    let command = parts.join(" ");
    if command.len() > MAX_COMMAND_LEN {
        return Err(format!(
            "generated startup command exceeds maximum length of {MAX_COMMAND_LEN} characters ({} chars)",
            command.len()
        ));
    }
    Ok(command)
}

/// Encodes a `FlagConfig` (with optional name & description) into a compact `mcflags:v1:<base64url>`
/// share string.
pub fn encode_share_code(
    config: &FlagConfig,
    name: Option<String>,
    description: Option<String>,
) -> Result<String, String> {
    let payload = SharePayload {
        v: 1,
        name: name.filter(|s| !s.trim().is_empty()),
        description: description.filter(|s| !s.trim().is_empty()),
        config: config.clone(),
    };
    let json = serde_json::to_vec(&payload).map_err(|err| format!("failed to encode payload: {err}"))?;
    Ok(format!("{SHARE_PREFIX}{}", URL_SAFE_NO_PAD.encode(json)))
}

/// Decodes a `mcflags:v1:<base64url>` share string.
pub fn decode_share_code(raw: &str) -> Result<SharePayload, String> {
    let trimmed = raw.trim();
    let encoded = trimmed
        .strip_prefix(SHARE_PREFIX)
        .ok_or_else(|| "share code must start with `mcflags:v1:`".to_string())?;
    if encoded.is_empty() || encoded.len() > 24_576 {
        return Err("share code payload is empty or too large".into());
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded.trim_end_matches('='))
        .map_err(|_| "share code is not valid base64url".to_string())?;
    let payload: SharePayload =
        serde_json::from_slice(&bytes).map_err(|err| format!("invalid share code JSON: {err}"))?;
    if payload.v != 1 {
        return Err(format!("unsupported share code version {}", payload.v));
    }
    Ok(payload)
}

/// Parses an imported share code, JSON payload, or raw `java ...` command / flag list, clamps
/// memory to this server's limits, strips blocked/invalid custom flags, and returns the normalized
/// configuration along with warnings and rejected flags.
pub fn parse_import_for_server(
    raw_input: &str,
    settings: &Settings,
    server_template: &ParsedStartup,
    server_memory_mb: u64,
    java_version: Option<u32>,
) -> Result<ParsedImportResult, String> {
    let trimmed = raw_input.trim();
    if trimmed.is_empty() {
        return Err("import input is empty".into());
    }

    let (source_format, name, description, mut config, mut rejected_flags) =
        if trimmed.starts_with(SHARE_PREFIX) {
            let payload = decode_share_code(trimmed)?;
            (
                "share_code",
                payload.name,
                payload.description,
                payload.config,
                Vec::new(),
            )
        } else if trimmed.starts_with('{') {
            if let Ok(payload) = serde_json::from_str::<SharePayload>(trimmed) {
                if payload.v != 1 {
                    return Err(format!("unsupported share payload version {}", payload.v));
                }
                (
                    "json",
                    payload.name,
                    payload.description,
                    payload.config,
                    Vec::new(),
                )
            } else {
                let cfg: FlagConfig = serde_json::from_str(trimmed)
                    .map_err(|err| format!("invalid JSON preset: {err}"))?;
                ("json", None, None, cfg, Vec::new())
            }
        } else {
            // Raw `java ...` command or bare JVM flag list.
            let synthetic = if startup_starts_with_java(trimmed) {
                trimmed.to_string()
            } else {
                format!("java {trimmed}")
            };
            let parsed = parse_startup_command(&synthetic, server_memory_mb);
            if !parsed.parseable {
                return Err("could not recognize input as a share code, JSON preset, or Java startup command".into());
            }
            let rejected = parsed
                .unrecognized_flags
                .into_iter()
                .map(|flag| {
                    let reason = validate_custom_flag(&flag, &settings.extra_blocked_flags)
                        .err()
                        .unwrap_or_else(|| "unrecognized or unsafe JVM flag".into());
                    RejectedFlag { flag, reason }
                })
                .collect();
            ("command", None, None, parsed.config, rejected)
        };

    let mut warnings: Vec<String> = Vec::new();

    // Clamp & normalize memory against server limits & admin settings
    match config.memory_mode {
        MemoryMode::Custom => {
            if !settings.allow_custom_memory {
                warnings.push(
                    "Switched memory mode to Automatic (MaxRAMPercentage) because custom memory is disabled by the administrator."
                        .into(),
                );
                config.memory_mode = MemoryMode::Percentage;
                config.max_ram_percentage = settings.max_ram_percentage.min(95.0);
                config.xms_mb = 128;
            } else {
                if config.xmx_mb < 128 {
                    warnings.push(format!("Raised Xmx from {} MiB to 128 MiB minimum.", config.xmx_mb));
                    config.xmx_mb = 128;
                }
                if let Some(cap) = max_custom_xmx_mb(server_memory_mb, settings.memory_overhead_mb)
                    && config.xmx_mb > cap
                {
                    warnings.push(format!(
                        "Clamped Xmx from {} MiB to {cap} MiB to preserve {} MiB container headroom.",
                        config.xmx_mb, settings.memory_overhead_mb
                    ));
                    config.xmx_mb = cap;
                }
                if config.xms_mb < 64 {
                    config.xms_mb = 64;
                }
                if config.xms_mb > config.xmx_mb {
                    warnings.push(format!(
                        "Clamped Xms from {} MiB to match Xmx ({} MiB).",
                        config.xms_mb, config.xmx_mb
                    ));
                    config.xms_mb = config.xmx_mb;
                }
            }
        }
        MemoryMode::Percentage => {
            if !config.max_ram_percentage.is_finite() || config.max_ram_percentage < 10.0 {
                config.max_ram_percentage = 80.0;
                warnings.push("Reset invalid MaxRAMPercentage to 80.0%.".into());
            } else if config.max_ram_percentage > settings.max_ram_percentage {
                warnings.push(format!(
                    "Clamped MaxRAMPercentage from {:.1}% to administrator ceiling {:.1}%.",
                    config.max_ram_percentage, settings.max_ram_percentage
                ));
                config.max_ram_percentage = settings.max_ram_percentage;
            }
            if config.xms_mb < 64 {
                config.xms_mb = 64;
            }
            if let Some(cap) = max_custom_xmx_mb(server_memory_mb, settings.memory_overhead_mb)
                && config.xms_mb > cap
            {
                warnings.push(format!(
                    "Clamped initial Xms from {} MiB to {cap} MiB.",
                    config.xms_mb
                ));
                config.xms_mb = cap;
            }
        }
        MemoryMode::Template => {
            if config.xms_mb < 64 {
                config.xms_mb = 64;
            }
        }
    }

    // Clamp numeric toggles
    if let Some(ms) = config.toggles.max_gc_pause_millis
        && !(10..=2000).contains(&ms)
    {
        let clamped = ms.clamp(10, 2000);
        warnings.push(format!(
            "Clamped MaxGCPauseMillis from {ms} to {clamped}."
        ));
        config.toggles.max_gc_pause_millis = Some(clamped);
    }
    if let Some(region) = config.toggles.g1_heap_region_size_mb
        && !VALID_G1_REGION_SIZES_MB.contains(&region)
    {
        warnings.push(format!(
            "Cleared invalid G1HeapRegionSize ({region}M; must be 1, 2, 4, 8, 16, or 32)."
        ));
        config.toggles.g1_heap_region_size_mb = None;
    }

    // Filter custom flags against security policy & admin settings
    let incoming_custom = std::mem::take(&mut config.custom_flags);
    for flag in incoming_custom {
        if !settings.allow_custom_flags {
            rejected_flags.push(RejectedFlag {
                flag,
                reason: "custom JVM flags are disabled by the administrator".into(),
            });
            continue;
        }
        if let Err(reason) = validate_custom_flag(&flag, &settings.extra_blocked_flags) {
            rejected_flags.push(RejectedFlag { flag, reason });
            continue;
        }
        if config.custom_flags.len() >= MAX_CUSTOM_FLAGS {
            rejected_flags.push(RejectedFlag {
                flag,
                reason: format!("exceeds maximum of {MAX_CUSTOM_FLAGS} custom flags"),
            });
            continue;
        }
        if !config.custom_flags.contains(&flag) {
            config.custom_flags.push(flag);
        }
    }

    // Java version compatibility note
    if let Some(v) = java_version {
        if config.gc == GcKind::Zgc && v < 21 {
            warnings.push(format!(
                "Generational ZGC requires Java 21 or newer, but this server uses Java {v}."
            ));
        } else if config.gc == GcKind::Shenandoah && v < 17 {
            warnings.push(format!(
                "Shenandoah GC preset recommends Java 17 or newer, but this server uses Java {v}."
            ));
        }
    }

    let preview_command =
        build_startup_command(&config, server_template, java_version, server_memory_mb)?;

    Ok(ParsedImportResult {
        source_format,
        name,
        description,
        config,
        preview_command,
        warnings,
        rejected_flags,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_vanilla_and_paper_commands_preserving_target() {
        let cmd = "java -Xms128M -XX:MaxRAMPercentage=95.0 -Duser.home=/home/container -Dterminal.jline=false -jar {{SERVER_JARFILE}} nogui";
        let parsed = parse_startup_command(cmd, 4096);
        assert!(parsed.parseable);
        assert_eq!(parsed.leading_prefix, "");
        assert_eq!(parsed.java_binary, "java");
        assert_eq!(parsed.trailing_target, "-jar {{SERVER_JARFILE}} nogui");
        assert_eq!(parsed.config.memory_mode, MemoryMode::Percentage);
        assert_eq!(parsed.config.xms_mb, 128);
        assert!((parsed.config.max_ram_percentage - 95.0).abs() < 0.01);
        assert!(parsed.config.toggles.user_home_container);
        assert!(parsed.config.toggles.terminal_jline_false);
        assert_eq!(parsed.config.preset_id.as_deref(), Some("vanilla"));
    }

    #[test]
    fn parses_forge_neoforge_argfiles_and_leading_env_and_quoted_args() {
        let forge = r#"TZ=UTC /opt/java/openjdk/bin/java -Xms4G -Xmx4G -XX:+UseG1GC -XX:+AlwaysPreTouch @libraries/net/minecraftforge/forge/1.20.1-47.2.0/unix_args.txt "$@""#;
        let parsed = parse_startup_command(forge, 6144);
        assert!(parsed.parseable);
        assert_eq!(parsed.leading_prefix, "TZ=UTC");
        assert_eq!(parsed.java_binary, "/opt/java/openjdk/bin/java");
        assert_eq!(
            parsed.trailing_target,
            r#"@libraries/net/minecraftforge/forge/1.20.1-47.2.0/unix_args.txt "$@""#
        );
        assert_eq!(parsed.config.memory_mode, MemoryMode::Custom);
        assert_eq!(parsed.config.xms_mb, 4096);
        assert_eq!(parsed.config.xmx_mb, 4096);
        assert_eq!(parsed.config.gc, GcKind::G1gc);
        assert!(parsed.config.toggles.always_pre_touch);

        let rebuilt = build_startup_command(&parsed.config, &parsed, Some(21), 6144).unwrap();
        assert!(rebuilt.starts_with("TZ=UTC /opt/java/openjdk/bin/java -Xms4096M -Xmx4096M"));
        assert!(rebuilt.ends_with(r#"@libraries/net/minecraftforge/forge/1.20.1-47.2.0/unix_args.txt "$@""#));

        let quoted = r#"java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar "my server.jar" --nogui"#;
        let p2 = parse_startup_command(quoted, 4096);
        assert_eq!(p2.config.memory_mode, MemoryMode::Template);
        assert!(!p2.config.template_match_xms);
        assert_eq!(p2.trailing_target, r#"-jar "my server.jar" --nogui"#);
    }

    #[test]
    fn parses_template_match_xms() {
        let cmd = "java -Xms{{SERVER_MEMORY}}M -Xmx{{SERVER_MEMORY}}M -jar server.jar nogui";
        let parsed = parse_startup_command(cmd, 8192);
        assert_eq!(parsed.config.memory_mode, MemoryMode::Template);
        assert!(parsed.config.template_match_xms);
        let rebuilt = build_startup_command(&parsed.config, &parsed, Some(21), 8192).unwrap();
        assert!(rebuilt.contains("-Xms{{SERVER_MEMORY}}M -Xmx{{SERVER_MEMORY}}M"));
    }

    #[test]
    fn detects_java_major_version_from_images() {
        assert_eq!(detect_java_version("ghcr.io/caloptreyx/java:21"), Some(21));
        assert_eq!(detect_java_version("ghcr.io/pterodactyl/yolks:java_17"), Some(17));
        assert_eq!(detect_java_version("eclipse-temurin:25"), Some(25));
        assert_eq!(detect_java_version("eclipse-temurin:21.0.4_7-jre-alpine"), Some(21));
        assert_eq!(detect_java_version("my-registry.local:5000/java:17"), Some(17));
        assert_eq!(detect_java_version("openjdk:8-jre"), Some(8));
        assert_eq!(detect_java_version("itzg/minecraft-server:java21-graalvm"), Some(21));
        assert_eq!(detect_java_version("ghcr.io/pterodactyl/yolks:nodejs_20"), None);
    }

    #[test]
    fn aikars_switches_between_under_and_over_12gb() {
        let aikars = builtin_presets()
            .into_iter()
            .find(|p| p.id == "aikars")
            .unwrap()
            .config;

        let mut small = aikars.clone();
        small.memory_mode = MemoryMode::Custom;
        small.xms_mb = 8192;
        small.xmx_mb = 8192;
        let small_flags = build_jvm_flags(&small, Some(21), 10240);
        assert!(small_flags.contains(&"-XX:G1NewSizePercent=30".to_string()));
        assert!(small_flags.contains(&"-XX:G1MaxNewSizePercent=40".to_string()));
        assert!(small_flags.contains(&"-XX:G1HeapRegionSize=8M".to_string()));
        assert!(small_flags.contains(&"-XX:G1ReservePercent=20".to_string()));
        assert!(small_flags.contains(&"-XX:InitiatingHeapOccupancyPercent=15".to_string()));
        assert!(small_flags.contains(&"-Dusing.aikars.flags=https://mcflags.emc.gs".to_string()));

        let mut large = aikars;
        large.memory_mode = MemoryMode::Custom;
        large.xms_mb = 12288;
        large.xmx_mb = 12288;
        let large_flags = build_jvm_flags(&large, Some(21), 16384);
        assert!(large_flags.contains(&"-XX:G1NewSizePercent=40".to_string()));
        assert!(large_flags.contains(&"-XX:G1MaxNewSizePercent=50".to_string()));
        assert!(large_flags.contains(&"-XX:G1HeapRegionSize=16M".to_string()));
        assert!(large_flags.contains(&"-XX:G1ReservePercent=15".to_string()));
        assert!(large_flags.contains(&"-XX:InitiatingHeapOccupancyPercent=20".to_string()));
    }

    #[test]
    fn zgc_omits_zgenerational_on_java_24_plus() {
        let zgc = builtin_presets()
            .into_iter()
            .find(|p| p.id == "zgc")
            .unwrap()
            .config;

        let j21 = build_jvm_flags(&zgc, Some(21), 8192);
        assert!(j21.contains(&"-XX:+UseZGC".to_string()));
        assert!(j21.contains(&"-XX:+ZGenerational".to_string()));

        let j24 = build_jvm_flags(&zgc, Some(24), 8192);
        assert!(j24.contains(&"-XX:+UseZGC".to_string()));
        assert!(!j24.contains(&"-XX:+ZGenerational".to_string()));

        let j25 = build_jvm_flags(&zgc, Some(25), 8192);
        assert!(!j25.contains(&"-XX:+ZGenerational".to_string()));
    }

    #[test]
    fn all_presets_pass_validation_even_when_custom_flags_disabled() {
        let strict_settings = Settings {
            allow_custom_flags: false,
            ..Settings::default()
        };
        for preset in builtin_presets() {
            assert!(
                validate_config(&preset.config, &strict_settings, 8192).is_ok(),
                "preset {} failed validation under strict settings",
                preset.id
            );
        }
    }

    #[test]
    fn memory_caps_and_validation_enforced() {
        assert_eq!(max_custom_xmx_mb(0, 512), None);
        assert_eq!(max_custom_xmx_mb(4096, 512), Some(3584));
        assert_eq!(max_custom_xmx_mb(512, 512), Some(512));
        assert_eq!(max_custom_xmx_mb(256, 512), Some(256));
        assert_eq!(max_custom_xmx_mb(600, 512), Some(128));

        let settings = Settings::default();
        let mut cfg = FlagConfig {
            memory_mode: MemoryMode::Custom,
            xms_mb: 4096,
            xmx_mb: 3000,
            ..FlagConfig::default()
        };
        assert!(validate_config(&cfg, &settings, 4096).is_err());

        cfg.xms_mb = 2048;
        cfg.xmx_mb = 3800; // exceeds 4096 - 512 = 3584
        assert!(validate_config(&cfg, &settings, 4096).is_err());

        cfg.xmx_mb = 3584;
        assert!(validate_config(&cfg, &settings, 4096).is_ok());

        let pct_over = FlagConfig {
            memory_mode: MemoryMode::Percentage,
            max_ram_percentage: 98.0,
            ..FlagConfig::default()
        };
        assert!(validate_config(&pct_over, &settings, 4096).is_err());
    }

    #[test]
    fn security_denylist_and_shell_metacharacters_rejected() {
        let extra = vec!["-Dcustom.secret".to_string()];

        // Valid custom flags
        for good in [
            "-XX:+UseNUMA",
            "-Dpaper.playerconnection.keepalive=60",
            "--add-opens=java.base/java.lang=ALL-UNNAMED",
            "--add-exports=java.base/sun.nio.ch=ALL-UNNAMED",
            "--add-modules=jdk.incubator.vector",
            "--enable-native-access=ALL-UNNAMED",
            "--enable-preview",
            "-ea",
            "-da",
            "-server",
            "-Xss512k",
        ] {
            assert!(validate_custom_flag(good, &extra).is_ok(), "{good} should be allowed");
        }

        // Denied flags & shell injection attempts
        for bad in [
            "-javaagent:/tmp/evil.jar",
            "-JavaAgent:agent.jar",
            "-agentlib:jdwp=transport=dt_socket",
            "-agentpath:/tmp/lib.so",
            "-XX:OnOutOfMemoryError=sh -c id",
            "-XX:OnError=curl evil",
            "-XX:HeapDumpPath=/etc/cron.d/pwn",
            "-XX:ErrorFile=/tmp/err",
            "-Xlog:gc*:file=/tmp/gc.log",
            "-XX:CompileCommand=quiet",
            "-XX:Flags=/tmp/flags",
            "-XX:SharedArchiveFile=/tmp/cds",
            "-XX:ArchiveClassesAtExit=/tmp/cds",
            "-Djava.library.path=/tmp",
            "-Djava.ext.dirs=/tmp",
            "-Djava.endorsed.dirs=/tmp",
            "-Djava.security.manager",
            "-Xbootclasspath/a:/tmp/evil.jar",
            "-cp",
            "-classpath",
            "--class-path=/tmp",
            "--module-path=/tmp",
            "-p",
            "@evil_args.txt",
            "-Dcustom.secret.token=1",
            "-Xmx16G",
            "-XX:MaxRAMPercentage=99.0",
            "-Dfoo=bar;rm -rf /",
            "-Dfoo=$(id)",
            "-Dfoo=`id`",
            "-Dfoo=a|b",
            "-Dfoo=a&b",
            "-Dfoo=a b",
            "-Dfoo='bar'",
            "-Dfoo=\"bar\"",
            "bash",
            "--unknown-flag=1",
        ] {
            assert!(validate_custom_flag(bad, &extra).is_err(), "{bad} should be rejected");
        }
    }

    #[test]
    fn share_code_and_import_roundtrip_with_clamping_and_filtering() {
        let mut cfg = builtin_presets()
            .into_iter()
            .find(|p| p.id == "aikars")
            .unwrap()
            .config;
        cfg.memory_mode = MemoryMode::Custom;
        cfg.xms_mb = 8192;
        cfg.xmx_mb = 8192;
        cfg.custom_flags = vec!["-XX:+UseNUMA".into(), "-javaagent:/evil.jar".into()];

        let code = encode_share_code(&cfg, Some("My Aikar".into()), Some("Fast".into())).unwrap();
        assert!(code.starts_with(SHARE_PREFIX));

        let decoded = decode_share_code(&code).unwrap();
        assert_eq!(decoded.name.as_deref(), Some("My Aikar"));
        assert_eq!(decoded.description.as_deref(), Some("Fast"));
        assert_eq!(decoded.config.xmx_mb, 8192);

        let template = parse_startup_command("java -jar paper.jar nogui", 4096);
        let settings = Settings::default();
        let imported =
            parse_import_for_server(&code, &settings, &template, 4096, Some(21)).unwrap();
        assert_eq!(imported.source_format, "share_code");
        assert_eq!(imported.config.xmx_mb, 3584);
        assert_eq!(imported.config.xms_mb, 3584);
        assert_eq!(imported.config.custom_flags, vec!["-XX:+UseNUMA"]);
        assert_eq!(imported.rejected_flags.len(), 1);
        assert_eq!(imported.rejected_flags[0].flag, "-javaagent:/evil.jar");
        assert!(!imported.warnings.is_empty());
        assert!(imported.preview_command.ends_with("-jar paper.jar nogui"));

        // Raw command import
        let raw = "java -Xms2G -Xmx2G -XX:+UseZGC -XX:+ZGenerational -XX:+AlwaysPreTouch -javaagent:bad.jar -jar old.jar";
        let from_cmd =
            parse_import_for_server(raw, &settings, &template, 4096, Some(17)).unwrap();
        assert_eq!(from_cmd.source_format, "command");
        assert_eq!(from_cmd.config.gc, GcKind::Zgc);
        assert_eq!(from_cmd.rejected_flags.len(), 1);
        assert!(from_cmd.warnings.iter().any(|w| w.contains("Java 21")));
        // Preserves this server's jar target, NOT `old.jar`!
        assert!(from_cmd.preview_command.ends_with("-jar paper.jar nogui"));
    }
}
