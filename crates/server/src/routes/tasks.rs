use std::path::PathBuf;

use anyhow;
use axum::{
    Extension, Json, Router,
    extract::{
        Query, State,
        ws::{WebSocket, WebSocketUpgrade},
    },
    http::StatusCode,
    middleware::from_fn_with_state,
    response::{IntoResponse, Json as ResponseJson, Sse, sse::Event},
    routing::{delete, get, post, put},
};
use std::convert::Infallible;
use db::models::{
    design_message::{CreateDesignMessage, DesignMessage, DesignMessageRole},
    image::TaskImage,
    project_repo::ProjectRepo,
    repo::{Repo, RepoError},
    session::{CreateSession, Session},
    task::{CreateTask, Task, TaskStatus, TaskWithAttemptStatus, UpdateTask},
    workspace::{CreateWorkspace, Workspace},
    workspace_repo::{CreateWorkspaceRepo, WorkspaceRepo},
};
use deployment::Deployment;
use executors::profile::ExecutorProfileId;
use futures_util::{SinkExt, StreamExt, TryStreamExt};
use serde::{Deserialize, Serialize};
use services::services::{container::ContainerService, workspace_manager::WorkspaceManager};
use sqlx::Error as SqlxError;
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{
    DeploymentImpl, error::ApiError, middleware::load_task_middleware,
    routes::task_attempts::WorkspaceRepoInput,
};

#[derive(Debug, Serialize, Deserialize)]
pub struct TaskQuery {
    pub project_id: Uuid,
}

pub async fn get_tasks(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<TaskQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<TaskWithAttemptStatus>>>, ApiError> {
    let tasks =
        Task::find_by_project_id_with_attempt_status(&deployment.db().pool, query.project_id)
            .await?;

    Ok(ResponseJson(ApiResponse::success(tasks)))
}

pub async fn stream_tasks_ws(
    ws: WebSocketUpgrade,
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<TaskQuery>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| async move {
        if let Err(e) = handle_tasks_ws(socket, deployment, query.project_id).await {
            tracing::warn!("tasks WS closed: {}", e);
        }
    })
}

async fn handle_tasks_ws(
    socket: WebSocket,
    deployment: DeploymentImpl,
    project_id: Uuid,
) -> anyhow::Result<()> {
    // Get the raw stream and convert LogMsg to WebSocket messages
    let mut stream = deployment
        .events()
        .stream_tasks_raw(project_id)
        .await?
        .map_ok(|msg| msg.to_ws_message_unchecked());

    // Split socket into sender and receiver
    let (mut sender, mut receiver) = socket.split();

    // Drain (and ignore) any client->server messages so pings/pongs work
    tokio::spawn(async move { while let Some(Ok(_)) = receiver.next().await {} });

    // Forward server messages
    while let Some(item) = stream.next().await {
        match item {
            Ok(msg) => {
                if sender.send(msg).await.is_err() {
                    break; // client disconnected
                }
            }
            Err(e) => {
                tracing::error!("stream error: {}", e);
                break;
            }
        }
    }
    Ok(())
}

