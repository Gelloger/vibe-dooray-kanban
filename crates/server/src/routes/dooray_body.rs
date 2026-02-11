use regex::Regex;
use std::collections::HashMap;
use std::sync::LazyLock;

use crate::error::ApiError;

/// Dooray task URL pattern: https://{domain}/project/tasks/{taskId} or https://{domain}/task/{projectId}/{taskId}
pub(crate) static DOORAY_TASK_URL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"https://[\w.-]+\.dooray\.com/(?:project/tasks/(\d+)|task/\d+/(\d+))")
        .expect("Invalid regex")
});

/// Response from GET /project/v1/projects/{projectId}/posts/{postId}
#[derive(Debug, serde::Deserialize)]
struct DoorayTaskDetailForMention {
    result: Option<DoorayTaskDetail>,
}

#[derive(Debug, serde::Deserialize)]
struct DoorayTaskDetail {
    id: String,
    #[serde(default)]
    number: Option<i64>,
    subject: Option<String>,
    #[serde(default, rename = "workflowClass")]
    workflow_class: Option<String>,
    #[serde(default)]
    project: Option<DoorayTaskProject>,
}

#[derive(Debug, serde::Deserialize)]
struct DoorayTaskProject {
    id: Option<String>,
    code: Option<String>,
}

/// Task info needed to build a rich mention
pub(crate) struct TaskMentionInfo {
    pub(crate) task_id: String,
    pub(crate) number: i64,
    pub(crate) subject: String,
    pub(crate) workflow_class: String,
    pub(crate) project_id: String,
    pub(crate) project_code: String,
}

/// Process task body and convert Dooray task URLs to rich inline HTML mentions.
///
/// Returns processed body with URLs replaced by `dooray-flavored-html-mention` `<a>` tags.
/// The mimeType remains `text/x-markdown` (caller handles); Dooray's markdown renderer
/// passes through inline HTML tags.
pub async fn process_body_with_mentions(
    client: &reqwest::Client,
    body: &str,
    dooray_api_base: &str,
    default_project_id: &str,
    project_code: &str,
) -> Result<String, ApiError> {
    // Find all Dooray task URLs in the body
    let task_ids: Vec<String> = DOORAY_TASK_URL_RE
        .captures_iter(body)
        .filter_map(|cap| {
            cap.get(1)
                .or_else(|| cap.get(2))
                .map(|m| m.as_str().to_string())
        })
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    if task_ids.is_empty() {
        return Ok(body.to_string());
    }

    // Fetch task details in parallel
    let fetches: Vec<_> = task_ids
        .iter()
        .map(|task_id| {
            fetch_task_detail(
                client,
                dooray_api_base,
                default_project_id,
                task_id,
                project_code,
            )
        })
        .collect();

    let results = futures_util::future::join_all(fetches).await;

    let mut mention_map: HashMap<String, TaskMentionInfo> = HashMap::new();
    for result in results {
        if let Ok(Some(info)) = result {
            mention_map.insert(info.task_id.clone(), info);
        }
    }

    if mention_map.is_empty() {
        // Could not fetch any task details, return body as-is
        return Ok(body.to_string());
    }

    // Replace task URLs with rich inline HTML mentions directly in the markdown body
    let result = DOORAY_TASK_URL_RE
        .replace_all(body, |caps: &regex::Captures| {
            let task_id = caps
                .get(1)
                .or_else(|| caps.get(2))
                .map(|m| m.as_str())
                .unwrap_or("");

            if let Some(info) = mention_map.get(task_id) {
                build_mention_html(info)
            } else {
                // Keep original URL if we couldn't fetch details
                caps[0].to_string()
            }
        })
        .to_string();

    Ok(result)
}

pub(crate) async fn fetch_task_detail(
    client: &reqwest::Client,
    dooray_api_base: &str,
    project_id: &str,
    task_id: &str,
    default_project_code: &str,
) -> Result<Option<TaskMentionInfo>, ApiError> {
    let url = format!(
        "{}/project/v1/projects/{}/posts/{}",
        dooray_api_base, project_id, task_id
    );

    let response = match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => resp,
        _ => return Ok(None),
    };

    let detail: DoorayTaskDetailForMention = match response.json().await {
        Ok(d) => d,
        Err(_) => return Ok(None),
    };

    let task = match detail.result {
        Some(t) => t,
        None => return Ok(None),
    };

    let number = match task.number {
        Some(n) => n,
        None => return Ok(None),
    };

    let subject = task.subject.unwrap_or_default();
    let workflow_class = task.workflow_class.unwrap_or_else(|| "registered".to_string());
    let proj_id = task
        .project
        .as_ref()
        .and_then(|p| p.id.clone())
        .unwrap_or_else(|| project_id.to_string());
    let proj_code = task
        .project
        .as_ref()
        .and_then(|p| p.code.clone())
        .unwrap_or_else(|| default_project_code.to_string());

    Ok(Some(TaskMentionInfo {
        task_id: task.id,
        number,
        subject,
        workflow_class,
        project_id: proj_id,
        project_code: proj_code,
    }))
}

pub(crate) fn build_mention_html(info: &TaskMentionInfo) -> String {
    let escaped_subject = html_escape(&info.subject);
    format!(
        r#"<a class="dooray-flavored-html-mention task-reference {wf}" href="/project/posts/{tid}" title="{wf}" target="_blank" rel="noopener noreferrer" data-dooray-href="dooray://{pid}/tasks/{tid}" data-id="{tid}">{code}/{num} | {subj}</a>"#,
        wf = html_escape(&info.workflow_class),
        tid = info.task_id,
        pid = info.project_id,
        code = html_escape(&info.project_code),
        num = info.number,
        subj = escaped_subject,
    )
}

pub(crate) fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
