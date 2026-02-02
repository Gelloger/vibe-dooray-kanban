use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool, Type};
use strum_macros::{Display, EnumString};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS, EnumString, Display)]
#[sqlx(type_name = "text", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
pub enum DesignMessageRole {
    User,
    Assistant,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct DesignMessage {
    pub id: Uuid,
    pub session_id: Uuid,
    pub role: DesignMessageRole,
    pub content: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CreateDesignMessage {
    pub role: DesignMessageRole,
    pub content: String,
}

impl DesignMessage {
    pub async fn create(
        pool: &SqlitePool,
        session_id: Uuid,
        data: &CreateDesignMessage,
    ) -> Result<Self, sqlx::Error> {
        let id = Uuid::new_v4();
        sqlx::query_as!(
            DesignMessage,
            r#"INSERT INTO design_messages (id, session_id, role, content)
               VALUES ($1, $2, $3, $4)
               RETURNING id as "id!: Uuid", session_id as "session_id!: Uuid", role as "role!: DesignMessageRole", content, created_at as "created_at!: DateTime<Utc>""#,
            id,
            session_id,
            data.role,
            data.content
        )
        .fetch_one(pool)
        .await
    }

    pub async fn find_by_session_id(
        pool: &SqlitePool,
        session_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            DesignMessage,
            r#"SELECT id as "id!: Uuid", session_id as "session_id!: Uuid", role as "role!: DesignMessageRole", content, created_at as "created_at!: DateTime<Utc>"
               FROM design_messages
               WHERE session_id = $1
               ORDER BY created_at ASC"#,
            session_id
        )
        .fetch_all(pool)
        .await
    }

    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            DesignMessage,
            r#"SELECT id as "id!: Uuid", session_id as "session_id!: Uuid", role as "role!: DesignMessageRole", content, created_at as "created_at!: DateTime<Utc>"
               FROM design_messages
               WHERE id = $1"#,
            id
        )
        .fetch_optional(pool)
        .await
    }

    pub async fn delete_by_session_id(
        pool: &SqlitePool,
        session_id: Uuid,
    ) -> Result<u64, sqlx::Error> {
        let result = sqlx::query!(
            "DELETE FROM design_messages WHERE session_id = $1",
            session_id
        )
        .execute(pool)
        .await?;
        Ok(result.rows_affected())
    }
}
