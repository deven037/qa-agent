# QA Agent — AI-Powered Test Automation Platform

**Version 1.0.0**

An end-to-end QA automation platform that turns Jira stories into executed browser tests — with no manual scripting. The platform autonomously generates test cases by exploring your live app, executes them in a real browser, and posts results back to Jira.

---

## What It Does

| Feature | Description |
|---|---|
| **Manual TC Creation** | AI explores your live app, captures element maps and ARIA snapshots, generates structured test cases grounded in real UI |
| **Autonomous Execution** | Single-conversation LLM agent drives a full browser test end-to-end — no step-by-step scripting |
| **Per-Step Screenshots** | Screenshot captured after every step, stored in the execution report as proof |
| **Jira Integration** | Loads test steps from Jira, posts `[QA-RESULTS]` comments automatically after execution |
| **Multi-Provider AI** | Rotates across Gemini 2.5 Flash → Groq → Together → OpenRouter → Cerebras → Sambanova — all free tiers |
| **Execution Reports** | Per-run reports with step timeline, pass/fail status, screenshots, and 2-day auto-expiry |
| **Local Runner** | Run tests on your local machine instead of the server via a local runner script |

---

## Stack

- **Framework**: Next.js (App Router) + TypeScript
- **Auth**: NextAuth.js v5 — credentials + JWT, MongoDB for user storage
- **Database**: MongoDB Atlas (free M0) — users + execution reports
- **Test Artifacts**: Jira — test steps stored as ADF tables in issue descriptions
- **Browser Automation**: Playwright + `@playwright/mcp` (MCP bridge)
- **AI Providers**: Google Gemini, Groq, Together AI, OpenRouter, Cerebras, Sambanova
- **Deployment**: Docker → Google Cloud (GCP) via GitHub Actions

---

## Getting Started

### Prerequisites

- Node.js 20+
- MongoDB Atlas connection string
- Jira account + API token
- At least one AI API key (Gemini free tier recommended)

### Environment Variables

Create `.env.local`:

```env
# Auth
NEXTAUTH_SECRET=your_secret
NEXTAUTH_URL=http://localhost:3000

# MongoDB
MONGODB_URI=mongodb+srv://...

# Jira
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_ADMIN_EMAIL=your@email.com
JIRA_API_TOKEN=your_jira_token

# AI Providers (add _2, _3 etc. for rotation)
GEMINI_API_KEY_1=your_key
GROQ_API_KEY_1=your_key
OPENROUTER_API_KEY_1=your_key
TOGETHER_API_KEY_1=your_key
CEREBRAS_API_KEY_1=your_key
SAMBANOVA_API_KEY_1=your_key
```

### Run Locally

```bash
npm install
npm run dev
# Open http://localhost:3000
```

### Docker

```bash
docker build -t qa-agent .
docker run -p 3000:3000 --env-file .env.local qa-agent
```

---

## How It Works

### Manual TC Creation (`/manual-tc`)
1. Enter a Jira issue key and a description of what to test
2. Agent does a **live recon** — headless Playwright visits your app, captures ARIA snapshots and element maps per page
3. LLM generates structured test cases grounded in real field names and locators
4. **Step verifier** validates every locator against the live app before you review
5. Save to Jira with one click

### Automation (`/automation`)
1. Load a Jira issue that has test steps
2. Hit **Execute** — the autonomous agent starts a single browser session
3. The LLM receives the full test case and drives the browser autonomously:
   - Calls `browser_navigate`, `browser_fill_form`, `browser_click`, `browser_snapshot` etc.
   - After each step: takes a screenshot, calls `mark_step(passed/failed)`
   - On completion: calls `mark_tc_done`
4. Results posted to Jira, full report saved with per-step screenshots

### AI Provider Rotation
The agent tries providers in priority order. On rate limit or error it rotates automatically:
```
Gemini 2.5 Flash → Gemini 2.0 Flash → Groq → Together → OpenRouter → Cerebras → Sambanova
```
Llama-based providers receive a reduced tool set (9 tools) to avoid schema validation errors.

---

## Project Structure

```
app/
  api/agents/          # SSE streaming endpoints (execute, generate-tc, explore)
  apps/[appId]/        # Per-app pages (automation, manual-tc, reports, work-items)
lib/
  agents/              # Core AI agents
    autonomous-mcp-agent.ts   # Main execution engine
    live-recon-agent.ts       # Live app exploration for TC generation
    step-verifier.ts          # Pre-flight locator validation
    testcase-agent.ts         # Test case generation
  db/models/           # Mongoose models (TestRun)
  jira/                # Jira API client
  prompts/             # LLM prompt templates (markdown)
components/            # React UI components
scripts/
  local-runner.ts      # Local machine runner (alternative to server execution)
```

---

## Deployment

Pushes to `staging` branch trigger automatic Docker build + deploy via GitHub Actions.
Merge `staging → main` to release to production.

Server: GCP VM at `136.114.184.224:3000`

---

## Version History

| Version | Date | Highlights |
|---|---|---|
| 1.0.0 | 2026-06-27 | Autonomous MCP agent, live recon TC generation, per-step screenshots, multi-provider rotation, Sambanova support |
