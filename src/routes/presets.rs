//! Account-scoped custom startup flag presets, mounted at `/api/client/startup-flags`.
use crate::{
    db,
    flags::{self, FlagConfig},
    settings,
};
use axum::{
    extract::Path,
    http::StatusCode,
    routing::{get, put},
};
use serde::Deserialize;
use serde_json::json;
use shared::{
    ApiError, GetState, Payload, State,
    models::{user::GetUser, user_activity::GetUserActivityLogger},
    response::{ApiResponse, ApiResponseResult},
};
use utoipa_axum::router::OpenApiRouter;
use uuid::Uuid;

#[derive(Deserialize)]
struct PresetPayload {
    name: String,
    #[serde(default)]
    description: String,
    config: FlagConfig,
}

fn validate_preset_input(
    payload: &PresetPayload,
    settings: &settings::Settings,
) -> Result<(String, String), Vec<String>> {
    let mut errors = Vec::new();
    let name = payload.name.trim().to_string();
    let description = payload.description.trim().to_string();

    if name.is_empty() || name.chars().count() > 80 {
        errors.push("preset name must be between 1 and 80 characters".into());
    }
    if description.chars().count() > 255 {
        errors.push("preset description must be at most 255 characters".into());
    }
    if name.chars().any(char::is_control) || description.chars().any(char::is_control) {
        errors.push("preset name and description cannot contain control characters".into());
    }

    if let Err(config_errors) = flags::validate_preset_config(&payload.config, settings) {
        errors.extend(config_errors);
    }

    if errors.is_empty() {
        Ok((name, description))
    } else {
        Err(errors)
    }
}

async fn list_presets(state: GetState, user: GetUser) -> ApiResponseResult {
    let settings = settings::load(&state).await?;
    let presets = db::list_presets(&state.database, user.uuid).await?;
    ApiResponse::new_serialized(json!({
        "presets": presets,
        "max_presets_per_user": settings.max_presets_per_user,
    }))
    .ok()
}

async fn create_preset(
    state: GetState,
    user: GetUser,
    activity_logger: GetUserActivityLogger,
    Payload(data): Payload<PresetPayload>,
) -> ApiResponseResult {
    let settings = settings::load(&state).await?;
    let (name, description) = match validate_preset_input(&data, &settings) {
        Ok(valid) => valid,
        Err(errors) => {
            return ApiResponse::new_serialized(ApiError::new_strings_value(errors))
                .with_status(StatusCode::BAD_REQUEST)
                .ok();
        }
    };

    let current = db::count_presets(&state.database, user.uuid).await?;
    if current >= i64::from(settings.max_presets_per_user) {
        return ApiResponse::error(format!(
            "preset limit reached (maximum {} per account)",
            settings.max_presets_per_user
        ))
        .with_status(StatusCode::BAD_REQUEST)
        .ok();
    }

    let preset =
        db::create_preset(&state.database, user.uuid, &name, &description, &data.config).await?;
    activity_logger
        .log(
            "user:startup-flags.preset.create",
            json!({ "id": preset.id, "name": preset.name }),
        )
        .await;
    ApiResponse::new_serialized(json!({ "preset": preset }))
        .with_status(StatusCode::CREATED)
        .ok()
}

async fn update_preset(
    state: GetState,
    user: GetUser,
    activity_logger: GetUserActivityLogger,
    Path(id): Path<Uuid>,
    Payload(data): Payload<PresetPayload>,
) -> ApiResponseResult {
    let settings = settings::load(&state).await?;
    let (name, description) = match validate_preset_input(&data, &settings) {
        Ok(valid) => valid,
        Err(errors) => {
            return ApiResponse::new_serialized(ApiError::new_strings_value(errors))
                .with_status(StatusCode::BAD_REQUEST)
                .ok();
        }
    };

    let Some(preset) = db::update_preset(
        &state.database,
        user.uuid,
        id,
        &name,
        &description,
        &data.config,
    )
    .await?
    else {
        return ApiResponse::error("preset not found")
            .with_status(StatusCode::NOT_FOUND)
            .ok();
    };

    activity_logger
        .log(
            "user:startup-flags.preset.update",
            json!({ "id": preset.id, "name": preset.name }),
        )
        .await;
    ApiResponse::new_serialized(json!({ "preset": preset })).ok()
}

async fn delete_preset(
    state: GetState,
    user: GetUser,
    activity_logger: GetUserActivityLogger,
    Path(id): Path<Uuid>,
) -> ApiResponseResult {
    if !db::delete_preset(&state.database, user.uuid, id).await? {
        return ApiResponse::error("preset not found")
            .with_status(StatusCode::NOT_FOUND)
            .ok();
    }
    activity_logger
        .log("user:startup-flags.preset.delete", json!({ "id": id }))
        .await;
    ApiResponse::new_serialized(json!({ "deleted": true })).ok()
}

pub fn router(state: &State) -> OpenApiRouter<State> {
    OpenApiRouter::new()
        .route("/presets", get(list_presets).post(create_preset))
        .route("/presets/{id}", put(update_preset).delete(delete_preset))
        .with_state(state.clone())
}
