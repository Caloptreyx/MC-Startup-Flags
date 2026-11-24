//! Saved custom presets persisted per user account.
use crate::flags::FlagConfig;
use chrono::{DateTime, Utc};
use serde::Serialize;
use shared::database::Database;
use sqlx::types::Json;
use uuid::Uuid;

#[derive(Clone, Debug, Serialize)]
pub struct SavedPreset {
    pub id: Uuid,
    pub name: String,
    pub description: String,
    pub config: FlagConfig,
    pub created: DateTime<Utc>,
    pub updated: DateTime<Utc>,
}

type PresetRow = (
    Uuid,
    String,
    String,
    Json<FlagConfig>,
    DateTime<Utc>,
    DateTime<Utc>,
);

fn into_preset((id, name, description, Json(config), created, updated): PresetRow) -> SavedPreset {
    SavedPreset {
        id,
        name,
        description,
        config,
        created,
        updated,
    }
}

pub async fn list_presets(db: &Database, user_uuid: Uuid) -> Result<Vec<SavedPreset>, sqlx::Error> {
    let rows: Vec<PresetRow> = sqlx::query_as(
        "SELECT id, name, description, config, created, updated
         FROM dev_caloptreyx_startupflags_presets
         WHERE user_uuid = $1
         ORDER BY updated DESC, created DESC",
    )
    .bind(user_uuid)
    .fetch_all(db.read())
    .await?;

    Ok(rows.into_iter().map(into_preset).collect())
}

pub async fn count_presets(db: &Database, user_uuid: Uuid) -> Result<i64, sqlx::Error> {
    let (count,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM dev_caloptreyx_startupflags_presets WHERE user_uuid = $1",
    )
    .bind(user_uuid)
    .fetch_one(db.read())
    .await?;
    Ok(count)
}

pub async fn create_preset(
    db: &Database,
    user_uuid: Uuid,
    name: &str,
    description: &str,
    config: &FlagConfig,
) -> Result<SavedPreset, sqlx::Error> {
    let row: PresetRow = sqlx::query_as(
        "INSERT INTO dev_caloptreyx_startupflags_presets (user_uuid, name, description, config)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, description, config, created, updated",
    )
    .bind(user_uuid)
    .bind(name)
    .bind(description)
    .bind(Json(config))
    .fetch_one(db.write())
    .await?;

    Ok(into_preset(row))
}

pub async fn update_preset(
    db: &Database,
    user_uuid: Uuid,
    id: Uuid,
    name: &str,
    description: &str,
    config: &FlagConfig,
) -> Result<Option<SavedPreset>, sqlx::Error> {
    let row: Option<PresetRow> = sqlx::query_as(
        "UPDATE dev_caloptreyx_startupflags_presets
         SET name = $3, description = $4, config = $5, updated = now()
         WHERE id = $1 AND user_uuid = $2
         RETURNING id, name, description, config, created, updated",
    )
    .bind(id)
    .bind(user_uuid)
    .bind(name)
    .bind(description)
    .bind(Json(config))
    .fetch_optional(db.write())
    .await?;

    Ok(row.map(into_preset))
}

pub async fn delete_preset(db: &Database, user_uuid: Uuid, id: Uuid) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "DELETE FROM dev_caloptreyx_startupflags_presets WHERE id = $1 AND user_uuid = $2",
    )
    .bind(id)
    .bind(user_uuid)
    .execute(db.write())
    .await?;

    Ok(result.rows_affected() > 0)
}
