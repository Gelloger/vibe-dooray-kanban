use axum::{
    Json, Router,
    extract::State,
    response::Json as ResponseJson,
    routing::{get, post},
};
use db::models::{
    dooray_settings::{CreateDooraySettings, DooraySettings},
    task::{CreateTask, Task, TaskStatus},
};
use deployment::Deployment;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

const DOORAY_API_BASE: &str = "https://api.dooray.com";

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/dooray/settings", get(get_settings).post(save_settings).delete(delete_settings))
        .route("/dooray/settings/project", post(update_selected_project))
        .route("/dooray/settings/tags", post(update_selected_tags))
        .route("/dooray/projects", get(get_dooray_projects))
        .route("/dooray/projects/{dooray_project_id}/tasks", get(get_dooray_tasks))
        .route("/dooray/projects/{dooray_project_id}/tags", get(get_dooray_tags))
        .route("/dooray/sync", post(sync_dooray_tasks))
        .route("/dooray/import-by-number", post(import_by_number))
        .route("/dooray/comment", post(create_dooray_comment))
}

// ============== Settings Endpoints ==============

async fn get_settings(
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Option<DooraySettings>>>, ApiError> {
    let settings = DooraySettings::get(&deployment.db().pool).await?;
    // Don't expose the full token in response - mask it
    let masked_settings = settings.map(|s| DooraySettings {
        dooray_token: mask_token(&s.dooray_token),
        ..s
    });
    Ok(ResponseJson(ApiResponse::success(masked_settings)))
}

#[derive(Debug, Deserialize, TS)]
pub struct SaveSettingsRequest {
    pub dooray_token: String,
    pub selected_project_id: Option<String>,
    pub selected_project_name: Option<String>,
}

async fn save_settings(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<SaveSettingsRequest>,
) -> Result<ResponseJson<ApiResponse<DooraySettings>>, ApiError> {
    tracing::debug!("save_settings called, token length: {}", payload.dooray_token.len());

    // Validate token by making a test API call (check if we can access projects)
    let client = create_dooray_client(&payload.dooray_token)?;
    let url = format!("{}/project/v1/projects", DOORAY_API_BASE);
    tracing::debug!("Validating token against: {}", url);

    let response = client
        .get(&url)
        .query(&[("member", "me"), ("page", "0"), ("size", "1")])
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Failed to validate Dooray token: {}", e);
            ApiError::BadRequest(format!("Failed to validate Dooray token: {}", e))
        })?;

    tracing::debug!("Dooray API response status: {}", response.status());

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        tracing::error!("Invalid Dooray token, response: {}", body);
        return Ok(ResponseJson(ApiResponse::error("Invalid Dooray token")));
    }

    // Don't auto-set project - user will select from list
    let data = CreateDooraySettings {
        dooray_token: payload.dooray_token,
        selected_project_id: payload.selected_project_id,
        selected_project_name: payload.selected_project_name,
        selected_tag_ids: None,
    };

    let settings = DooraySettings::upsert(&deployment.db().pool, &data).await?;
    tracing::info!("Dooray settings saved successfully, id: {}", settings.id);

    // Mask token in response
    let masked = DooraySettings {
        dooray_token: mask_token(&settings.dooray_token),
        ..settings
    };

    Ok(ResponseJson(ApiResponse::success(masked)))
}