pub async fn get_task(
    Extension(task): Extension<Task>,
    State(_deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Task>>, ApiError> {
    Ok(ResponseJson(ApiResponse::success(task)))
}

pub async fn create_task(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateTask>,
) -> Result<ResponseJson<ApiResponse<Task>>, ApiError> {
    let id = Uuid::new_v4();

    tracing::debug!(
        "Creating task '{}' in project {}",
        payload.title,
        payload.project_id
    );

    let task = Task::create(&deployment.db().pool, &payload, id).await?;

    if let Some(image_ids) = &payload.image_ids {
        TaskImage::associate_many_dedup(&deployment.db().pool, task.id, image_ids).await?;
    }

    deployment
        .track_if_analytics_allowed(
            "task_created",
            serde_json::json!({
            "task_id": task.id.to_string(),
            "project_id": payload.project_id,
            "has_description": task.description.is_some(),
            "has_images": payload.image_ids.is_some(),
            }),
        )
        .await;

    Ok(ResponseJson(ApiResponse::success(task)))
}

#[derive(Debug, Deserialize, TS)]
pub struct CreateAndStartTaskRequest {
    pub task: CreateTask,
    pub executor_profile_id: ExecutorProfileId,
    pub repos: Vec<WorkspaceRepoInput>,
}

pub async fn create_task_and_start(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateAndStartTaskRequest>,
) -> Result<ResponseJson<ApiResponse<TaskWithAttemptStatus>>, ApiError> {
    if payload.repos.is_empty() {
        return Err(ApiError::BadRequest(
            "At least one repository is required".to_string(),
        ));
    }

    let pool = &deployment.db().pool;

    let task_id = Uuid::new_v4();
    let task = Task::create(pool, &payload.task, task_id).await?;

    if let Some(image_ids) = &payload.task.image_ids {
        TaskImage::associate_many_dedup(pool, task.id, image_ids).await?;
    }

    deployment
        .track_if_analytics_allowed(
            "task_created",
            serde_json::json!({
                "task_id": task.id.to_string(),
                "project_id": task.project_id,
                "has_description": task.description.is_some(),
                "has_images": payload.task.image_ids.is_some(),
            }),
        )
        .await;

    let attempt_id = Uuid::new_v4();

    // Use Dooray task number for branch name if available
    let git_branch_name = if let Some(ref dooray_number) = task.dooray_task_number {
        // Extract just the number part (e.g., "Notification-개발/123" -> "123")
        let number = dooray_number.split('/').last().unwrap_or(dooray_number);
        format!("feature/develop/{}", number)
    } else {
        deployment
            .container()
            .git_branch_from_workspace(&attempt_id, &task.title)
            .await
    };

    // Compute agent_working_dir based on repo count:
    // - Single repo: join repo name with default_working_dir (if set), or just repo name
    // - Multiple repos: use None (agent runs in workspace root)
    let agent_working_dir = if payload.repos.len() == 1 {
        let repo = Repo::find_by_id(pool, payload.repos[0].repo_id)
            .await?
            .ok_or(RepoError::NotFound)?;
        match repo.default_working_dir {
            Some(subdir) => {
                let path = PathBuf::from(&repo.name).join(&subdir);
                Some(path.to_string_lossy().to_string())
            }
            None => Some(repo.name),
        }
    } else {
        None
    };

    let workspace = Workspace::create(
        pool,
        &CreateWorkspace {
            branch: git_branch_name,
            agent_working_dir,
        },
        attempt_id,
        task.id,
    )
    .await?;

    let workspace_repos: Vec<CreateWorkspaceRepo> = payload
        .repos
        .iter()
        .map(|r| CreateWorkspaceRepo {
            repo_id: r.repo_id,
            target_branch: r.target_branch.clone(),
        })
        .collect();
    WorkspaceRepo::create_many(&deployment.db().pool, workspace.id, &workspace_repos).await?;

    let is_attempt_running = deployment
        .container()
        .start_workspace(&workspace, payload.executor_profile_id.clone())
        .await
        .inspect_err(|err| tracing::error!("Failed to start task attempt: {}", err))
        .is_ok();
    deployment
        .track_if_analytics_allowed(
            "task_attempt_started",
            serde_json::json!({
                "task_id": task.id.to_string(),
                "executor": &payload.executor_profile_id.executor,
                "variant": &payload.executor_profile_id.variant,
                "workspace_id": workspace.id.to_string(),
            }),
        )
        .await;

    let task = Task::find_by_id(pool, task.id)
        .await?
        .ok_or(ApiError::Database(SqlxError::RowNotFound))?;

    tracing::info!("Started attempt for task {}", task.id);
    Ok(ResponseJson(ApiResponse::success(TaskWithAttemptStatus {
        task,
        has_in_progress_attempt: is_attempt_running,
        last_attempt_failed: false,
        executor: payload.executor_profile_id.executor.to_string(),
        workspace_count: 1,
    })))
}

pub async fn update_task(
    Extension(existing_task): Extension<Task>,
    State(deployment): State<DeploymentImpl>,

    Json(payload): Json<UpdateTask>,
) -> Result<ResponseJson<ApiResponse<Task>>, ApiError> {
    // Use existing values if not provided in update
    let title = payload.title.unwrap_or(existing_task.title);
    let description = match payload.description {
        Some(s) if s.trim().is_empty() => None, // Empty string = clear description
        Some(s) => Some(s),                     // Non-empty string = update description
        None => existing_task.description,      // Field omitted = keep existing
    };
    let status = payload.status.unwrap_or(existing_task.status);
    let parent_workspace_id = payload
        .parent_workspace_id
        .or(existing_task.parent_workspace_id);

    let task = Task::update(
        &deployment.db().pool,
        existing_task.id,
        existing_task.project_id,
        title,
        description,
        status,
        parent_workspace_id,
    )
    .await?;

    if let Some(image_ids) = &payload.image_ids {
        TaskImage::delete_by_task_id(&deployment.db().pool, task.id).await?;
        TaskImage::associate_many_dedup(&deployment.db().pool, task.id, image_ids).await?;
    }

    Ok(ResponseJson(ApiResponse::success(task)))
}

pub async fn delete_task(
    Extension(task): Extension<Task>,
    State(deployment): State<DeploymentImpl>,
) -> Result<(StatusCode, ResponseJson<ApiResponse<()>>), ApiError> {
    let pool = &deployment.db().pool;

    // Gather task attempts data needed for background cleanup
    let attempts = Workspace::fetch_all(pool, Some(task.id))
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch task attempts for task {}: {}", task.id, e);
            ApiError::Workspace(e)
        })?;

    // Stop any running execution processes before deletion
    for workspace in &attempts {
        deployment.container().try_stop(workspace, true).await;
    }

    let repositories = WorkspaceRepo::find_unique_repos_for_task(pool, task.id).await?;

    // Collect workspace directories that need cleanup
    let workspace_dirs: Vec<PathBuf> = attempts
        .iter()
        .filter_map(|attempt| attempt.container_ref.as_ref().map(PathBuf::from))
        .collect();

    // Use a transaction to ensure atomicity: either all operations succeed or all are rolled back
    let mut tx = pool.begin().await?;

    // Nullify parent_workspace_id for all child tasks before deletion
    // This breaks parent-child relationships to avoid foreign key constraint violations
    let mut total_children_affected = 0u64;
    for attempt in &attempts {
        let children_affected =
            Task::nullify_children_by_workspace_id(&mut *tx, attempt.id).await?;
        total_children_affected += children_affected;
    }

    // Delete task from database (FK CASCADE will handle task_attempts)
    let rows_affected = Task::delete(&mut *tx, task.id).await?;

    if rows_affected == 0 {
        return Err(ApiError::Database(SqlxError::RowNotFound));
    }

    // Commit the transaction - if this fails, all changes are rolled back
    tx.commit().await?;

    if total_children_affected > 0 {
        tracing::info!(
            "Nullified {} child task references before deleting task {}",
            total_children_affected,
            task.id
        );
    }

    deployment
        .track_if_analytics_allowed(
            "task_deleted",
            serde_json::json!({
                "task_id": task.id.to_string(),
                "project_id": task.project_id.to_string(),
                "attempt_count": attempts.len(),
            }),
        )
        .await;

    let task_id = task.id;
    let pool = pool.clone();
    tokio::spawn(async move {
        tracing::info!(
            "Starting background cleanup for task {} ({} workspaces, {} repos)",
            task_id,
            workspace_dirs.len(),
            repositories.len()
        );

        for workspace_dir in &workspace_dirs {
            if let Err(e) = WorkspaceManager::cleanup_workspace(workspace_dir, &repositories).await
            {
                tracing::error!(
                    "Background workspace cleanup failed for task {} at {}: {}",
                    task_id,
                    workspace_dir.display(),
                    e
                );
            }
        }

        match Repo::delete_orphaned(&pool).await {
            Ok(count) if count > 0 => {
                tracing::info!("Deleted {} orphaned repo records", count);
            }
            Err(e) => {
                tracing::error!("Failed to delete orphaned repos: {}", e);
            }
            _ => {}
        }

        tracing::info!("Background cleanup completed for task {}", task_id);
    });

    // Return 202 Accepted to indicate deletion was scheduled
    Ok((StatusCode::ACCEPTED, ResponseJson(ApiResponse::success(()))))
}

