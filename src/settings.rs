//! Extension settings, edited on the extension's card in the admin area.
use serde::{Deserialize, Serialize};
use shared::{
    State,
    extensions::settings::{
        ExtensionSettings, SettingsDeserializeExt, SettingsDeserializer, SettingsSerializeExt,
        SettingsSerializer,
    },
};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Settings {
    /// Eggs whose servers get the startup flag editor; empty means automatic Java/Minecraft
    /// detection.
    pub eggs: Vec<uuid::Uuid>,
    /// Whether users may add arbitrary custom JVM flags (still checked against the security
    /// denylist and syntax validator).
    pub allow_custom_flags: bool,
    /// Whether users may configure explicit `-Xms`/`-Xmx` custom memory instead of percentage or
    /// template memory.
    pub allow_custom_memory: bool,
    /// Reserved container overhead in MiB subtracted from server memory when capping custom `-Xmx`.
    pub memory_overhead_mb: u32,
    /// Maximum allowed `-XX:MaxRAMPercentage` value (50.0..=100.0).
    pub max_ram_percentage: f32,
    /// Maximum number of saved custom presets per user account.
    pub max_presets_per_user: u32,
    /// Extra case-insensitive JVM flag prefixes blocked in addition to the built-in denylist.
    pub extra_blocked_flags: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            eggs: Vec::new(),
            allow_custom_flags: true,
            allow_custom_memory: true,
            memory_overhead_mb: 512,
            max_ram_percentage: 95.0,
            max_presets_per_user: 25,
            extra_blocked_flags: Vec::new(),
        }
    }
}

fn check<T: PartialOrd + std::fmt::Display>(
    errors: &mut Vec<String>,
    name: &str,
    value: T,
    min: T,
    max: T,
) {
    if value < min || value > max {
        errors.push(format!("{name} must be between {min} and {max}"));
    }
}

impl Settings {
    pub fn normalized(&self) -> Self {
        let mut next = self.clone();
        let mut seen = Vec::new();
        for flag in &self.extra_blocked_flags {
            let trimmed = flag.trim().to_string();
            if trimmed.is_empty() {
                continue;
            }
            let lower = trimmed.to_ascii_lowercase();
            if !seen.iter().any(|existing: &String| existing.eq_ignore_ascii_case(&lower)) {
                seen.push(trimmed);
            }
        }
        next.extra_blocked_flags = seen;
        next
    }