async fn delete_settings(
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<String>>, ApiError> {
    DooraySettings::delete(&deployment.db().pool).await?;
    Ok(ResponseJson(ApiResponse::success("Dooray integration removed".to_string())))
}

// ============== Dooray API Proxy Endpoints ==============

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct DoorayProject {
    pub id: String,
    pub code: String,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DoorayApiResponse<T> {
    result: Option<T>,
    #[allow(dead_code)]
    header: DoorayApiHeader,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct DoorayApiHeader {
    #[serde(rename = "resultCode")]
    result_code: i32,
    #[serde(rename = "resultMessage")]
    result_message: Option<String>,
    #[serde(rename = "isSuccessful")]
    is_successful: bool,
}

async fn get_dooray_projects(
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<DoorayProject>>>, ApiError> {
    tracing::debug!("get_dooray_projects called");
    let settings = get_required_settings(&deployment).await?;
    tracing::debug!("Got settings, token length: {}", settings.dooray_token.len());
    let client = create_dooray_client(&settings.dooray_token)?;

    let response = client
        .get(format!("{}/project/v1/projects", DOORAY_API_BASE))
        .query(&[("member", "me"), ("page", "0"), ("size", "100")])
        .send()
        .await
        .map_err(|e| ApiError::BadRequest(format!("Dooray API error: {}", e)))?;

    if !response.status().is_success() {
        return Ok(ResponseJson(ApiResponse::error("Failed to fetch Dooray projects")));
    }

    let api_response: DoorayApiResponse<Vec<DoorayProject>> = response
        .json()
        .await
        .map_err(|e| ApiError::BadRequest(format!("Failed to parse Dooray response: {}", e)))?;

    let projects = api_response.result.unwrap_or_default();
    Ok(ResponseJson(ApiResponse::success(projects)))
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct DoorayTask {
    pub id: String,
    pub number: i64,
    pub subject: String,
    #[serde(rename = "workflowClass")]
    pub workflow_class: Option<String>,
    pub body: Option<DoorayTaskBody>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct DoorayTaskBody {
    #[serde(rename = "mimeType")]
    pub mime_type: Option<String>,
    pub content: Option<String>,
}

// ============== Dooray Tags Types ==============

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct DoorayTag {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct DoorayTagGroup {
    pub id: String,
    pub name: Option<String>,
    pub mandatory: bool,
    #[serde(rename = "selectOne")]
    pub select_one: bool,
    pub tags: Vec<DoorayTag>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct DoorayTagsResponse {
    #[serde(rename = "tagGroups")]
    pub tag_groups: Vec<DoorayTagGroup>,
}

#[derive(Debug, Deserialize)]
struct DoorayTagApiResponse {
    result: Option<Vec<DoorayTagApiItem>>,
    #[allow(dead_code)]
    header: DoorayApiHeader,
}

#[derive(Debug, Deserialize)]
struct DoorayTagApiItem {
    id: String,
    name: String,
    #[serde(rename = "tagGroup")]
    tag_group: Option<DoorayTagGroupInfo>,
}

#[derive(Debug, Deserialize)]
struct DoorayTagGroupInfo {
    id: String,
    name: Option<String>,
    mandatory: Option<bool>,
    #[serde(rename = "selectOne")]
    select_one: Option<bool>,
}

#[derive(Debug, Deserialize, TS)]
pub struct UpdateSelectedTagsRequest {
    pub selected_tag_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, TS)]
pub struct UpdateSelectedProjectRequest {
    pub selected_project_id: String,
    pub selected_project_name: String,
}

#[derive(Debug, Deserialize)]
struct DoorayTasksApiResponse {
    result: Option<Vec<DoorayTask>>,
    #[serde(rename = "totalCount")]
    #[allow(dead_code)]
    total_count: Option<i64>,
    #[allow(dead_code)]
    header: DoorayApiHeader,
}

// Response for individual task detail
#[derive(Debug, Deserialize)]
struct DoorayTaskDetailResponse {
    result: Option<DoorayTaskDetail>,
    #[allow(dead_code)]
    header: DoorayApiHeader,
}

#[derive(Debug, Deserialize)]
struct DoorayTaskDetail {
    pub id: String,
    pub subject: String,
    pub number: i64,
    #[serde(rename = "workflowClass")]
    pub workflow_class: Option<String>,
    pub body: Option<DoorayTaskBody>,
}

async fn get_dooray_tasks(
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path(dooray_project_id): axum::extract::Path<String>,
) -> Result<ResponseJson<ApiResponse<Vec<DoorayTask>>>, ApiError> {
    let settings = get_required_settings(&deployment).await?;
    let client = create_dooray_client(&settings.dooray_token)?;

    // Fetch tasks that are not closed (backlog, registered, working)
    let response = client
        .get(format!("{}/project/v1/projects/{}/posts", DOORAY_API_BASE, dooray_project_id))
        .query(&[
            ("page", "0"),
            ("size", "100"),
            ("postWorkflowClasses", "backlog,registered,working"),
        ])
        .send()
        .await
        .map_err(|e| ApiError::BadRequest(format!("Dooray API error: {}", e)))?;

    if !response.status().is_success() {
        return Ok(ResponseJson(ApiResponse::error("Failed to fetch Dooray tasks")));
    }

    let api_response: DoorayTasksApiResponse = response
        .json()
        .await
        .map_err(|e| ApiError::BadRequest(format!("Failed to parse Dooray response: {}", e)))?;

    let tasks = api_response.result.unwrap_or_default();
    Ok(ResponseJson(ApiResponse::success(tasks)))
}

// ============== Tags Endpoint ==============

async fn get_dooray_tags(
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path(dooray_project_id): axum::extract::Path<String>,
) -> Result<ResponseJson<ApiResponse<DoorayTagsResponse>>, ApiError> {
    let settings = get_required_settings(&deployment).await?;
    let client = create_dooray_client(&settings.dooray_token)?;

    // Fetch tags from Dooray API
    let response = client
        .get(format!("{}/project/v1/projects/{}/tags", DOORAY_API_BASE, dooray_project_id))
        .query(&[("page", "0"), ("size", "100")])
        .send()
        .await
        .map_err(|e| ApiError::BadRequest(format!("Dooray API error: {}", e)))?;

    if !response.status().is_success() {
        return Ok(ResponseJson(ApiResponse::error("Failed to fetch Dooray tags")));
    }

    let api_response: DoorayTagApiResponse = response
        .json()
        .await
        .map_err(|e| ApiError::BadRequest(format!("Failed to parse Dooray response: {}", e)))?;

    // Group tags by tag group
    let tags = api_response.result.unwrap_or_default();
    let mut tag_groups_map: std::collections::HashMap<String, DoorayTagGroup> = std::collections::HashMap::new();

    for tag in tags {
        let group_id = tag.tag_group.as_ref().map(|g| g.id.clone()).unwrap_or_else(|| "ungrouped".to_string());
        let group_name = tag.tag_group.as_ref().and_then(|g| g.name.clone());
        let mandatory = tag.tag_group.as_ref().and_then(|g| g.mandatory).unwrap_or(false);
        let select_one = tag.tag_group.as_ref().and_then(|g| g.select_one).unwrap_or(false);

        let group = tag_groups_map.entry(group_id.clone()).or_insert_with(|| DoorayTagGroup {
            id: group_id,
            name: group_name,
            mandatory,
            select_one,
            tags: Vec::new(),
        });

        group.tags.push(DoorayTag {
            id: tag.id,
            name: tag.name,
        });
    }

    let tag_groups: Vec<DoorayTagGroup> = tag_groups_map.into_values().collect();

    Ok(ResponseJson(ApiResponse::success(DoorayTagsResponse { tag_groups })))
}

async fn update_selected_project(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<UpdateSelectedProjectRequest>,
) -> Result<ResponseJson<ApiResponse<DooraySettings>>, ApiError> {
    // Update selected project and clear tag selection (tags are project-specific)
    let settings = DooraySettings::update_selected_project(
        &deployment.db().pool,
        Some(&payload.selected_project_id),
        Some(&payload.selected_project_name),
    ).await?;

    // Clear tag selection when project changes
    if settings.is_some() {
        DooraySettings::update_selected_tags(&deployment.db().pool, None).await?;
    }

    match settings {
        Some(s) => {
            let masked = DooraySettings {
                dooray_token: mask_token(&s.dooray_token),
                selected_tag_ids: None, // Return with cleared tags
                ..s
            };
            Ok(ResponseJson(ApiResponse::success(masked)))
        }
        None => Ok(ResponseJson(ApiResponse::error("No Dooray settings found")))
    }
}

async fn update_selected_tags(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<UpdateSelectedTagsRequest>,
) -> Result<ResponseJson<ApiResponse<DooraySettings>>, ApiError> {
    let tag_ids_json = payload.selected_tag_ids.map(|ids| serde_json::to_string(&ids).unwrap_or_default());

    let settings = DooraySettings::update_selected_tags(
        &deployment.db().pool,
        tag_ids_json.as_deref(),
    ).await?;

    match settings {
        Some(s) => {
            let masked = DooraySettings {
                dooray_token: mask_token(&s.dooray_token),
                ..s
            };
            Ok(ResponseJson(ApiResponse::success(masked)))
        }
        None => Ok(ResponseJson(ApiResponse::error("No Dooray settings found")))
    }
}

// ============== Sync Endpoint ==============

#[derive(Debug, Deserialize, TS)]
pub struct SyncRequest {
    pub project_id: Uuid,  // Local vibe-kanban project ID
    pub dooray_project_id: String,
    pub dooray_project_code: String,  // For task number formatting
}

#[derive(Debug, Serialize, TS)]
pub struct SyncResult {
    pub created: i32,
    pub updated: i32,
    pub skipped: i32,
}

#[derive(Debug, Deserialize, TS)]
pub struct ImportByNumberRequest {
    pub project_id: Uuid,  // Local vibe-kanban project ID
    pub dooray_project_id: String,
    pub dooray_project_code: String,  // For task number formatting
    pub task_number: i64,  // The task number to import
}

#[derive(Debug, Serialize, TS)]
pub struct ImportResult {
    pub success: bool,
    pub task_id: Option<Uuid>,  // The created local task ID
    pub message: String,
}

#[derive(Debug, Deserialize, TS)]
pub struct CreateDoorayCommentRequest {
    pub dooray_task_id: String,
    pub dooray_project_id: String,
    pub content: String,
}

#[derive(Debug, Serialize, TS)]
pub struct CreateDoorayCommentResult {
    pub success: bool,
    pub message: String,
}

async fn sync_dooray_tasks(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<SyncRequest>,
) -> Result<ResponseJson<ApiResponse<SyncResult>>, ApiError> {
    let settings = get_required_settings(&deployment).await?;
    let client = create_dooray_client(&settings.dooray_token)?;

    // Parse selected tag IDs from settings
    let selected_tag_ids: Option<Vec<String>> = settings.selected_tag_ids
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok());

    // Build query parameters
    let mut query_params = vec![
        ("page", "0".to_string()),
        ("size", "100".to_string()),
        ("postWorkflowClasses", "backlog,registered,working".to_string()),
    ];

    // Add tag filter if selected
    if let Some(ref tag_ids) = selected_tag_ids {
        if !tag_ids.is_empty() {
            query_params.push(("tagIds", tag_ids.join(",")));
        }
    }

    // Fetch tasks from Dooray
    let response = client
        .get(format!("{}/project/v1/projects/{}/posts", DOORAY_API_BASE, payload.dooray_project_id))
        .query(&query_params)
        .send()
        .await
        .map_err(|e| ApiError::BadRequest(format!("Dooray API error: {}", e)))?;

    if !response.status().is_success() {
        return Ok(ResponseJson(ApiResponse::error("Failed to fetch Dooray tasks")));
    }

    let api_response: DoorayTasksApiResponse = response
        .json()
        .await
        .map_err(|e| ApiError::BadRequest(format!("Failed to parse Dooray response: {}", e)))?;

    let dooray_tasks = api_response.result.unwrap_or_default();
    let mut created = 0;
    let updated = 0;
    let mut skipped = 0;

    for dooray_task in dooray_tasks {
        // Check if task already exists locally
        let existing = Task::find_by_dooray_task_id(&deployment.db().pool, &dooray_task.id).await?;

        if existing.is_some() {
            // Task already synced, skip for now (could update in bi-directional mode)
            skipped += 1;
            continue;
        }

        // Fetch task detail to get body content
        let detail_response = client
            .get(format!(
                "{}/project/v1/projects/{}/posts/{}",
                DOORAY_API_BASE, payload.dooray_project_id, dooray_task.id
            ))
            .send()
            .await
            .map_err(|e| ApiError::BadRequest(format!("Failed to fetch task detail: {}", e)))?;

        let description = if detail_response.status().is_success() {
            let detail: DoorayTaskDetailResponse = detail_response
                .json()
                .await
                .unwrap_or(DoorayTaskDetailResponse { result: None, header: DoorayApiHeader { result_code: 0, result_message: None, is_successful: false } });
            detail.result.and_then(|d| d.body).and_then(|b| b.content)
        } else {
            None
        };

        // Create new local task
        let task_number = format!("{}/{}", payload.dooray_project_code, dooray_task.number);

        let status = match dooray_task.workflow_class.as_deref() {
            Some("working") => TaskStatus::InProgress,
            Some("registered") => TaskStatus::Todo,
            Some("backlog") => TaskStatus::Todo,
            _ => TaskStatus::Todo,
        };

        let create_data = CreateTask {
            project_id: payload.project_id,
            title: dooray_task.subject,
            description,
            status: Some(status),
            parent_workspace_id: None,
            image_ids: None,
            dooray_task_id: Some(dooray_task.id),
            dooray_project_id: Some(payload.dooray_project_id.clone()),
            dooray_task_number: Some(task_number),
        };

        let task_id = Uuid::new_v4();
        Task::create(&deployment.db().pool, &create_data, task_id).await?;
        created += 1;
    }

    // Update selected project in settings
    DooraySettings::update_selected_project(
        &deployment.db().pool,
        Some(&payload.dooray_project_id),
        Some(&payload.dooray_project_code),
    ).await?;

    Ok(ResponseJson(ApiResponse::success(SyncResult {
        created,
        updated,
        skipped,
    })))
}

// ============== Import by Task Number Endpoint ==============

async fn import_by_number(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<ImportByNumberRequest>,
) -> Result<ResponseJson<ApiResponse<ImportResult>>, ApiError> {
    let settings = get_required_settings(&deployment).await?;
    let client = create_dooray_client(&settings.dooray_token)?;

    // Fetch task by post number
    let response = client
        .get(format!("{}/project/v1/projects/{}/posts", DOORAY_API_BASE, payload.dooray_project_id))
        .query(&[
            ("postNumber", payload.task_number.to_string()),
        ])
        .send()
        .await
        .map_err(|e| ApiError::BadRequest(format!("Dooray API error: {}", e)))?;

    if !response.status().is_success() {
        return Ok(ResponseJson(ApiResponse::success(ImportResult {
            success: false,
            task_id: None,
            message: "해당 태스크를 찾을 수 없습니다.".to_string(),
        })));
    }

    let api_response: DoorayTasksApiResponse = response
        .json()
        .await
        .map_err(|e| ApiError::BadRequest(format!("Failed to parse Dooray response: {}", e)))?;

    let dooray_tasks = api_response.result.unwrap_or_default();

    if dooray_tasks.is_empty() {
        return Ok(ResponseJson(ApiResponse::success(ImportResult {
            success: false,
            task_id: None,
            message: "해당 번호의 태스크를 찾을 수 없습니다.".to_string(),
        })));
    }

    let dooray_task = &dooray_tasks[0];

    // Check if task already exists locally
    let existing = Task::find_by_dooray_task_id(&deployment.db().pool, &dooray_task.id).await?;

    if let Some(existing_task) = existing {
        return Ok(ResponseJson(ApiResponse::success(ImportResult {
            success: true,
            task_id: Some(existing_task.id),
            message: "이미 동기화된 태스크입니다.".to_string(),
        })));
    }

    // Fetch task detail to get body content
    let detail_response = client
        .get(format!(
            "{}/project/v1/projects/{}/posts/{}",
            DOORAY_API_BASE, payload.dooray_project_id, dooray_task.id
        ))
        .send()
        .await
        .map_err(|e| ApiError::BadRequest(format!("Failed to fetch task detail: {}", e)))?;

    let description = if detail_response.status().is_success() {
        let detail: DoorayTaskDetailResponse = detail_response
            .json()
            .await
            .unwrap_or(DoorayTaskDetailResponse { result: None, header: DoorayApiHeader { result_code: 0, result_message: None, is_successful: false } });
        detail.result.and_then(|d| d.body).and_then(|b| b.content)
    } else {
        None
    };

    // Create new local task
    let task_number = format!("{}/{}", payload.dooray_project_code, dooray_task.number);

    let status = match dooray_task.workflow_class.as_deref() {
        Some("working") => TaskStatus::InProgress,
        Some("registered") => TaskStatus::Todo,
        Some("backlog") => TaskStatus::Todo,
        _ => TaskStatus::Todo,
    };

    let create_data = CreateTask {
        project_id: payload.project_id,
        title: dooray_task.subject.clone(),
        description,
        status: Some(status),
        parent_workspace_id: None,
        image_ids: None,
        dooray_task_id: Some(dooray_task.id.clone()),
        dooray_project_id: Some(payload.dooray_project_id.clone()),
        dooray_task_number: Some(task_number),
    };

    let task_id = Uuid::new_v4();
    Task::create(&deployment.db().pool, &create_data, task_id).await?;

    Ok(ResponseJson(ApiResponse::success(ImportResult {
        success: true,
        task_id: Some(task_id),
        message: "태스크를 가져왔습니다.".to_string(),
    })))
}

// ============== Create Dooray Comment Endpoint ==============

async fn create_dooray_comment(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateDoorayCommentRequest>,
) -> Result<ResponseJson<ApiResponse<CreateDoorayCommentResult>>, ApiError> {
    let settings = get_required_settings(&deployment).await?;
    let client = create_dooray_client(&settings.dooray_token)?;

    // Dooray API: POST /project/v1/projects/{projectId}/posts/{postId}/logs
    let response = client
        .post(format!(
            "{}/project/v1/projects/{}/posts/{}/logs",
            DOORAY_API_BASE, payload.dooray_project_id, payload.dooray_task_id
        ))
        .json(&serde_json::json!({
            "body": {
                "mimeType": "text/x-markdown",
                "content": payload.content
            }
        }))
        .send()
        .await
        .map_err(|e| ApiError::BadRequest(format!("Dooray API error: {}", e)))?;

    if !response.status().is_success() {
        return Ok(ResponseJson(ApiResponse::success(CreateDoorayCommentResult {
            success: false,
            message: "코멘트 추가에 실패했습니다.".to_string(),
        })));
    }

    Ok(ResponseJson(ApiResponse::success(CreateDoorayCommentResult {
        success: true,
        message: "두레이에 기록되었습니다.".to_string(),
    })))
}

// ============== Helper Functions ==============

fn create_dooray_client(token: &str) -> Result<reqwest::Client, ApiError> {
    let mut headers = HeaderMap::new();

    // Handle case where user might enter token with or without prefix
    let clean_token = token.trim();
    let auth_value = if clean_token.starts_with("dooray-api ") {
        clean_token.to_string()
    } else {
        format!("dooray-api {}", clean_token)
    };

    tracing::debug!("Creating Dooray client with auth header length: {}", auth_value.len());
    tracing::debug!("Auth header prefix: {}", &auth_value[..auth_value.len().min(20)]);

    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&auth_value)
            .map_err(|e| ApiError::BadRequest(format!("Invalid token format: {}", e)))?,
    );
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .map_err(|e| ApiError::BadRequest(format!("Failed to create HTTP client: {}", e)))
}

async fn get_required_settings(deployment: &DeploymentImpl) -> Result<DooraySettings, ApiError> {
    let result = DooraySettings::get(&deployment.db().pool).await?;
    match result {
        Some(settings) => {
            tracing::debug!("Found dooray settings");
            Ok(settings)
        }
        None => {
            tracing::warn!("Dooray integration not configured - no settings in DB");
            Err(ApiError::BadRequest("Dooray integration not configured".to_string()))
        }
    }
}

fn mask_token(token: &str) -> String {
    if token.len() <= 8 {
        "*".repeat(token.len())
    } else {
        format!("{}...{}", &token[..4], &token[token.len()-4..])
    }
}
