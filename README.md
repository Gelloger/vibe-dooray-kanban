<p align="center">
  <a href="https://vibekanban.com">
    <picture>
      <source srcset="frontend/public/vibe-kanban-logo-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="frontend/public/vibe-kanban-logo.svg" media="(prefers-color-scheme: light)">
      <img src="frontend/public/vibe-kanban-logo.svg" alt="Vibe Kanban Logo">
    </picture>
  </a>
</p>

<p align="center">Get 10X more out of Claude Code, Gemini CLI, Codex, Amp and other coding agents...</p>
<p align="center">
  <a href="https://www.npmjs.com/package/vibe-kanban"><img alt="npm" src="https://img.shields.io/npm/v/vibe-kanban?style=flat-square" /></a>
  <a href="https://github.com/BloopAI/vibe-kanban/blob/main/.github/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/BloopAI/vibe-kanban/.github%2Fworkflows%2Fpublish.yml" /></a>
  <a href="https://deepwiki.com/BloopAI/vibe-kanban"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"></a>
</p>

<h1 align="center">
  <a href="https://jobs.polymer.co/vibe-kanban?source=github"><strong>We're hiring!</strong></a>
</h1>

![](frontend/public/vibe-kanban-screenshot-overview.png)

## Overview

AI coding agents are increasingly writing the world's code and human engineers now spend the majority of their time planning, reviewing, and orchestrating tasks. Vibe Kanban streamlines this process, enabling you to:

- Easily switch between different coding agents
- Orchestrate the execution of multiple coding agents in parallel or in sequence
- Quickly review work and start dev servers
- Track the status of tasks that your coding agents are working on
- Centralise configuration of coding agent MCP configs
- Open projects remotely via SSH when running Vibe Kanban on a remote server
- **Dooray Integration**: Sync tasks with NHN Dooray project management platform