/// Reset a task to Todo status, cleaning up all associated workspaces and worktrees.
pub async fn reset_to_todo(
    Extension(task): Extension<Task>,
    State(deployment): State<DeploymentImpl>,
) -> Result<(StatusCode, ResponseJson<ApiResponse<Task>>), ApiError> {
    let pool = &deployment.db().pool;

    // Already Todo — no-op
    if task.status == TaskStatus::Todo {
        return Ok((StatusCode::OK, ResponseJson(ApiResponse::success(task))));
    }

    // Fetch associated workspaces
    let workspaces = Workspace::fetch_all(pool, Some(task.id))
        .await
        .map_err(|e| {
            tracing::error!(
                "Failed to fetch workspaces for task {}: {}",
                task.id,
                e
            );
            ApiError::Workspace(e)
        })?;

    if workspaces.is_empty() {
        // No workspaces — just update status
        Task::update_status(pool, task.id, TaskStatus::Todo).await?;
        let updated = Task::find_by_id(pool, task.id)
            .await?
            .ok_or(ApiError::Database(SqlxError::RowNotFound))?;
        return Ok((StatusCode::OK, ResponseJson(ApiResponse::success(updated))));
    }

    // Stop any running execution processes
    for ws in &workspaces {
        deployment.container().try_stop(ws, true).await;
    }

    let repositories = WorkspaceRepo::find_unique_repos_for_task(pool, task.id).await?;

    // Collect workspace directories and branch names for background cleanup
    let workspace_dirs: Vec<PathBuf> = workspaces
        .iter()
        .filter_map(|ws| ws.container_ref.as_ref().map(PathBuf::from))
        .collect();

    let branch_names: Vec<String> = workspaces
        .iter()
        .map(|ws| ws.branch.clone())
        .collect();

    // Transaction: nullify children, delete workspaces, update status
    let mut tx = pool.begin().await?;

    for ws in &workspaces {
        Task::nullify_children_by_workspace_id(&mut *tx, ws.id).await?;
    }

    Workspace::delete_all_by_task_id(&mut *tx, task.id).await?;

    sqlx::query("UPDATE tasks SET status = 'todo', updated_at = CURRENT_TIMESTAMP WHERE id = $1")
        .bind(task.id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    tracing::info!(
        "Reset task {} to Todo, cleaned up {} workspaces",
        task.id,
        workspaces.len()
    );

    // Background cleanup of worktree directories and branches
    let task_id = task.id;
    let pool_clone = pool.clone();
    tokio::spawn(async move {
        for dir in &workspace_dirs {
            if let Err(e) = WorkspaceManager::cleanup_workspace(dir, &repositories).await {
                tracing::error!(
                    "Background workspace cleanup failed for task {} at {}: {}",
                    task_id,
                    dir.display(),
                    e
                );
            }
        }

        // Delete local branches after worktree cleanup
        let git_service = git::GitService::new();
        for repo in &repositories {
            for branch in &branch_names {
                if let Err(e) = git_service.delete_branch(&repo.path, branch) {
                    tracing::debug!(
                        "Could not delete branch '{}' from repo '{}': {}",
                        branch,
                        repo.name,
                        e
                    );
                }
            }
        }

        match Repo::delete_orphaned(&pool_clone).await {
            Ok(count) if count > 0 => {
                tracing::info!("Deleted {} orphaned repo records", count);
            }
            Err(e) => {
                tracing::error!("Failed to delete orphaned repos: {}", e);
            }
            _ => {}
        }
    });

    let updated = Task::find_by_id(pool, task.id)
        .await?
        .ok_or(ApiError::Database(SqlxError::RowNotFound))?;

    Ok((
        StatusCode::ACCEPTED,
        ResponseJson(ApiResponse::success(updated)),
    ))
}

/// Get or create a design session for a task.
/// Design sessions allow users to chat with Claude for planning before creating workspaces.
pub async fn get_or_create_design_session(
    Extension(task): Extension<Task>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Session>>, ApiError> {
    let pool = &deployment.db().pool;

    // If task already has a design session, return it
    if let Some(design_session_id) = task.design_session_id {
        if let Some(session) = Session::find_by_id(pool, design_session_id).await? {
            return Ok(ResponseJson(ApiResponse::success(session)));
        }
        // Session was deleted but task still references it - create new one
    }

    // Create a new design session (without workspace)
    let session_id = Uuid::new_v4();
    let session = Session::create_design_session(
        pool,
        &CreateSession { executor: None },
        session_id,
    )
    .await?;

    // Link the session to the task
    Task::update_design_session_id(pool, task.id, Some(session.id)).await?;

    tracing::info!(
        "Created design session {} for task {}",
        session.id,
        task.id
    );

    Ok(ResponseJson(ApiResponse::success(session)))
}

/// Get all messages in a design session
pub async fn get_design_messages(
    Extension(task): Extension<Task>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<DesignMessage>>>, ApiError> {
    let pool = &deployment.db().pool;

    // Get design session ID
    let design_session_id = task.design_session_id.ok_or(ApiError::BadRequest(
        "Design session not found for this task".to_string(),
    ))?;

    let messages = DesignMessage::find_by_session_id(pool, design_session_id).await?;

    Ok(ResponseJson(ApiResponse::success(messages)))
}

#[derive(Debug, Deserialize, TS)]
pub struct AddDesignMessageRequest {
    pub content: String,
    pub role: DesignMessageRole,
}

/// Add a message to a design session
pub async fn add_design_message(
    Extension(task): Extension<Task>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<AddDesignMessageRequest>,
) -> Result<ResponseJson<ApiResponse<DesignMessage>>, ApiError> {
    let pool = &deployment.db().pool;

    // Get or create design session
    let design_session_id = if let Some(id) = task.design_session_id {
        id
    } else {
        // Create design session if not exists
        let session_id = Uuid::new_v4();
        let session = Session::create_design_session(
            pool,
            &CreateSession { executor: None },
            session_id,
        )
        .await?;

        Task::update_design_session_id(pool, task.id, Some(session.id)).await?;
        session.id
    };

    let message = DesignMessage::create(
        pool,
        design_session_id,
        &CreateDesignMessage {
            role: payload.role,
            content: payload.content,
        },
    )
    .await?;

    Ok(ResponseJson(ApiResponse::success(message)))
}

/// Design session response with messages
#[derive(Debug, Serialize, TS)]
pub struct DesignSessionWithMessages {
    pub session: Session,
    pub messages: Vec<DesignMessage>,
}

/// Request for AI chat in design session
#[derive(Debug, Deserialize, TS)]
pub struct DesignChatRequest {
    pub message: String,
    /// When true, skip saving messages to DB and skip loading conversation history.
    /// Used by changelog generation to avoid context accumulation across steps.
    #[serde(default)]
    pub skip_history: Option<bool>,
}

/// Response from AI chat in design session
#[derive(Debug, Serialize, TS)]
pub struct DesignChatResponse {
    pub user_message: DesignMessage,
    pub assistant_message: DesignMessage,
}

/// Send a message to the design chat and get AI response
pub async fn design_chat(
    Extension(task): Extension<Task>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<DesignChatRequest>,
) -> Result<ResponseJson<ApiResponse<DesignChatResponse>>, ApiError> {
    let pool = &deployment.db().pool;

    // Get or create design session
    let design_session_id = if let Some(id) = task.design_session_id {
        id
    } else {
        let session_id = Uuid::new_v4();
        let session = Session::create_design_session(
            pool,
            &CreateSession { executor: None },
            session_id,
        )
        .await?;
        Task::update_design_session_id(pool, task.id, Some(session.id)).await?;
        session.id
    };

    // Save user message
    let user_message = DesignMessage::create(
        pool,
        design_session_id,
        &CreateDesignMessage {
            role: DesignMessageRole::User,
            content: payload.message.clone(),
        },
    )
    .await?;

    // Get existing messages for context
    let existing_messages = DesignMessage::find_by_session_id(pool, design_session_id).await?;

    // Call Claude CLI for AI response
    let ai_response =
        call_claude_for_design(&existing_messages, &payload.message, &task, design_session_id)
            .await?;

    // Save assistant message
    let assistant_message = DesignMessage::create(
        pool,
        design_session_id,
        &CreateDesignMessage {
            role: DesignMessageRole::Assistant,
            content: ai_response,
        },
    )
    .await?;

    Ok(ResponseJson(ApiResponse::success(DesignChatResponse {
        user_message,
        assistant_message,
    })))
}

/// Call Claude CLI to get AI response for design chat
async fn call_claude_for_design(
    messages: &[DesignMessage],
    user_message: &str,
    task: &Task,
    design_session_id: Uuid,
) -> Result<String, ApiError> {
    let can_resume = messages
        .iter()
        .any(|m| m.role == DesignMessageRole::Assistant);

    let system_prompt = "You are a helpful assistant for software design discussions. \
        Help the user plan and design their implementation. \
        Be concise but thorough. Respond in the same language as the user.";

    let task_description = task.description.as_deref().unwrap_or("(no description)");

    // When resuming, CLI already has conversation context — only send new message.
    let prompt = if can_resume {
        user_message.to_string()
    } else {
        format!(
            "{}\n\nTask Title: {}\nTask Description: {}\n\nUser: {}",
            system_prompt, task.title, task_description, user_message
        )
    };

    // Call claude CLI with timeout (uses existing authentication from ~/.claude.json)
    tracing::debug!("Calling claude CLI for design chat (resume={})", can_resume);

    // Build CLI args: use --resume for ongoing sessions, --session-id for new ones
    let cli_session_id_str = design_session_id.to_string();
    let mut cli_args = vec![
        "--print",
        "--tools=Read,Glob,Grep,Edit,Write,WebSearch,WebFetch,LSP",
        "--permission-mode=bypassPermissions",
    ];
    if can_resume {
        cli_args.extend(["--resume", &cli_session_id_str]);
    } else {
        cli_args.extend(["--session-id", &cli_session_id_str]);
    }

    // Spawn CLI and write prompt via stdin to avoid ARG_MAX limit (os error 7)
    let mut child = tokio::process::Command::new("claude")
        .args(&cli_args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| {
            tracing::error!("Failed to spawn claude CLI: {}", e);
            ApiError::BadRequest(format!(
                "Failed to spawn claude CLI: {}. Make sure claude is installed and authenticated.",
                e
            ))
        })?;

    // Write prompt to stdin and close it
    {
        use tokio::io::AsyncWriteExt;
        let mut stdin = child.stdin.take().ok_or_else(|| {
            ApiError::BadRequest("Failed to open claude CLI stdin".to_string())
        })?;
        stdin.write_all(prompt.as_bytes()).await.map_err(|e| {
            tracing::error!("Failed to write prompt to claude CLI stdin: {}", e);
            ApiError::BadRequest(format!("Failed to write prompt to claude CLI: {}", e))
        })?;
        drop(stdin); // Close stdin to signal EOF
    }

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(120), // 2 minute timeout
        child.wait_with_output(),
    )
    .await
    .map_err(|_| {
        tracing::error!("Claude CLI timed out after 120 seconds");
        ApiError::BadRequest("Claude CLI timed out. Please try again with a shorter message.".to_string())
    })?
    .map_err(|e| {
        tracing::error!("Failed to run claude CLI: {}", e);
        ApiError::BadRequest(format!(
            "Failed to run claude CLI: {}. Make sure claude is installed and authenticated.",
            e
        ))
    })?;

    tracing::debug!("Claude CLI completed with status: {}", output.status);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::error!("Claude CLI error (stderr): {}", stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        tracing::error!("Claude CLI error (stdout): {}", stdout);
        return Err(ApiError::BadRequest(format!(
            "Claude CLI error: {}",
            if stderr.trim().is_empty() { stdout.trim() } else { stderr.trim() }
        )));
    }

    let response = String::from_utf8(output.stdout).map_err(|e| {
        tracing::error!("Invalid UTF-8 from claude CLI: {}", e);
        ApiError::BadRequest(format!("Invalid UTF-8 response from Claude: {}", e))
    })?;

    tracing::debug!("Claude CLI response length: {} chars", response.len());

    Ok(response.trim().to_string())
}

/// SSE event types for design chat streaming
#[derive(Debug, Serialize, TS)]
#[serde(tag = "type", content = "data")]
pub enum DesignChatStreamEvent {
    /// User message was saved
    UserMessageSaved { message: DesignMessage },
    /// Chunk of assistant response
    AssistantChunk { content: String },
    /// Assistant response complete
    AssistantComplete { message: DesignMessage },
    /// Tool use started
    ToolUse {
        tool_name: String,
        tool_input: serde_json::Value,
    },
    /// Tool result received
    ToolResult {
        tool_name: String,
        output: String,
    },
    /// Error occurred
    Error { message: String },
}

/// Types for parsing Claude CLI streaming JSON output
mod cli_protocol {
    use serde::Deserialize;

    /// Event envelope from CLI stdout (stream-json format)
    #[derive(Debug, Deserialize)]
    pub struct SdkEventEnvelope {
        #[serde(rename = "type")]
        pub type_: String,
        #[serde(flatten)]
        pub properties: serde_json::Value,
    }
}

/// Stream design chat response using Server-Sent Events with Claude CLI interactive mode
pub async fn design_chat_stream(
    Extension(task): Extension<Task>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<DesignChatRequest>,
) -> Result<Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>>, ApiError> {
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command;

    let pool = deployment.db().pool.clone();

    // Get or create design session
    let design_session_id = if let Some(id) = task.design_session_id {
        id
    } else {
        let session_id = Uuid::new_v4();
        let session = Session::create_design_session(
            &pool,
            &CreateSession { executor: None },
            session_id,
        )
        .await?;
        Task::update_design_session_id(&pool, task.id, Some(session.id)).await?;
        session.id
    };

    let skip_history = payload.skip_history.unwrap_or(false);

    // Check if CLI session can be resumed (has prior assistant messages)
    let can_resume = if !skip_history {
        let existing_messages =
            DesignMessage::find_by_session_id(&pool, design_session_id).await?;
        existing_messages
            .iter()
            .any(|m| m.role == DesignMessageRole::Assistant)
    } else {
        false
    };

    // Save user message (skip when caller provides all context inline, e.g. changelog generation)
    let user_message = if !skip_history {
        Some(
            DesignMessage::create(
                &pool,
                design_session_id,
                &CreateDesignMessage {
                    role: DesignMessageRole::User,
                    content: payload.message.clone(),
                },
            )
            .await?,
        )
    } else {
        None
    };

    let system_prompt = "You are a helpful assistant for software design discussions. \
        Help the user plan and design their implementation. \
        Be concise but thorough. Respond in the same language as the user.";

    let task_description = task.description.as_deref().unwrap_or("(no description)");

    // When resuming, CLI already has conversation context — only send new message.
    // Otherwise, send full context (system prompt + task info + user message).
    let prompt = if can_resume {
        payload.message.clone()
    } else {
        format!(
            "{}\n\nTask Title: {}\nTask Description: {}\n\nUser: {}",
            system_prompt, task.title, task_description, payload.message
        )
    };

    // Get repos for the project to determine working directory
    let repos = ProjectRepo::find_repos_for_project(&pool, task.project_id)
        .await
        .unwrap_or_default();

    // Use the first repo's path as working directory, fallback to home
    let working_dir = if let Some(repo) = repos.first() {
        repo.path.to_string_lossy().to_string()
    } else {
        std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string())
    };

    // Create the SSE stream using Claude CLI --print mode with streaming
    let stream = async_stream::stream! {
        // Send the saved user message (only when history is being tracked)
        if let Some(ref user_msg) = user_message {
            let user_event = DesignChatStreamEvent::UserMessageSaved {
                message: user_msg.clone(),
            };
            yield Ok(Event::default().json_data(&user_event).unwrap());
        }

        // Build CLI args: use --resume for ongoing sessions, --session-id for new ones
        let cli_session_id_str = design_session_id.to_string();
        let mut cli_args = vec![
            "-y",
            "@anthropic-ai/claude-code",
            "--print",
            "--output-format=stream-json",
            "--include-partial-messages",
            "--verbose",
            "--tools=Read,Glob,Grep,Edit,Write,WebSearch,WebFetch,LSP",
            "--permission-mode=bypassPermissions",
        ];
        if can_resume {
            cli_args.extend(["--resume", &cli_session_id_str]);
        } else if !skip_history {
            cli_args.extend(["--session-id", &cli_session_id_str]);
        } else {
            cli_args.push("--no-session-persistence");
        }

        let mut child = match Command::new("npx")
            .args(&cli_args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .current_dir(&working_dir)
            .env("NPM_CONFIG_LOGLEVEL", "error")
            .kill_on_drop(true)
            .spawn()
        {
            Ok(child) => child,
            Err(e) => {
                tracing::error!("Failed to spawn Claude CLI: {}", e);
                let error_event = DesignChatStreamEvent::Error {
                    message: format!("Failed to spawn Claude CLI: {}. Make sure npx is available.", e),
                };
                yield Ok(Event::default().json_data(&error_event).unwrap());
                return;
            }
        };

        // Write prompt via stdin to avoid ARG_MAX limit (os error 7)
        if let Some(mut stdin) = child.stdin.take() {
            use tokio::io::AsyncWriteExt;
            if let Err(e) = stdin.write_all(prompt.as_bytes()).await {
                tracing::error!("Failed to write prompt to Claude CLI stdin: {}", e);
                let error_event = DesignChatStreamEvent::Error {
                    message: format!("Failed to write prompt to Claude CLI: {}", e),
                };
                yield Ok(Event::default().json_data(&error_event).unwrap());
                return;
            }
            drop(stdin); // Close stdin to signal EOF
        }

        let stdout = match child.stdout.take() {
            Some(stdout) => stdout,
            None => {
                let error_event = DesignChatStreamEvent::Error {
                    message: "Failed to get Claude CLI stdout".to_string(),
                };
                yield Ok(Event::default().json_data(&error_event).unwrap());
                return;
            }
        };

        // Spawn a task to consume stderr (prevents buffer fill-up deadlock)
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr);
                let mut line = String::new();
                loop {
                    line.clear();
                    match reader.read_line(&mut line).await {
                        Ok(0) => break, // EOF
                        Ok(_) => {
                            let trimmed = line.trim();
                            if !trimmed.is_empty() {
                                tracing::debug!("Claude CLI stderr: {}", trimmed);
                            }
                        }
                        Err(e) => {
                            tracing::warn!("Error reading stderr: {}", e);
                            break;
                        }
                    }
                }
            });
        }

        // Read streaming output
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        // Text accumulated from stream_event deltas (token-by-token)
        let mut streamed_text = String::new();
        // Final result text from CLI (complete response for DB save)
        let mut final_result_text = String::new();
        // Track emitted tool_use IDs to prevent duplicates from partial messages
        let mut emitted_tool_ids = std::collections::HashSet::<String>::new();

        loop {
            line.clear();
            match tokio::time::timeout(
                std::time::Duration::from_secs(120),
                reader.read_line(&mut line)
            ).await {
                Ok(Ok(0)) => {
                    // EOF
                    tracing::debug!("Claude CLI EOF");
                    break;
                }
                Ok(Ok(_)) => {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }

                    tracing::trace!("CLI output: {}", trimmed);

                    // Parse JSON line
                    if let Ok(envelope) = serde_json::from_str::<cli_protocol::SdkEventEnvelope>(trimmed) {
                        match envelope.type_.as_str() {
                            "assistant" => {
                                // Only process tool_use blocks from assistant messages.
                                // Text is handled exclusively by stream_event to avoid
                                // duplication issues with partial messages.
                                if let Some(message) = envelope.properties.get("message") {
                                    if let Some(content) = message.get("content").and_then(|c| c.as_array()) {
                                        for block in content {
                                            if block.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                                                let tool_id = block.get("id")
                                                    .and_then(|id| id.as_str())
                                                    .unwrap_or("")
                                                    .to_string();
                                                // Only emit complete tool_use (has non-null input)
                                                // and hasn't been emitted yet
                                                let has_input = block.get("input")
                                                    .map_or(false, |i| !i.is_null());

                                                if has_input && (tool_id.is_empty() || !emitted_tool_ids.contains(&tool_id)) {
                                                    if !tool_id.is_empty() {
                                                        emitted_tool_ids.insert(tool_id);
                                                    }

                                                    let tool_name = block.get("name")
                                                        .and_then(|n| n.as_str())
                                                        .unwrap_or("unknown")
                                                        .to_string();
                                                    let tool_input = block.get("input")
                                                        .cloned()
                                                        .unwrap_or(serde_json::Value::Null);

                                                    let tool_event = DesignChatStreamEvent::ToolUse {
                                                        tool_name,
                                                        tool_input,
                                                    };
                                                    yield Ok(Event::default().json_data(&tool_event).unwrap());
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            "user" => {
                                // Handle tool_result blocks in user messages
                                if let Some(message) = envelope.properties.get("message") {
                                    if let Some(content) = message.get("content").and_then(|c| c.as_array()) {
                                        for block in content {
                                            if block.get("type").and_then(|t| t.as_str()) == Some("tool_result") {
                                                let tool_name = block.get("tool_use_id")
                                                    .and_then(|id| id.as_str())
                                                    .unwrap_or("unknown")
                                                    .to_string();
                                                let output = block.get("content")
                                                    .and_then(|c| {
                                                        if let Some(s) = c.as_str() {
                                                            Some(s.to_string())
                                                        } else if let Some(arr) = c.as_array() {
                                                            // content is an array - extract text items
                                                            let texts: Vec<String> = arr.iter()
                                                                .filter_map(|item| {
                                                                    if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                                                                        item.get("text").and_then(|t| t.as_str()).map(|s| s.to_string())
                                                                    } else {
                                                                        None
                                                                    }
                                                                })
                                                                .collect();
                                                            Some(texts.join("\n"))
                                                        } else {
                                                            None
                                                        }
                                                    })
                                                    .unwrap_or_default();

                                                let result_event = DesignChatStreamEvent::ToolResult {
                                                    tool_name,
                                                    output,
                                                };
                                                yield Ok(Event::default().json_data(&result_event).unwrap());
                                            }
                                        }
                                    }
                                }
                            }
                            "stream_event" => {
                                // Token-by-token streaming via stream_event (primary text source)
                                // event.type = "content_block_delta", event.delta.text contains the token
                                if let Some(event) = envelope.properties.get("event") {
                                    if event.get("type").and_then(|t| t.as_str()) == Some("content_block_delta") {
                                        if let Some(delta) = event.get("delta") {
                                            if let Some(text) = delta.get("text").and_then(|t| t.as_str()) {
                                                if !text.is_empty() {
                                                    let chunk_event = DesignChatStreamEvent::AssistantChunk {
                                                        content: text.to_string(),
                                                    };
                                                    yield Ok(Event::default().json_data(&chunk_event).unwrap());
                                                    streamed_text.push_str(text);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            "result" => {
                                // CLI is done - extract final text for database save
                                if let Some(result) = envelope.properties.get("result").and_then(|r| r.as_str()) {
                                    final_result_text = result.to_string();
                                }
                                tracing::debug!("Got result, CLI complete");
                                break;
                            }
                            other => {
                                tracing::debug!("Unhandled CLI event type: {}", other);
                            }
                        }
                    }
                }
                Ok(Err(e)) => {
                    tracing::error!("Error reading CLI stdout: {}", e);
                    let error_event = DesignChatStreamEvent::Error {
                        message: format!("Error reading from Claude CLI: {}", e),
                    };
                    yield Ok(Event::default().json_data(&error_event).unwrap());
                    break;
                }
                Err(_) => {
                    tracing::error!("Claude CLI timed out");
                    let error_event = DesignChatStreamEvent::Error {
                        message: "Claude CLI timed out after 120 seconds".to_string(),
                    };
                    yield Ok(Event::default().json_data(&error_event).unwrap());
                    break;
                }
            }
        }

        // Wait for the process to finish
        let _ = child.wait().await;

        // Save assistant message to database (skip when skip_history is true)
        // Prefer final_result_text (complete response from CLI), fall back to streamed text
        let response_to_save = if !final_result_text.trim().is_empty() {
            final_result_text.trim().to_string()
        } else {
            streamed_text.trim().to_string()
        };

        if !response_to_save.is_empty() {
            if !skip_history {
                let assistant_message = match DesignMessage::create(
                    &pool,
                    design_session_id,
                    &CreateDesignMessage {
                        role: DesignMessageRole::Assistant,
                        content: response_to_save,
                    },
                )
                .await
                {
                    Ok(msg) => msg,
                    Err(e) => {
                        tracing::error!("Failed to save assistant message: {}", e);
                        let error_event = DesignChatStreamEvent::Error {
                            message: format!("Failed to save response: {}", e),
                        };
                        yield Ok(Event::default().json_data(&error_event).unwrap());
                        return;
                    }
                };

                // Send completion event
                let complete_event = DesignChatStreamEvent::AssistantComplete {
                    message: assistant_message,
                };
                yield Ok(Event::default().json_data(&complete_event).unwrap());
            }
            // skip_history mode: response was streamed but not saved to DB
        } else {
            tracing::warn!("No response received from Claude CLI");
            let error_event = DesignChatStreamEvent::Error {
                message: "No response received from Claude CLI".to_string(),
            };
            yield Ok(Event::default().json_data(&error_event).unwrap());
        }
    };

    Ok(Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(std::time::Duration::from_secs(15))
            .text("keep-alive"),
    ))
}

/// Get design session with all messages
pub async fn get_design_session_with_messages(
    Extension(task): Extension<Task>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<DesignSessionWithMessages>>, ApiError> {
    let pool = &deployment.db().pool;

    // Get or create design session
    let (session, is_new) = if let Some(design_session_id) = task.design_session_id {
        if let Some(session) = Session::find_by_id(pool, design_session_id).await? {
            (session, false)
        } else {
            // Session was deleted but task still references it - create new one
            let session_id = Uuid::new_v4();
            let session = Session::create_design_session(
                pool,
                &CreateSession { executor: None },
                session_id,
            )
            .await?;
            Task::update_design_session_id(pool, task.id, Some(session.id)).await?;
            (session, true)
        }
    } else {
        // Create a new design session
        let session_id = Uuid::new_v4();
        let session = Session::create_design_session(
            pool,
            &CreateSession { executor: None },
            session_id,
        )
        .await?;
        Task::update_design_session_id(pool, task.id, Some(session.id)).await?;
        (session, true)
    };

    let messages = if is_new {
        vec![]
    } else {
        DesignMessage::find_by_session_id(pool, session.id).await?
    };

    Ok(ResponseJson(ApiResponse::success(DesignSessionWithMessages {
        session,
        messages,
    })))
}

pub fn router(deployment: &DeploymentImpl) -> Router<DeploymentImpl> {
    let task_actions_router = Router::new()
        .route("/", put(update_task))
        .route("/", delete(delete_task))
        .route("/reset-to-todo", post(reset_to_todo))
        .route("/design-session", get(get_or_create_design_session))
        .route("/design-session/full", get(get_design_session_with_messages))
        .route(
            "/design-session/messages",
            get(get_design_messages).post(add_design_message),
        )
        .route("/design-session/chat", post(design_chat))
        .route("/design-session/chat/stream", post(design_chat_stream));

    let task_id_router = Router::new()
        .route("/", get(get_task))
        .merge(task_actions_router)
        .layer(from_fn_with_state(deployment.clone(), load_task_middleware));

    let inner = Router::new()
        .route("/", get(get_tasks).post(create_task))
        .route("/stream/ws", get(stream_tasks_ws))
        .route("/create-and-start", post(create_task_and_start))
        .nest("/{task_id}", task_id_router);

    // mount under /projects/:project_id/tasks
    Router::new().nest("/tasks", inner)
}
