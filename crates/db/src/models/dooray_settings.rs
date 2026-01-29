use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct DooraySettings {
    pub id: String,
    pub dooray_token: String,
    pub selected_project_id: Option<String>,
    pub selected_project_name: Option<String>,
    /// JSON array of tag IDs to filter when syncing tasks
    pub selected_tag_ids: Option<String>,
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "Date")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct CreateDooraySettings {
    pub dooray_token: String,
    pub selected_project_id: Option<String>,
    pub selected_project_name: Option<String>,
    /// JSON array of tag IDs to filter when syncing tasks
    pub selected_tag_ids: Option<String>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct UpdateDooraySettings {
    pub dooray_token: Option<String>,
    pub selected_project_id: Option<String>,
    pub selected_project_name: Option<String>,
}

impl DooraySettings {
    /// Get the single dooray settings record (there should only be one)
    pub async fn get(pool: &SqlitePool) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            DooraySettings,
            r#"SELECT id, dooray_token, selected_project_id, selected_project_name, selected_tag_ids,
                      created_at as "created_at!: DateTime<Utc>",
                      updated_at as "updated_at!: DateTime<Utc>"
               FROM dooray_settings
               LIMIT 1"#
        )
        .fetch_optional(pool)
        .await
    }

    /// Create or update dooray settings (upsert)
    pub async fn upsert(
        pool: &SqlitePool,
        data: &CreateDooraySettings,
    ) -> Result<Self, sqlx::Error> {
        // Generate a fixed ID since we only want one settings record
        let id = "default";

        sqlx::query_as!(
            DooraySettings,
            r#"INSERT INTO dooray_settings (id, dooray_token, selected_project_id, selected_project_name, selected_tag_ids)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT(id) DO UPDATE SET
                   dooray_token = excluded.dooray_token,
                   selected_project_id = excluded.selected_project_id,
                   selected_project_name = excluded.selected_project_name,
                   selected_tag_ids = excluded.selected_tag_ids,
                   updated_at = CURRENT_TIMESTAMP
               RETURNING id, dooray_token, selected_project_id, selected_project_name, selected_tag_ids,
                         created_at as "created_at!: DateTime<Utc>",
                         updated_at as "updated_at!: DateTime<Utc>""#,
            id,
            data.dooray_token,
            data.selected_project_id,
            data.selected_project_name,
            data.selected_tag_ids
        )
        .fetch_one(pool)
        .await
    }

    /// Update selected project only
    pub async fn update_selected_project(
        pool: &SqlitePool,
        project_id: Option<&str>,
        project_name: Option<&str>,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            DooraySettings,
            r#"UPDATE dooray_settings
               SET selected_project_id = $1,
                   selected_project_name = $2,
                   updated_at = CURRENT_TIMESTAMP
               RETURNING id, dooray_token, selected_project_id, selected_project_name, selected_tag_ids,
                         created_at as "created_at!: DateTime<Utc>",
                         updated_at as "updated_at!: DateTime<Utc>""#,
            project_id,
            project_name
        )
        .fetch_optional(pool)
        .await
    }

    /// Update selected tag IDs only
    pub async fn update_selected_tags(
        pool: &SqlitePool,
        tag_ids: Option<&str>,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            DooraySettings,
            r#"UPDATE dooray_settings
               SET selected_tag_ids = $1,
                   updated_at = CURRENT_TIMESTAMP
               RETURNING id, dooray_token, selected_project_id, selected_project_name, selected_tag_ids,
                         created_at as "created_at!: DateTime<Utc>",
                         updated_at as "updated_at!: DateTime<Utc>""#,
            tag_ids
        )
        .fetch_optional(pool)
        .await
    }

    /// Delete dooray settings (disconnect)
    pub async fn delete(pool: &SqlitePool) -> Result<u64, sqlx::Error> {
        let result = sqlx::query!("DELETE FROM dooray_settings")
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }
}