You can watch a video overview [here](https://youtu.be/TFT3KnZOOAk).

## Installation

Make sure you have authenticated with your favourite coding agent. A full list of supported coding agents can be found in the [docs](https://vibekanban.com/docs). Then in your terminal run:

```bash
npx vibe-kanban
```

## Dooray Integration

Vibe Kanban supports integration with [NHN Dooray](https://dooray.com), a project management and collaboration platform.

### Features

- **Task Sync**: Import tasks from Dooray projects and sync status changes
- **Task Creation**: Create Dooray tasks directly from Vibe Kanban with AI-assisted summary and split
- **Comment Integration**: Post comments to Dooray tasks from your workflow
- **Tag & Project Filtering**: Filter and organize tasks by Dooray tags and projects

### Prerequisites

Before setting up Dooray integration, you need:

1. **Dooray Account**: An active NHN Dooray account with project access
2. **API Token**: A Dooray API token for authentication
3. **Domain**: Your Dooray tenant domain (e.g., `your-company` from `your-company.dooray.com`)

### Getting Your Dooray API Token

1. Log in to your Dooray account
2. Click your profile icon in the top-right corner
3. Go to **Settings** → **API Token**
4. Click **Generate Token** and copy the generated token
5. Store this token securely - it won't be shown again

> ⚠️ **Security Note**: Keep your API token private. Never commit it to version control or share it publicly.

### Setup Guide

#### Step 1: Open Dooray Settings

1. Launch Vibe Kanban (`npx vibe-kanban` or `pnpm run dev`)
2. Click the **Settings** icon (⚙️) in the navigation bar
3. Navigate to the **Dooray** tab

#### Step 2: Configure Connection

1. **Domain**: Enter your Dooray domain (e.g., `your-company`)
   - This is the subdomain part of your Dooray URL
2. **API Token**: Paste your Dooray API token
3. Click **Save** to verify the connection

#### Step 3: Select Project

1. After saving, a list of available projects will appear
2. Select the project you want to sync with Vibe Kanban
3. The project's tasks and tags will be loaded

#### Step 4: Configure Tag Filters (Optional)

1. Select specific tags to filter which tasks are synced
2. Only tasks with the selected tags will appear in Vibe Kanban
3. Leave empty to sync all tasks from the project

### Usage

#### Syncing Tasks from Dooray

- Click the **Sync** button in the task panel to import tasks from Dooray
- Tasks will be imported with their title, description, and status
- Changes made in Vibe Kanban can be synced back to Dooray

#### Creating Tasks in Dooray

1. Click **Create Dooray Task** button
2. Enter the task title and description
3. (Optional) Use **AI Summary/Split** to:
   - Summarize long descriptions
   - Split large tasks into subtasks
4. Click **Create** to save the task to Dooray

#### Posting Comments

- Select a task linked to Dooray
- Use the comment feature to post updates directly to the Dooray task

### Troubleshooting

| Issue | Solution |
|-------|----------|
| "Invalid API Token" | Regenerate your token in Dooray settings |
| "Project not found" | Check your domain and ensure you have project access |
| "Failed to sync" | Verify your network connection and API token permissions |
| Tasks not appearing | Check tag filter settings or try syncing again |

### AI-Powered Task Management

When creating Dooray tasks, you can use AI to:
- **Summarize** long task descriptions into concise summaries
- **Split** large tasks into smaller subtasks automatically
- **Edit** AI suggestions before creating tasks

This feature uses your connected AI agent (Claude Code, Gemini, etc.) for processing.

## Documentation

Please head to the [website](https://vibekanban.com/docs) for the latest documentation and user guides.

## Support

We use [GitHub Discussions](https://github.com/BloopAI/vibe-kanban/discussions) for feature requests. Please open a discussion to create a feature request. For bugs please open an issue on this repo.

## Contributing

We would prefer that ideas and changes are first raised with the core team via [GitHub Discussions](https://github.com/BloopAI/vibe-kanban/discussions) or [Discord](https://discord.gg/AC4nwVtJM3), where we can discuss implementation details and alignment with the existing roadmap. Please do not open PRs without first discussing your proposal with the team.

## Development

### Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [Node.js](https://nodejs.org/) (>=18)
- [pnpm](https://pnpm.io/) (>=8)

Additional development tools:
```bash
cargo install cargo-watch
cargo install sqlx-cli
```

Install dependencies:
```bash
pnpm i
```

### Running the dev server

```bash
pnpm run dev
```

This will start the backend. A blank DB will be copied from the `dev_assets_seed` folder.

### Building the frontend

To build just the frontend:

```bash
cd frontend
pnpm build
```

### Build from source (macOS)

1. Run `./local-build.sh`
2. Test with `cd npx-cli && node bin/cli.js`


### Environment Variables

The following environment variables can be configured at build time or runtime:

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `POSTHOG_API_KEY` | Build-time | Empty | PostHog analytics API key (disables analytics if empty) |
| `POSTHOG_API_ENDPOINT` | Build-time | Empty | PostHog analytics endpoint (disables analytics if empty) |
| `PORT` | Runtime | Auto-assign | **Production**: Server port. **Dev**: Frontend port (backend uses PORT+1) |
| `BACKEND_PORT` | Runtime | `0` (auto-assign) | Backend server port (dev mode only, overrides PORT+1) |
| `FRONTEND_PORT` | Runtime | `3000` | Frontend dev server port (dev mode only, overrides PORT) |
| `HOST` | Runtime | `127.0.0.1` | Backend server host |
| `MCP_HOST` | Runtime | Value of `HOST` | MCP server connection host (use `127.0.0.1` when `HOST=0.0.0.0` on Windows) |
| `MCP_PORT` | Runtime | Value of `BACKEND_PORT` | MCP server connection port |
| `DISABLE_WORKTREE_CLEANUP` | Runtime | Not set | Disable all git worktree cleanup including orphan and expired workspace cleanup (for debugging) |
| `VK_ALLOWED_ORIGINS` | Runtime | Not set | Comma-separated list of origins that are allowed to make backend API requests (e.g., `https://my-vibekanban-frontend.com`) |

**Build-time variables** must be set when running `pnpm run build`. **Runtime variables** are read when the application starts.

#### Self-Hosting with a Reverse Proxy or Custom Domain

When running Vibe Kanban behind a reverse proxy (e.g., nginx, Caddy, Traefik) or on a custom domain, you must set the `VK_ALLOWED_ORIGINS` environment variable. Without this, the browser's Origin header won't match the backend's expected host, and API requests will be rejected with a 403 Forbidden error.

Set it to the full origin URL(s) where your frontend is accessible:

```bash
# Single origin
VK_ALLOWED_ORIGINS=https://vk.example.com

# Multiple origins (comma-separated)
VK_ALLOWED_ORIGINS=https://vk.example.com,https://vk-staging.example.com
```

### Remote Deployment

When running Vibe Kanban on a remote server (e.g., via systemctl, Docker, or cloud hosting), you can configure your editor to open projects via SSH:

1. **Access via tunnel**: Use Cloudflare Tunnel, ngrok, or similar to expose the web UI
2. **Configure remote SSH** in Settings → Editor Integration:
   - Set **Remote SSH Host** to your server hostname or IP
   - Set **Remote SSH User** to your SSH username (optional)
3. **Prerequisites**:
   - SSH access from your local machine to the remote server
   - SSH keys configured (passwordless authentication)
   - VSCode Remote-SSH extension

When configured, the "Open in VSCode" buttons will generate URLs like `vscode://vscode-remote/ssh-remote+user@host/path` that open your local editor and connect to the remote server.

See the [documentation](https://vibekanban.com/docs/configuration-customisation/global-settings#remote-ssh-configuration) for detailed setup instructions.
