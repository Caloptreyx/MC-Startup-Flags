use indexmap::IndexMap;
use shared::{
    State,
    extensions::{
        Extension, ExtensionPermissionsBuilder, ExtensionRouteBuilder, ExtensionUpdateInfo,
        index_html::IndexHtmlBuilder, settings::ExtensionSettingsDeserializer,
    },
    permissions::PermissionGroup,
};
use std::sync::Arc;

mod db;
pub mod flags;
mod routes;
pub mod settings;

pub const PACKAGE: &str = "dev.caloptreyx.startupflags";

const LATEST_RELEASE: &str =
    "https://api.github.com/repos/Caloptreyx/MC-Startup-Flags/releases/latest";

/// The subset of GitHub's release payload the updates page needs.
#[derive(serde::Serialize, serde::Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    body: String,
}

fn version_from_tag(tag: &str) -> Result<semver::Version, semver::Error> {
    semver::Version::parse(tag.trim_start_matches('v'))
}

#[derive(Default)]
pub struct ExtensionStruct;

#[async_trait::async_trait]
impl Extension for ExtensionStruct {
    async fn initialize_router(
        &mut self,
        state: State,
        builder: ExtensionRouteBuilder,
    ) -> ExtensionRouteBuilder {
        builder
            .add_client_server_api_router(|router| {
                router.nest("/startup-flags", routes::server::router(&state))
            })
            .add_client_api_router(|router| {
                router.nest("/startup-flags", routes::presets::router(&state))
            })
            .add_admin_api_router(|router| {
                router.nest(
                    &format!("/extensions/{PACKAGE}"),
                    routes::admin::router(&state),
                )
            })
    }

    async fn initialize_permissions(
        &mut self,
        _state: State,
        builder: ExtensionPermissionsBuilder,
    ) -> ExtensionPermissionsBuilder {
        builder.add_server_permission_group(
            "startup-flags",
            PermissionGroup {
                description: "Permissions for the Minecraft JVM Startup Flag Editor.",
                permissions: IndexMap::from([
                    (
                        "read",
                        "Allows viewing startup flags, presets, and the flag builder.",
                    ),
                    (
                        "update",
                        "Allows changing the server's JVM startup flags and memory settings.",
                    ),
                    (
                        "presets",
                        "Allows saving, editing, deleting, importing, and exporting custom startup flag presets.",
                    ),
                ]),
            },
        )
    }

    async fn initialize_index_html(
        &mut self,
        _state: State,
        builder: IndexHtmlBuilder,
    ) -> IndexHtmlBuilder {
        builder.add_variable("eggs", |app| {
            let eggs: Vec<serde_json::Value> = app
                .get_extension_settings::<settings::Settings>(PACKAGE)
                .map(|settings| {
                    settings
                        .eggs
                        .iter()
                        .map(|egg| serde_json::Value::String(egg.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            Ok(serde_json::Value::Array(eggs))
        });
        builder
    }

    async fn settings_deserializer(&self, _state: State) -> ExtensionSettingsDeserializer {
        Arc::new(settings::SettingsDataDeserializer)
    }

    async fn check_for_updates(
        &self,
        state: State,
        current_version: &semver::Version,
    ) -> Result<Option<ExtensionUpdateInfo>, anyhow::Error> {
        // GitHub allows 60 unauthenticated requests per hour, and the panel rechecks on every
        // start and every 12 hours.
        let release: Release = state
            .cache
            .cached(
                "dev.caloptreyx.startupflags::latest-release",
                60 * 60,
                || async {
                    let response = state.client.get(LATEST_RELEASE).send().await?;
                    Ok::<Release, anyhow::Error>(
                        response.error_for_status()?.json::<Release>().await?,
                    )
                },
            )
            .await?;

        let latest = version_from_tag(&release.tag_name)?;

        Ok((latest > *current_version).then(|| ExtensionUpdateInfo {
            version: latest,
            changes: release
                .body
                .lines()
                .filter(|line| !line.trim().is_empty())
                .map(compact_str::CompactString::from)
                .collect(),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_from_tag_accepts_prefixed_and_bare_tags() {
        assert_eq!(version_from_tag("v0.1.0").unwrap().to_string(), "0.1.0");
        assert_eq!(version_from_tag("1.2.3").unwrap().to_string(), "1.2.3");
        assert!(version_from_tag("release-1").is_err());
    }
}