    pub fn validate(&self) -> Result<(), Vec<String>> {
        let mut errors = Vec::new();
        check(
            &mut errors,
            "memory_overhead_mb",
            self.memory_overhead_mb,
            0,
            16_384,
        );
        if !self.max_ram_percentage.is_finite()
            || self.max_ram_percentage < 50.0
            || self.max_ram_percentage > 100.0
        {
            errors.push("max_ram_percentage must be between 50.0 and 100.0".into());
        }
        check(
            &mut errors,
            "max_presets_per_user",
            self.max_presets_per_user,
            1,
            200,
        );
        if self.eggs.len() > 1000 {
            errors.push("eggs must list at most 1000 eggs".into());
        }
        if self.extra_blocked_flags.len() > 200 {
            errors.push("extra_blocked_flags must list at most 200 prefixes".into());
        }
        for flag in &self.extra_blocked_flags {
            let trimmed = flag.trim();
            if trimmed.is_empty() {
                errors.push("extra_blocked_flags cannot contain empty entries".into());
                break;
            }
            if trimmed.len() > 128 {
                errors.push("each extra_blocked_flags entry must be at most 128 characters".into());
                break;
            }
            if trimmed.chars().any(|c| c.is_whitespace() || c.is_control()) {
                errors.push("extra_blocked_flags entries cannot contain whitespace or control characters".into());
                break;
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }

    /// Whether the server is eligible for the MC Startup Flags editor.
    pub fn is_server_eligible(
        &self,
        egg_uuid: uuid::Uuid,
        egg_features: &[compact_str::CompactString],
        startup: &str,
        image: &str,
    ) -> bool {
        if !self.eggs.is_empty() {
            return self.eggs.contains(&egg_uuid);
        }
        looks_like_java_server(egg_features, startup, image)
    }
}

/// Auto-detection used when `eggs` is empty: egg features include `java_version` or `eula`, or
/// the startup command launches `java`, or the container image mentions `java`.
pub fn looks_like_java_server(
    egg_features: &[compact_str::CompactString],
    startup: &str,
    image: &str,
) -> bool {
    if egg_features
        .iter()
        .any(|f| f.eq_ignore_ascii_case("java_version") || f.eq_ignore_ascii_case("eula"))
    {
        return true;
    }
    if crate::flags::startup_starts_with_java(startup) {
        return true;
    }
    image.to_ascii_lowercase().contains("java")
}

#[async_trait::async_trait]
impl SettingsSerializeExt for Settings {
    async fn serialize(
        &self,
        serializer: SettingsSerializer,
    ) -> Result<SettingsSerializer, anyhow::Error> {
        Ok(serializer
            .write_serde_setting("eggs", &self.eggs)?
            .write_serde_setting("allow_custom_flags", &self.allow_custom_flags)?
            .write_serde_setting("allow_custom_memory", &self.allow_custom_memory)?
            .write_serde_setting("memory_overhead_mb", &self.memory_overhead_mb)?
            .write_serde_setting("max_ram_percentage", &self.max_ram_percentage)?
            .write_serde_setting("max_presets_per_user", &self.max_presets_per_user)?
            .write_serde_setting("extra_blocked_flags", &self.extra_blocked_flags)?)
    }
}

pub struct SettingsDataDeserializer;

#[async_trait::async_trait]
impl SettingsDeserializeExt for SettingsDataDeserializer {
    async fn deserialize_boxed(
        &self,
        deserializer: SettingsDeserializer<'_>,
    ) -> Result<ExtensionSettings, anyhow::Error> {
        let d = Settings::default();
        macro_rules! serde_or {
            ($key:literal, $default:expr) => {
                deserializer.read_serde_setting($key).unwrap_or($default)
            };
        }
        Ok(Box::new(Settings {
            eggs: serde_or!("eggs", d.eggs),
            allow_custom_flags: serde_or!("allow_custom_flags", d.allow_custom_flags),
            allow_custom_memory: serde_or!("allow_custom_memory", d.allow_custom_memory),
            memory_overhead_mb: serde_or!("memory_overhead_mb", d.memory_overhead_mb),
            max_ram_percentage: serde_or!("max_ram_percentage", d.max_ram_percentage),
            max_presets_per_user: serde_or!("max_presets_per_user", d.max_presets_per_user),
            extra_blocked_flags: serde_or!("extra_blocked_flags", d.extra_blocked_flags),
        }))
    }
}

pub async fn load(state: &State) -> Result<Settings, anyhow::Error> {
    let settings = state.settings.get().await?;
    Ok(settings
        .get_extension_settings::<Settings>(crate::PACKAGE)
        .cloned()
        .unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_valid_and_limits_are_checked() {
        assert!(Settings::default().validate().is_ok());

        let invalid = Settings {
            memory_overhead_mb: 20_000,
            max_ram_percentage: 45.0,
            max_presets_per_user: 0,
            extra_blocked_flags: vec!["-Dbad flag".into()],
            ..Settings::default()
        };
        assert_eq!(invalid.validate().unwrap_err().len(), 4);

        let nan_pct = Settings {
            max_ram_percentage: f32::NAN,
            ..Settings::default()
        };
        assert!(nan_pct.validate().is_err());
    }

    #[test]
    fn eligibility_respects_egg_allowlist_and_auto_detection() {
        let egg_a = uuid::Uuid::from_u128(1);
        let egg_b = uuid::Uuid::from_u128(2);

        let allowlist = Settings {
            eggs: vec![egg_a],
            ..Settings::default()
        };
        assert!(allowlist.is_server_eligible(egg_a, &[], "node index.js", "node:22"));
        assert!(!allowlist.is_server_eligible(
            egg_b,
            &["eula".into()],
            "java -jar server.jar",
            "ghcr.io/caloptreyx/java:21"
        ));

        let auto = Settings::default();
        assert!(auto.is_server_eligible(egg_b, &["java_version".into()], "./run.sh", "alpine"));
        assert!(auto.is_server_eligible(egg_b, &["eula".into()], "./run.sh", "alpine"));
        assert!(auto.is_server_eligible(
            egg_b,
            &[],
            "FOO=bar /opt/java/bin/java -jar paper.jar",
            "alpine"
        ));
        assert!(auto.is_server_eligible(egg_b, &[], "./start.sh", "ghcr.io/caloptreyx/java:21"));
        assert!(!auto.is_server_eligible(egg_b, &[], "node server.js", "ghcr.io/pterodactyl/yolks:nodejs_20"));
    }

    #[test]
    fn incomplete_updates_are_refused() {
        assert!(serde_json::from_str::<Settings>(r#"{"eggs":[]}"#).is_err());
    }
}
