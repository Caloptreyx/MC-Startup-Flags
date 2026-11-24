//! Per-server startup flags API, mounted at `/api/client/servers/{server}/startup-flags`.
use crate::{
    flags::{self, FlagConfig},
    settings::{self, Settings},
};
use axum::{
    http::StatusCode,
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::json;
use shared::{
    ApiError, GetState, Payload, State,
    models::{
        UpdatableModel,
        server::{GetServer, GetServerActivityLogger, Server, UpdateServerOptions},
        user::GetPermissionManager,
    },
    response::{ApiResponse, ApiResponseResult},
};
use utoipa_axum::router::OpenApiRouter;

pub const PERM_READ: &str = "startup-flags.read";
pub const PERM_UPDATE: &str = "startup-flags.update";
pub const PERM_PRESETS: &str = "startup-flags.presets";

fn egg_default_startup(server: &Server) -> Option<&str> {
    server
        .egg
        .startup_commands
        .values()
        .next()
        .map(|s| s.as_str())
}

fn state_payload(
    server: &Server,
    settings: &Settings,
    can_update: bool,
    can_manage_presets: bool,
) -> serde_json::Value {
    let eligible = settings.is_server_eligible(
        server.egg.uuid,
        &server.egg.features,
        &server.startup,
        &server.image,
    );
    let egg_default = egg_default_startup(server).unwrap_or("");
    let server_memory_mb = server.memory.max(0) as u64;
    let java_version = flags::detect_java_version(&server.image);
    let parsed = flags::parse_startup_command(&server.startup, server_memory_mb);
    let max_custom_xmx = flags::max_custom_xmx_mb(server_memory_mb, settings.memory_overhead_mb);

    json!({
        "eligible": eligible,
        "current_startup": server.startup,
        "egg_default_startup": egg_default,
        "is_egg_default": !egg_default.is_empty() && server.startup.trim() == egg_default.trim(),
        "java_version": java_version,
        "server_image": server.image,
        "server_memory_mb": server_memory_mb,
        "parsed": parsed,
        "config": parsed.config,
        "presets": flags::builtin_presets(),
        "settings": {
            "allow_custom_flags": settings.allow_custom_flags,
            "allow_custom_memory": settings.allow_custom_memory,
            "memory_overhead_mb": settings.memory_overhead_mb,
            "max_ram_percentage": settings.max_ram_percentage,
            "max_presets_per_user": settings.max_presets_per_user,
            "max_custom_xmx_mb": max_custom_xmx,
            "extra_blocked_flags": settings.extra_blocked_flags,
        },
        "permissions": {
            "can_update": can_update,
            "can_manage_presets": can_manage_presets,
        },
    })
}

async fn get_state(
    state: GetState,
    permissions: GetPermissionManager,
    server: GetServer,
) -> ApiResponseResult {
    permissions.has_server_permission(PERM_READ)?;
    let settings = settings::load(&state).await?;
    let can_update = permissions.has_server_permission(PERM_UPDATE).is_ok();
    let can_manage_presets = permissions.has_server_permission(PERM_PRESETS).is_ok();
    ApiResponse::new_serialized(state_payload(
        &server,
        &settings,
        can_update,
        can_manage_presets,
    ))
    .ok()
}

async fn apply_flags(
    state: GetState,
    permissions: GetPermissionManager,
    mut server: GetServer,
    activity_logger: GetServerActivityLogger,
    Payload(config): Payload<FlagConfig>,
) -> ApiResponseResult {
    permissions.has_server_permission(PERM_UPDATE)?;
    let settings = settings::load(&state).await?;

    if !settings.is_server_eligible(
        server.egg.uuid,
        &server.egg.features,
        &server.startup,
        &server.image,
    ) {
        return ApiResponse::error("startup flag editor is not enabled for this server")
            .with_status(StatusCode::BAD_REQUEST)
            .ok();
    }

    let server_memory_mb = server.memory.max(0) as u64;
    let java_version = flags::detect_java_version(&server.image);

    if let Err(errors) = flags::validate_config(&config, &settings, server_memory_mb) {
        return ApiResponse::new_serialized(ApiError::new_strings_value(errors))
            .with_status(StatusCode::BAD_REQUEST)
            .ok();
    }

    // Preserve the server's Java binary and launch target; fall back to the egg default only if
    // the current command has no recognizable Java entrypoint.
    let current_parsed = flags::parse_startup_command(&server.startup, server_memory_mb);
    let template = if current_parsed.parseable {
        current_parsed
    } else if let Some(egg_cmd) = egg_default_startup(&server) {
        flags::parse_startup_command(egg_cmd, server_memory_mb)
    } else {
        current_parsed
    };

    let command = match flags::build_startup_command(
        &config,
        &template,
        java_version,
        server_memory_mb,
    ) {
        Ok(cmd) => cmd,
        Err(err) => {
            return ApiResponse::error(err)
                .with_status(StatusCode::BAD_REQUEST)
                .ok();
        }
    };

    server
        .update(
            &state,
            UpdateServerOptions {
                startup: Some(command.into()),
                ..Default::default()
            },
        )
        .await?;

    activity_logger
        .log(
            "server:startup-flags.update",
            json!({
                "command": server.startup,
                "preset_id": config.preset_id,
                "gc": config.gc,
                "memory_mode": config.memory_mode,
            }),
        )
        .await;

    let can_manage_presets = permissions.has_server_permission(PERM_PRESETS).is_ok();
    let payload = state_payload(&server, &settings, true, can_manage_presets);

    server.0.batch_sync(&state).await;

    ApiResponse::new_serialized(payload).ok()
}

async fn reset_to_default(
    state: GetState,
    permissions: GetPermissionManager,
    mut server: GetServer,
    activity_logger: GetServerActivityLogger,
) -> ApiResponseResult {
    permissions.has_server_permission(PERM_UPDATE)?;
    let settings = settings::load(&state).await?;

    if !settings.is_server_eligible(
        server.egg.uuid,
        &server.egg.features,
        &server.startup,
        &server.image,
    ) {
        return ApiResponse::error("startup flag editor is not enabled for this server")
            .with_status(StatusCode::BAD_REQUEST)
            .ok();
    }

    let Some(default_cmd) = egg_default_startup(&server).map(compact_str::CompactString::from)
    else {
        return ApiResponse::error("this egg does not define a default startup command")
            .with_status(StatusCode::BAD_REQUEST)
            .ok();
    };

    server
        .update(
            &state,
            UpdateServerOptions {
                startup: Some(default_cmd),
                ..Default::default()
            },
        )
        .await?;

    activity_logger
        .log(
            "server:startup-flags.reset",
            json!({
                "command": server.startup,
            }),
        )
        .await;

    let can_manage_presets = permissions.has_server_permission(PERM_PRESETS).is_ok();
    let payload = state_payload(&server, &settings, true, can_manage_presets);

    server.0.batch_sync(&state).await;

    ApiResponse::new_serialized(payload).ok()
}

#[derive(Deserialize)]
struct ParsePayload {
    input: String,
}

async fn parse_import(
    state: GetState,
    permissions: GetPermissionManager,
    server: GetServer,
    Payload(data): Payload<ParsePayload>,
) -> ApiResponseResult {
    permissions.has_server_permission(PERM_READ)?;
    let settings = settings::load(&state).await?;

    if data.input.trim().is_empty() || data.input.len() > 32_768 {
        return ApiResponse::error("import payload must be between 1 and 32768 bytes")
            .with_status(StatusCode::BAD_REQUEST)
            .ok();
    }

    let server_memory_mb = server.memory.max(0) as u64;
    let java_version = flags::detect_java_version(&server.image);
    let current_parsed = flags::parse_startup_command(&server.startup, server_memory_mb);
    let template = if current_parsed.parseable {
        current_parsed
    } else if let Some(egg_cmd) = egg_default_startup(&server) {
        flags::parse_startup_command(egg_cmd, server_memory_mb)
    } else {
        current_parsed
    };

    match flags::parse_import_for_server(
        &data.input,
        &settings,
        &template,
        server_memory_mb,
        java_version,
    ) {
        Ok(result) => ApiResponse::new_serialized(result).ok(),
        Err(err) => ApiResponse::error(err)
            .with_status(StatusCode::BAD_REQUEST)
            .ok(),
    }
}

pub fn router(state: &State) -> OpenApiRouter<State> {
    OpenApiRouter::new()
        .route("/", get(get_state).put(apply_flags))
        .route("/reset", post(reset_to_default))
        .route("/parse", post(parse_import))
        .with_state(state.clone())
}
