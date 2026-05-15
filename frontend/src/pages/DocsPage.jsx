import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import jsPDF from 'jspdf'
import { useAuth } from '../context/AuthContext'
import Tooltip from '../components/ui/Tooltip'
import {
  B, Code, DocsLayout, Endpoint, IC, Section,
  stepBadge, subHeadClass, tableClass, tdClass, thClass,
} from '../components/docs'
import {
  BookOpen, Zap, Bot, Webhook, Key, CreditCard, Layers, FolderOpen, Code2, Server,
  DollarSign, Shield, MessageSquare, Play, Rocket, Share2, FileText, Clock,
  Cpu, BarChart3, Lock, Check, Database, Coins, Users,
  Download, CalendarClock,
} from 'lucide-react'

// ── Tab: User Guide ──

function UserGuideTab() {
  return (
    <div className="w-full">

      <Section title="Getting Started" icon={Zap} tooltip="6-step quickstart from creating a workflow to triggering it via webhook">
        <p>
          <B>Pabbly AgenticAI</B> is a workflow builder platform where you create multi-step AI workflows through conversation
          with a <B>Master Agent</B>. Each workflow is an ordered sequence of steps — every step has its own LLM, system prompt, tools, and credentials.
        </p>
        <p><B>General workflow:</B></p>
        <div className="flex flex-col gap-2 mt-1">
          {[
            ['1', 'Create a new workflow from the Dashboard'],
            ['2', 'Chat with the Master Agent to design your workflow'],
            ['3', 'The Master Agent creates and configures steps for you'],
            ['4', 'Test your workflow with sample data'],
            ['5', 'Build (validate) and Deploy your workflow'],
            ['6', 'Trigger via webhook from external services'],
          ].map(([n, text]) => (
            <div key={n} className="flex items-start gap-2">
              <span className={stepBadge}>{n}</span>
              <span className="pt-0.5">{text}</span>
            </div>
          ))}
        </div>
        <p className="mt-2">New users receive <B>50 free AI Credits</B> on signup to get started immediately.</p>
      </Section>

      <Section title="Dashboard & Workflow Management" icon={FolderOpen} tooltip="Folders, workflow statuses, bulk actions, and the trash system">
        <p>The Dashboard is your home for managing all workflows. View them in a folder-organized list with search and sort.</p>
        <p className={subHeadClass}>Creating a workflow</p>
        <p>Click <B>New Workflow</B>, enter a name, optionally select a folder, and you'll be taken to the Workflow Builder.</p>
        <p className={subHeadClass}>Workflow statuses</p>
        <table className={tableClass}>
          <thead><tr><th className={thClass}>Status</th><th className={thClass}>Meaning</th></tr></thead>
          <tbody>
            {[
              ['Draft', 'Newly created, no steps configured yet'],
              ['Planning', 'Master Agent is designing the workflow with you'],
              ['Active', 'Deployed to Pabbly Functions — webhook URL is live and ready to be triggered'],
              ['Needs update', 'Steps or credentials have changed since the last deploy (auto-resolved on the next test or run)'],
              ['Failed', 'The most recent validation or deploy surfaced an error'],
            ].map(([s, d]) => (
              <tr key={s}><td className={tdClass}><B>{s}</B></td><td className={tdClass}>{d}</td></tr>
            ))}
          </tbody>
        </table>
        <p className={subHeadClass}>Folders & organization</p>
        <p>Create folders to organize workflows. Nest workflows inside folders, pin folders for quick access. Search and sort workflows by name, status, or date.</p>
        <p className={subHeadClass}>Bulk actions</p>
        <p>Select multiple workflows with checkboxes, then: delete, activate, deactivate, or move to a folder.</p>
        <p className={subHeadClass}>Trash system</p>
        <p>Deleting a workflow moves it to Trash (soft delete). Restore anytime, or permanently delete from Trash. "Empty Trash" removes all trashed workflows permanently.</p>
      </Section>

      <Section title="The Workflow Builder" icon={Bot} tooltip="3-panel layout: Chat (left), Steps (center), Config (right) — collapses to tabs on mobile">
        <p>The builder is a <B>3-panel layout</B> (desktop) or tabbed interface (mobile):</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
          {[
            ['Chat Panel (Left)', 'Conversation with the Master Agent. Send messages, receive streaming responses. The AI creates and modifies steps, tests credentials, and manages files.'],
            ['Steps Panel (Center)', 'Visual pipeline of all workflow steps in order. Shows name, type (AI/Code), status, and live execution progress.'],
            ['Config Panel (Right)', 'Configuration for the selected step. Edit name, description, system prompt, tools, model, and credentials.'],
          ].map(([title, desc]) => (
            <div key={title} className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-700/40">
              <p className="font-semibold text-neutral-700 dark:text-neutral-300 mb-1 text-[11px]">{title}</p>
              <p className="text-neutral-500 dark:text-neutral-400">{desc}</p>
            </div>
          ))}
        </div>
        <p className="mt-2">On mobile the panels collapse into a tab bar — switch between Chat, Steps, and Run History without leaving the page.</p>
      </Section>

      <Section title="Master Agent Chat" icon={MessageSquare} tooltip="The AI architect that builds your workflow — model picker, sessions, attachments, streaming">
        <p>
          The <B>Master Agent</B> is a pre-configured AI architect that guides you through building agents. It can:
        </p>
        <ul className="list-disc ml-4 space-y-1 mt-1">
          <li>Create and configure workflow steps</li>
          <li>Test API keys and credentials with real API calls</li>
          <li>Write and manage workflow files</li>
          <li>Run tests on your workflow</li>
          <li>Suggest improvements and fix issues</li>
        </ul>
        <p className={subHeadClass}>Model selection</p>
        <p>
          Pick <B>Pabbly Provider</B> to use the platform's hosted models (charged in AI Credits), or bring your own API key
          (BYOK) from the <B>AI Settings</B> page to use any supported model on your own provider account with no AI Credit deduction.
          Supported providers:
        </p>
        <table className={tableClass}>
          <thead><tr><th className={thClass}>Provider</th><th className={thClass}>Models / Notes</th></tr></thead>
          <tbody>
            {[
              ['Anthropic', 'Claude 4.x family (Opus, Sonnet, Haiku) — best for complex reasoning and tool use, with prompt caching for repeated context'],
              ['OpenAI', 'GPT-4o, GPT-4o Mini, GPT-4 Turbo — multimodal, broad ecosystem'],
              ['Google', 'Gemini 2.5 Pro and 2.5 Flash — long context, cost-efficient'],
              ['xAI', 'Grok family — real-time-aware reasoning'],
              ['Custom (OpenAI-compatible)', 'Any provider that implements the OpenAI chat API — Friendli, Together, Groq, DeepSeek, Baseten, Ollama, LM Studio, etc.'],
            ].map(([p, m]) => (
              <tr key={p}><td className={tdClass}><B>{p}</B></td><td className={tdClass}>{m}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-neutral-500">The exact list of enabled models is set by the platform administrator and appears in the model dropdown inside every workflow.</p>
        <p className={subHeadClass}>Sessions</p>
        <p>Create new conversation sessions for different topics. Switch between sessions to access different chat threads. Each session tracks message count and timestamps.</p>
        <p className={subHeadClass}>Attachments</p>
        <p>Send <B>images</B> (JPEG, PNG, GIF, WebP up to 20 MB), <B>PDFs</B> (up to 20 MB), <B>structured-text files</B> (JSON, CSV, Markdown, XML, YAML, TSV, NDJSON up to 256 KB each), or <B>pasted text</B> (any clipboard paste ≥ 2,000 chars auto-converts to a "PASTED" card; per-attachment cap is 40,000 chars / ~13 pages) for the AI to analyze. All types are uploaded to private storage and referenced in every subsequent turn — so the AI still "remembers" what you pasted days later, even after reload.</p>
        <p className="mt-1 text-neutral-500">Pasted text and structured-text files from earlier turns are replayed wrapped in <IC>&lt;pasted_user_text&gt;…&lt;/pasted_user_text&gt;</IC> tags so the model treats it as inert reference data (and never tries to "open" it via read_file). Historical attachments (older than the last 2 turns) are truncated to <IC>CHAT_HISTORY_MAX_CONTENT_CHARS</IC> (default 2000) to keep the token budget bounded; the current turn and recent 2 turns always send full-size content.</p>
        <p className="mt-1 text-neutral-500">Excel (.xlsx / .xls), Word, and archive formats are not supported — open them in their native app and "Save As" CSV / plain text first.</p>
        <p className={subHeadClass}>Streaming & tool calls</p>
        <p>Responses stream in real-time with a typing indicator. Tool calls (HTTP requests, file operations, etc.) appear inline as structured cards showing the tool name, parameters, and results.</p>
      </Section>

      <Section title="Workflow Steps & Pipeline" icon={Layers} tooltip="AI vs Code steps, gap-numbered ordering (10/20/30), and step status flow">
        <p>Steps are the <B>building blocks</B> of your workflow, executed sequentially when triggered.</p>
        <p className={subHeadClass}>Two step types</p>
        <div className="flex flex-col gap-2 mt-1">
          <div className="flex items-start gap-2 p-3 rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800">
            <Bot className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400 mt-0.5 flex-shrink-0" />
            <div>
              <span className="font-semibold text-violet-800 dark:text-violet-300">AI Steps</span>
              <span className="text-violet-700 dark:text-violet-400"> — LLM-powered with system prompt, model selection, and tools. Use for reasoning, content generation, decision-making. Each call consumes tokens.</span>
            </div>
          </div>
          <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
            <Code2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
            <div>
              <span className="font-semibold text-emerald-800 dark:text-emerald-300">Code Steps (Non-AI)</span>
              <span className="text-emerald-700 dark:text-emerald-400"> — JavaScript executed on Firecracker micro-VMs. Zero AI token cost. Use for API calls, data transformation, deterministic logic.</span>
            </div>
          </div>
        </div>
        <p className={subHeadClass}>Step fields</p>
        <p><B>All steps:</B> name, description, JavaScript code body. The Master Agent writes the code for you — for AI-style steps the code uses the pre-installed <IC>pabbly-llm</IC> SDK (<IC>{'const r = await new LLM().complete({system, messages})'}</IC>); for plain code steps it's regular JS calling <IC>HTTP()</IC>, <IC>SECRETS</IC>, etc. The "AI" badge on each step card is auto-derived from whether the code imports <IC>pabbly-llm</IC>.</p>
        <p className={subHeadClass}>Step config is read-only</p>
        <p>The right-side step config panel shows the step's name, description, and code as <B>read-only</B>. To rename, edit the description, or change the code, ask the Master Agent in chat — it owns all edits and handles cascading concerns automatically (e.g. patching downstream <IC>{'INPUT.previous_steps["OldName"]'}</IC> references when you rename a step).</p>
        <p className={subHeadClass}>Ordering</p>
        <p>Steps use gap numbering (10, 20, 30...) for easy insertion without renumbering. New steps auto-assigned <IC>max_order + 10</IC>. Drag or use the reorder API to rearrange.</p>
        <p className={subHeadClass}>Step status flow</p>
        <p>Each step is <IC>pending</IC> until it has been saved, then <IC>ready</IC> once the Master Agent has tested its credentials and payload. A step becomes <IC>failed</IC> if a test or a live run surfaces an error.</p>
      </Section>

      <Section title="Available Tools" icon={Zap} tooltip="30 built-in tools across HTTP, web, files, memory, messaging, runtime, and workflow categories">
        <p>AI steps can use <B>30 built-in tools</B>. Enable the ones your step needs:</p>
        <table className={tableClass}>
          <thead><tr><th className={thClass}>Category</th><th className={thClass}>Tool</th><th className={thClass}>Description</th></tr></thead>
          <tbody>
            {[
              ['HTTP', 'http_request', 'Make GET/POST/PUT/DELETE/PATCH calls'],
              ['Web', 'web_search', 'Search the web'],
              ['Web', 'web_fetch', 'Fetch & extract webpage text'],
              ['Messaging', 'send_message', 'Send to Slack, Discord, Google Chat, Teams'],
              ['Messaging', 'send_email', 'Send emails via SMTP/API'],
              ['Files', 'read_file', 'Read from workflow workspace'],
              ['Files', 'write_file', 'Write to workflow workspace'],
              ['Files', 'edit_file', 'Precision text replacement in files'],
              ['Memory', 'memory_store', 'Store a credential securely (AES-256-GCM)'],
              ['Memory', 'memory_get', 'Retrieve a stored credential value'],
              ['Memory', 'memory_delete', 'Delete a stored credential'],
              ['Runtime', 'exec_command', 'Execute shell command on the runner VM'],
              ['Runtime', 'process_start', 'Start a background process'],
              ['Runtime', 'process_status', 'Poll a background process'],
              ['Runtime', 'process_kill', 'Kill a background process'],
              ['Data', 'json_transform', 'Extract / transform JSON with dot notation'],
              ['Data', 'base64_encode', 'Encode / decode base64'],
              ['Testing', 'test_workflow', 'Run the whole workflow end-to-end'],
              ['Testing', 'test_step', 'Run a single step in isolation'],
              ['Workflow', 'create_step', 'Create a new workflow step'],
              ['Workflow', 'update_step', 'Modify an existing step'],
              ['Workflow', 'set_step_code', 'Attach JavaScript code to a code step'],
              ['Workflow', 'set_step_prompt', 'Set system prompt for an AI step'],
              ['Workflow', 'delete_step', 'Remove a step from the pipeline'],
              ['Workflow', 'update_workflow', 'Activate / re-push step changes to the deployed workflow'],
              ['Workflow', 'get_agent_status', 'Get the current workflow state and step summary'],
              ['Workflow', 'get_webhook_info', 'Get the workflow webhook URL'],
              ['Workflow', 'set_webhook_schema', 'Define the expected webhook input schema'],
              ['Workflow', 'get_captured_webhook', 'Get the most recent captured webhook payload'],
              ['Workflow', 'get_run_history', 'Get recent task execution history'],
            ].map(([cat, tool, desc]) => (
              <tr key={tool}>
                <td className={tdClass}>{cat}</td>
                <td className={tdClass}><IC>{tool}</IC></td>
                <td className={tdClass}>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2"><B>Tool groups:</B> use shortcuts like <IC>group:fs</IC> (read, write, edit), <IC>group:web</IC> (search, fetch), <IC>group:runtime</IC> (exec, process_*), <IC>group:memory</IC>, <IC>group:messaging</IC>, <IC>group:http</IC>, <IC>group:data</IC>, or <IC>"*"</IC> for all.</p>
        <p className="mt-1 text-neutral-500">The Workflow-category tools (<IC>create_step</IC>, <IC>update_step</IC>, <IC>update_workflow</IC>, etc.) are used by the Master Agent during chat — they're how it edits and redeploys your pipeline as you iterate.</p>
      </Section>

      <Section title="Testing Workflows" icon={Play} tooltip="Run all steps or isolate one step with sample input — view per-step pass/fail logs">
        <p className={subHeadClass}>Test all steps</p>
        <p>Run the entire pipeline with test input data. Enter a JSON payload, click <B>Run All Steps</B>. Results show pass/fail per step with duration.</p>
        <p className={subHeadClass}>Test single step</p>
        <p>Isolate and test one step. Provide step-specific input and optionally mock previous step outputs with <IC>previous_steps</IC>.</p>
        <p className={subHeadClass}>Test results</p>
        <p>Results display in a GitHub Actions-style log with collapsible step details. Each step shows: status (passed/failed), input, output, tool calls used, duration, and errors.</p>
        <p className={subHeadClass}>Quick fill from history</p>
        <p>Recent test runs (up to 8) are shown for quick payload re-use — click to populate the input editor.</p>
      </Section>

      <Section title="Activate & Update" icon={Rocket} tooltip="Auto-activation on creation, the needs_redeploy flag, validation rules, and the Update button">
        <p className={subHeadClass}>Auto-activation on creation</p>
        <p>
          Every new workflow is <B>auto-deployed</B> to Pabbly Functions the moment you create it — a webhook URL is ready within a few seconds, no extra step required.
        </p>
        <p className={subHeadClass}>Activating / updating changes</p>
        <p>
          Whenever you add, edit, or delete a step (or change the model / stored credentials) the workflow is flagged with <IC>needs_redeploy</IC>.
          The Master Agent handles this for you — when you ask it to test or run the workflow it calls <IC>update_workflow</IC> first, which re-pushes your latest
          configuration to Pabbly Functions. You'll see a brief <B>"⚡ Activating workflow..."</B> or <B>"⚡ Updating workflow..."</B> line in the chat while this happens.
          The "Update" button in the Steps panel does the same thing manually if you'd rather click it yourself.
        </p>
        <p className={subHeadClass}>Validation</p>
        <p>
          Before activation the workflow is validated: at least one step exists, every step has a code body, every referenced model is known, and (for legacy AI-type steps)
          every tool name resolves. Validation failures surface inline in the chat so the Master Agent can fix them on the next turn.
        </p>
        <p className={subHeadClass}>Workflow creation: atomic with Pabbly Functions</p>
        <p>
          When you click <B>Create</B>, the workflow is deployed to Pabbly Functions <B>before</B> it's saved on our side. If the deploy fails (PF unreachable, network error,
          or PF not configured), the workflow is NOT created and you'll see an error toast — just hit Create again. This guarantees that any workflow you see in the dashboard
          has a working webhook URL. There are no half-deployed workflows to recover from.
        </p>
        <p className={subHeadClass}>Removing a workflow from production</p>
        <p>Deleting the workflow from the dashboard also removes its deployed function. You can restore from Trash to bring everything back.</p>
      </Section>

      <Section title="Webhooks & Triggers" icon={Webhook} tooltip="Public webhook URL, no auth, 3 concurrent runs, recursion depth 3, and the run history viewer">
        <p>
          Every active workflow has a unique webhook URL hosted on Pabbly Functions.
          You'll find it — along with a ready-to-paste cURL snippet — in the <B>Webhook</B> button at the top of the chat panel inside the workflow builder.
        </p>
        <p>
          <B>No authentication required</B> — the URL is designed for easy integration with Zapier, Make, Pabbly Connect, or any custom app.
          Send any JSON payload with <IC>POST</IC> and the workflow executes its steps in order, passing each step's output to the next.
        </p>
        <p className={subHeadClass}>Rate limiting & safety</p>
        <table className={tableClass}>
          <thead><tr><th className={thClass}>Protection</th><th className={thClass}>Limit</th></tr></thead>
          <tbody>
            {[
              ['Per workflow', 'Up to 3 concurrent runs — additional requests are rejected until one completes'],
              ['Recursion depth', 'Max 3 levels if a workflow triggers another workflow'],
              ['AI Credit guard', 'Platform AI Credit runs stop early if the balance runs out mid-execution'],
            ].map(([p, l]) => (
              <tr key={p}><td className={tdClass}><B>{p}</B></td><td className={tdClass}>{l}</td></tr>
            ))}
          </tbody>
        </table>
        <p className={subHeadClass}>Run history</p>
        <p>
          Every execution appears under <B>Run History</B> inside the workflow builder with its status (executing / completed / failed),
          duration, per-step results, and AI Credits used. Use <B>Retry</B> to re-run the same payload or <B>Cancel</B> to stop an in-progress run.
        </p>
      </Section>

      <Section title="Schedules" icon={CalendarClock} tooltip="Cron schedules attached to deployed workflows — fire automatically without an external trigger. Manage from chat or the Schedules sidebar entry.">
        <p>
          Every deployed workflow can also fire on a recurring <B>cron schedule</B>, no external service required.
          Tell the Master Agent something like <IC>"run this every weekday at 9am UTC"</IC> and it will derive the cron, list the next 5 fire times for confirmation, then attach the schedule to your deployed function.
        </p>
        <p className={subHeadClass}>From chat (per workflow)</p>
        <table className={tableClass}>
          <thead><tr><th className={thClass}>Say</th><th className={thClass}>What happens</th></tr></thead>
          <tbody>
            {[
              ['"Schedule this every Monday 9am"', 'Master Agent derives the cron, restates intent + next 5 fire times, asks for confirmation, then creates'],
              ['"What\'s my schedule?"', 'Reads the current schedule and shows cron, timezone, status, next + last run'],
              ['"Change it to weekdays only"', 'Updates the existing schedule — recomputes next_run_at on PF\'s side'],
              ['"Pause the schedule"', 'Sets enabled=false (reversible — say "resume" later)'],
              ['"Stop scheduling"', 'Removes the schedule entirely (the workflow keeps working manually via webhook)'],
            ].map(([say, what]) => (
              <tr key={say}><td className={tdClass}><IC>{say}</IC></td><td className={tdClass}>{what}</td></tr>
            ))}
          </tbody>
        </table>
        <p className={subHeadClass}>The Schedule chip</p>
        <p>
          When a workflow has a schedule attached, a <B>Schedule</B> chip appears next to the Webhook chip in the workflow builder header.
          Click it to see the cron, the schedule's source timezone, your local-time next + last run, and the last-run status (OK / Failed).
          The chip auto-updates whenever you create, change, or remove the schedule via chat.
        </p>
        <p className={subHeadClass}>The Schedules page</p>
        <p>
          The <B>Schedules</B> sidebar entry shows every cron schedule across your workflows in one table.
          Search by workflow name, filter by status, and bulk-delete selected rows (cap 50 per call). Times are shown in your local timezone with the source IANA zone available on hover.
        </p>
        <p className={subHeadClass}>Defaults & gotchas</p>
        <table className={tableClass}>
          <tbody>
            {[
              ['Default timezone', 'UTC unless you name an IANA zone (e.g. "Asia/Kolkata", "America/New_York") in the request'],
              ['Workflow must be active', 'You can\'t schedule a workflow that hasn\'t been deployed; create steps and activate first'],
              ['No backfill', 'If the backend is down when a fire is due, that fire is skipped — the next one runs at its scheduled time'],
              ['Disabled or paused', 'Next-run time is hidden in the UI because PF still carries the last-computed value but the schedule won\'t actually fire'],
            ].map(([k, v], i) => (
              <tr key={i}><td className={tdClass}><B>{k}</B></td><td className={tdClass}>{v}</td></tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Workflow Templates" icon={Layers} tooltip="Pre-built workflows in the Marketplace — clone to your workspace, then add your own credentials">
        <p>Browse pre-built templates in the <B>Templates</B> page (Marketplace). Filter by category: All, Popular, Automation, Content, Messaging.</p>
        <p>Each template includes pre-configured files, steps, and code. Clone to your workspace — creates a new workflow with all files and steps ready.</p>
        <p><B>Note:</B> Credentials are never included in templates. You'll need to add your own API keys after cloning.</p>
      </Section>

      <Section title="Workflow Sharing" icon={Share2} tooltip="Mint a sharable URL — anyone authenticated who opens it can clone the workflow into their workspace; credential values are stripped, key names are kept">
        <p>Share a workflow via a <B>permanent link</B>. Click the <B>Share</B> icon (next to the Settings cog in the workflow chat header) to create a URL of the form <IC>https://&lt;host&gt;/share/&lt;token&gt;</IC>. Anyone who opens the link and signs in can clone the workflow into their own workspace.</p>
        <p className={subHeadClass}>What's shared</p>
        <ul className="list-disc ml-4 space-y-1 mt-1">
          <li><B>Yes:</B> step list (names, prompts, code, tools, conditions), AI instructions, model selection, webhook input schema, and the <B>names</B> of every credential the workflow uses (e.g. <IC>OPENWEATHERMAP_API_KEY</IC>).</li>
          <li><B>No:</B> credential <B>values</B>, chat history, run history, or the original deployment. The recipient gets a fresh draft they need to deploy themselves.</li>
        </ul>
        <p className={subHeadClass}>Inline secret redaction</p>
        <p>Hard-coded patterns inside prompts and code (Anthropic / OpenAI / AWS / Google keys, <IC>Bearer</IC> tokens, <IC>apiKey =</IC> assignments, <IC>Authorization:</IC> headers, etc.) are auto-replaced with <IC>[REDACTED]</IC> at clone time as defense in depth — but always review your workflow before sharing the link.</p>
        <p className={subHeadClass}>Lifecycle</p>
        <p>One link per workflow. Click <B>Revoke link</B> in the share modal to disable it (existing copies in other users' workspaces stay intact). Re-creating after revocation mints a fresh token. The modal shows a running clone count.</p>
        <p className={subHeadClass}>Filling in credentials after cloning</p>
        <p>The recipient's <B>Stored Credentials</B> panel (in Workflow Settings) lists every key the original used, with empty values. Edit each one to enter your own connection, then click <B>Activate</B> to deploy.</p>
      </Section>

      <Section title="Team Access (Live Collaboration)" icon={Users} tooltip="Invite teammates as Full Control, Editor, or Viewer on a workflow or folder — AI Credits are deducted from the owner's wallet, not the collaborator's">
        <p>Different from the link-based <B>Workflow Sharing</B> above. Team Access gives a teammate <B>persistent shared edit (or view) rights</B> on your live workflow or folder — no clone, no fork. They run runs against your deployment; their LLM costs come out of <B>your</B> AI Credit wallet (you stay the owner).</p>
        <p className={subHeadClass}>How to invite</p>
        <ul className="list-disc ml-4 space-y-1 mt-1">
          <li>Click the <B>Share</B> button on the <B>Sharing</B> page (top-right) for a multi-resource composer — pick one or more workflows or folders, paste comma-separated emails, choose <B>Full Control</B> / <B>Editor</B> / <B>Viewer</B>, hit Share.</li>
          <li>Or open a single workflow / folder and click the <B>Team access</B> icon (next to Settings) to manage that resource alone.</li>
          <li>Inviting an email that hasn't signed up yet creates a <B>pending</B> invite — it activates automatically when the recipient signs in for the first time.</li>
        </ul>
        <p className={subHeadClass}>Roles</p>
        <ul className="list-disc ml-4 space-y-1 mt-1">
          <li><B>Full Control</B> — everything Editor can do, plus reveal stored credential values, manage collaborators (invite / change role / remove), and trash + restore the workflow. Cannot grant <B>Full Control</B> to others (only the owner can) and cannot permanently delete from trash, edit AI Credit caps, or revoke share links — those stay owner-only.</li>
          <li><B>Editor</B> — edit steps and stored credentials, deploy / activate / update, run tests, send chat messages. Cannot reveal credential values or manage collaborators.</li>
          <li><B>Viewer</B> — read-only inspection of the workflow, chat history, and steps. No edits, no test runs.</li>
          <li>Folder roles cascade to every workflow inside; direct workflow shares override folder-level role when higher.</li>
        </ul>
        <p>Only the workflow / folder <B>owner</B> can grant the <B>Full Control</B> role. Full Control collaborators inviting others can only assign Editor or Viewer.</p>
        <p className={subHeadClass}>Per-collaborator AI Credit limits</p>
        <p>From the <B>Team access</B> modal, click <B>Limit AI credits</B> next to a collaborator. Set a maximum number of AI Credits they can spend on your workflows. The cap is bounded by your <B>current balance</B> — you can't promise more than you have spendable. <B>Reset</B> zeros the usage counter (the limit stays). Once the cap is hit, their further runs fail until you raise the limit or reset.</p>
        <p className={subHeadClass}>Sharing page</p>
        <p>The <B>Sharing</B> entry in the sidebar has two tabs:</p>
        <ul className="list-disc ml-4 space-y-1 mt-1">
          <li><B>Shared with me</B> — flat table of every workflow you can edit/view, grouped by folder when applicable. Click to open.</li>
          <li><B>Shared by me</B> — single flat <B>grants</B> table, one row per (resource, member). Filters: Search · Type (All / Folders / Workflows) · Member · Folder. Bulk-select multiple grants and click <B>Revoke selected</B> to strip access in one action — works for "remove a user from one folder," "remove a folder from one user," "un-share a workflow entirely," or "strip everything from a user."</li>
        </ul>
        <p className={subHeadClass}>AI Credit billing</p>
        <p>Every chat turn, test run, and webhook execution on a shared workflow / folder is billed to the <B>owner's</B> wallet — never the collaborator's. Mid-run balance checks stop execution if the owner runs out.</p>
      </Section>

      <Section title="API Keys (BYOK)" icon={Key} tooltip="Bring Your Own Key — connect Anthropic, OpenAI, Google, xAI, or any OpenAI-compatible provider; BYOK calls don't deduct AI Credits">
        <p><B>Bring Your Own Key</B> — add your own LLM provider API keys from the <B>AI Settings</B> page in the sidebar.</p>
        <p className={subHeadClass}>Supported providers</p>
        <p>Anthropic, OpenAI, Google (Gemini), xAI (Grok), and any <B>OpenAI-compatible API</B> (Together, Groq, DeepSeek, Ollama, LM Studio, Friendli, Baseten, etc.) via the custom provider option.</p>
        <p className={subHeadClass}>Custom OpenAI-compatible provider</p>
        <p>Connect any OpenAI-compatible endpoint by providing a <B>base URL</B>, <B>model ID</B>, and optional <B>auth header prefix</B> (defaults to "Bearer"). Configure it on the AI Settings page under "Custom Provider".</p>
        <p className={subHeadClass}>BYOK benefits</p>
        <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 mt-1">
          <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
          <div>
            <span className="text-emerald-700 dark:text-emerald-400">Calls using your own key <B>don't deduct platform AI Credits</B>. Usage is logged for analytics only.</span>
          </div>
        </div>
        <p className={subHeadClass}>Security</p>
        <p>Keys are encrypted with <B>AES-256-GCM</B> (per-user derived key). Only the last 4 characters are shown as a hint. Full key available via "Reveal" — rate-limited to 5 reveals/hour, with audit logging.</p>
        <p>One key per provider per user. Test key validity before saving — the system calls the provider's API to verify.</p>
      </Section>

      <Section title="AI Credits & Billing" icon={CreditCard} tooltip="50 free AI Credits at signup, buy more via Pabbly Subscription Billing, BYOK calls bypass AI Credits entirely">
        <p>AI Credits pay for AI calls when you use the <B>Pabbly Provider</B>. If you've configured your own BYOK key for a provider, those calls do not consume AI Credits at all.</p>
        <p className={subHeadClass}>Getting AI Credits</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
          <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-700/40">
            <p className="font-semibold text-neutral-700 dark:text-neutral-300 mb-1">Signup bonus</p>
            <p className="text-neutral-500 dark:text-neutral-400"><B>50 free AI Credits</B> are granted automatically when you create an account.</p>
          </div>
          <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-700/40">
            <p className="font-semibold text-neutral-700 dark:text-neutral-300 mb-1">Buy more AI Credits</p>
            <p className="text-neutral-500 dark:text-neutral-400">Open the <B>Plans & Usage</B> page and pick a pack from the "Buy AI Credits" section under the AI Credits tab. The checkout runs on Pabbly Subscription Billing; new AI Credits appear in your account within a minute of payment.</p>
          </div>
        </div>
        <p className={subHeadClass}>Usage tracking</p>
        <p>The <B>Plans & Usage → AI Credits</B> tab shows your running balance, every transaction (signup bonus, purchases, deductions), and the total cost of the most recent chat in the workflow builder header.</p>
        <p className={subHeadClass}>Subscription plan vs. AI Credits</p>
        <p>The <B>Plans & Usage → Plan</B> tab shows your current subscription tier (Free / Standard / Premium / Enterprise) and four monthly meters: workflows owned, team members invited, schedulers enabled, and <B>compute units consumed</B>. Compute Units (CU) meter workflow runtime — 1 unit covers up to 30 seconds of execution, min 1 unit per run. They are <B>separate from AI Credits</B>: AI Credits are the per-token meter for LLM calls; Compute Units gate platform infrastructure usage. A run that crashes or times out at the 10-minute VM cap still bills its wallclock units (max 20).</p>
        <p className={subHeadClass}>Cost tips</p>
        <ul className="list-disc ml-4 space-y-1 mt-1">
          <li>Use <B>Code steps</B> for plain API calls and data reshaping — they execute on Pabbly Functions and consume <B>zero AI credits</B>.</li>
          <li>Cheaper models (Claude Haiku, GPT-4o Mini, Gemini 2.5 Flash) are a great fit for classification, routing, and short transforms.</li>
          <li>Anthropic prompt caching can cut repeated-context cost by up to 90% — keep static instructions at the top of your prompt.</li>
          <li>Bring your own API key in <B>AI Settings</B> if you'd rather bill directly with the provider — BYOK calls do not touch your credit balance.</li>
        </ul>
      </Section>

      <Section title="Workflow Files" icon={FileText} tooltip="Per-workflow workspace — Markdown definition files (max 4) and JavaScript code-step files written by the Master Agent">
        <p>Each workflow has a small workspace the Master Agent can read from and write to.</p>
        <p><B>Definition files</B> (.md) — editable Markdown notes for prompts, configuration, or reference data. Max 4 per workflow.</p>
        <p><B>Code step files</B> (.js) — JavaScript written into the workspace and attached to a code step via <IC>set_step_code</IC>. This lets the Master Agent build large code bodies reliably even on cheaper models.</p>
      </Section>

      <Section title="Storage" icon={Database} tooltip="Per-workflow file storage written by your workflow at runtime — generated/ (7-day expiry) and management/ (persistent)">
        <p>Every workflow has its own dedicated file storage that the deployed code writes into at runtime. Use it for output artifacts (PDFs, CSVs, scraped dumps) and long-lived workflow state (yesterday's snapshot, pending queues, running counters).</p>
        <p className={subHeadClass}>Two folders, two retention policies</p>
        <table className={tableClass}>
          <thead><tr><th className={thClass}>Folder</th><th className={thClass}>Retention</th><th className={thClass}>Use for</th></tr></thead>
          <tbody>
            <tr><td className={tdClass}><IC>generated/</IC></td><td className={tdClass}>Auto-expires after <B>7 days</B></td><td className={tdClass}>Reports, exports, one-off artifacts that don't need to live forever</td></tr>
            <tr><td className={tdClass}><IC>management/</IC></td><td className={tdClass}><B>Persists forever</B></td><td className={tdClass}>State snapshots, queues, counters — anything the next run needs to read</td></tr>
          </tbody>
        </table>
        <p className={subHeadClass}>Quotas (per user, applied across every workflow you own)</p>
        <p><B>100 MB total</B> · <B>500 files total</B>. Quota counters update lazily every 15 minutes; the Refresh button on the Storage page re-lists the active workflow on demand.</p>
        <p className={subHeadClass}>Where to find your files</p>
        <p>Open <B>Storage</B> in the sidebar. Pick a workflow, optionally filter by folder, and click a row to preview the file. Files are loaded directly from the backing storage — no separate upload UI; the Master Agent's deployed code is what writes the files.</p>
        <p className={subHeadClass}>Access from inside a step</p>
        <p>Inside a code step, use the pre-installed <IC>pabbly-storage</IC> SDK. The base path is auto-scoped to the workflow, so the SDK can never reach into another workflow's files:</p>
        <Code language="js">{`const { Storage } = require('pabbly-storage');
const s = new Storage();
await s.put('management/state.json', Buffer.from(JSON.stringify(state)), {
  contentType: 'application/json',
});
const r = await s.get('management/state.json'); // throws if missing
const list = await s.list('generated/');         // { items, cursor }`}</Code>
        <p className={subHeadClass}>AI steps</p>
        <p>Enable the <IC>upload_file</IC> tool on an AI step to let the LLM save binary results (images, PDFs) it gets back from APIs. The tool returns <IC>{`{ url, key, size }`}</IC>. Upload limit per call is <B>25 MB</B>.</p>
      </Section>

      <Section title="Sessions" icon={Clock} tooltip="Multiple parallel chat threads per workflow — switch between sessions to keep different revisions separate">
        <p>Conversation sessions organize your chat history with the Master Agent. A default "Main Session" is created automatically.</p>
        <p>Create new sessions for different topics or workflow revisions. Switch between sessions in the chat panel to access different conversation threads.</p>
      </Section>

    </div>
  )
}

// ── Tab: API Reference ──

function ApiReferenceTab() {
  // API tab renders flat (no collapse). Every Section + every Endpoint is
  // always expanded — the cURL is the whole point, so hiding it behind a
  // click is friction. The left-nav uses Section titles for sections and
  // each Endpoint's `METHOD path` header (marked with `docs-subhead`) as
  // sub-sections within that section.

  // Real text PDF generator — structurally mirrors ptm-app
  // OrganizationSettings::downloadApiDocPdf. Walks the API tab DOM (data-*
  // attributes on Endpoint and Section), renders title + auth box + TOC, then
  // for each section paints a header bar followed by every endpoint
  // (method+path strip, description, cURL block, optional response block).
  // Output is selectable text — copyable cURL + AI-ingestable.
  const downloadPdf = () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageW = doc.internal.pageSize.getWidth()
    const pageH = doc.internal.pageSize.getHeight()
    const margin = 14
    const contentW = pageW - margin * 2
    let y = margin
    const fontName = 'helvetica'
    const setFont = (style = 'normal', size = 9) => { doc.setFont(fontName, style); doc.setFontSize(size) }
    const checkPage = (needed = 10) => { if (y + needed > pageH - margin) { doc.addPage(); y = margin } }

    const drawCodeBlock = (label, code) => {
      checkPage(20)
      setFont('bold', 7)
      doc.setTextColor(107, 114, 128)
      doc.text(label.toUpperCase(), margin, y)
      y += 4
      setFont('normal', 7)
      doc.setTextColor(31, 41, 55)
      const lines = doc.splitTextToSize(code || '', contentW - 8)
      const blockH = lines.length * 3 + 4
      checkPage(blockH + 2)
      doc.setFillColor(243, 244, 246)
      doc.setDrawColor(209, 213, 219)
      doc.roundedRect(margin, y - 1, contentW, blockH, 1.5, 1.5, 'FD')
      doc.setTextColor(31, 41, 55)
      doc.text(lines, margin + 4, y + 2.5)
      y += blockH + 3
    }

    // Title
    setFont('bold', 18)
    doc.setTextColor(17, 24, 39)
    doc.text('Pabbly AgenticAI — API Reference', pageW / 2, y, { align: 'center' })
    y += 7
    setFont('normal', 9)
    doc.setTextColor(107, 114, 128)
    doc.text('Base URL: https://agenticai.pabbly.com', pageW / 2, y, { align: 'center' })
    y += 10

    // Auth info box
    doc.setFillColor(239, 246, 255)
    doc.setDrawColor(191, 219, 254)
    doc.roundedRect(margin, y - 2, contentW, 10, 2, 2, 'FD')
    setFont('bold', 8)
    doc.setTextColor(30, 64, 175)
    doc.text('Authentication:', margin + 4, y + 3)
    setFont('normal', 8)
    doc.text('Authorization: Bearer YOUR_TOKEN header in every request.', margin + 32, y + 3)
    y += 14

    // Walk the rendered DOM
    const root = document.querySelector('.docs-print-root')
    const sections = root ? Array.from(root.querySelectorAll('.docs-section')) : []
    const titles = sections.map((s) => s.dataset.sectionTitle || s.querySelector('h2,h5')?.textContent?.trim() || '').filter(Boolean)

    // Table of Contents
    if (titles.length) {
      setFont('bold', 12)
      doc.setTextColor(55, 65, 81)
      doc.text('Table of Contents', margin, y)
      y += 6
      setFont('normal', 9)
      doc.setTextColor(75, 85, 99)
      titles.forEach((t, i) => {
        checkPage(5)
        doc.text(`${i + 1}. ${t}`, margin + 4, y)
        y += 4
      })
      y += 6
    }

    const methodColor = (m) => ({
      GET: { bg: [219, 234, 254], fg: [30, 64, 175] },
      POST: { bg: [220, 252, 231], fg: [22, 101, 52] },
      DELETE: { bg: [254, 226, 226], fg: [153, 27, 27] },
      PUT: { bg: [254, 243, 199], fg: [146, 64, 14] },
      PATCH: { bg: [254, 243, 199], fg: [146, 64, 14] },
    }[m] || { bg: [243, 244, 246], fg: [55, 65, 81] })

    sections.forEach((section) => {
      const title = section.dataset.sectionTitle || section.querySelector('h2,h5')?.textContent?.trim()
      if (!title) return

      // Section header bar
      checkPage(15)
      doc.setFillColor(243, 244, 246)
      doc.rect(margin, y - 4, contentW, 8, 'F')
      setFont('bold', 13)
      doc.setTextColor(17, 24, 39)
      doc.text(title, margin + 2, y + 1.5)
      y += 9

      const endpoints = Array.from(section.querySelectorAll('.docs-endpoint'))
      if (endpoints.length === 0) {
        // Prose-only section (Introduction, cURL Examples) — render <p>/<pre>
        // children in document order.
        const items = section.querySelectorAll('p, pre')
        items.forEach((item) => {
          if (item.tagName === 'PRE') {
            drawCodeBlock('', item.textContent || '')
          } else {
            const text = (item.textContent || '').trim()
            if (!text) return
            setFont('normal', 8)
            doc.setTextColor(55, 65, 81)
            const lines = doc.splitTextToSize(text, contentW)
            lines.forEach((line) => { checkPage(4); doc.text(line, margin, y); y += 3.5 })
            y += 2
          }
        })
        y += 4
        return
      }

      endpoints.forEach((ep) => {
        const method = ep.dataset.method || ''
        const path = ep.dataset.path || ''
        const desc = ep.dataset.desc || ''
        const curl = ep.dataset.curl || ''
        const response = ep.dataset.response || ''

        checkPage(28)
        // Method badge + path strip
        const c = methodColor(method)
        doc.setFillColor(c.bg[0], c.bg[1], c.bg[2])
        doc.roundedRect(margin, y - 1, 16, 5, 1, 1, 'F')
        setFont('bold', 7)
        doc.setTextColor(c.fg[0], c.fg[1], c.fg[2])
        doc.text(method, margin + 8, y + 2.5, { align: 'center' })
        setFont('normal', 8)
        doc.setTextColor(31, 41, 55)
        const pathLines = doc.splitTextToSize(path, contentW - 18)
        doc.text(pathLines[0] || '', margin + 18, y + 2.5)
        y += 7
        if (pathLines.length > 1) {
          // Continuation lines for very long paths
          for (let i = 1; i < pathLines.length; i++) {
            checkPage(4)
            doc.text(pathLines[i], margin + 18, y)
            y += 3.5
          }
        }

        if (desc) {
          setFont('normal', 7)
          doc.setTextColor(75, 85, 99)
          const descLines = doc.splitTextToSize(desc, contentW)
          descLines.forEach((line) => { checkPage(4); doc.text(line, margin, y); y += 3 })
          y += 1
        }

        if (curl) drawCodeBlock('cURL', curl)
        if (response) drawCodeBlock('Response', response)
        y += 2
      })
      y += 4
    })

    // Footer page numbers
    const pageCount = doc.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      setFont('normal', 7)
      doc.setTextColor(156, 163, 175)
      doc.text(`Page ${i} of ${pageCount}`, pageW / 2, pageH - 6, { align: 'center' })
    }

    doc.save('Pabbly-Agentic-AI-API-Reference.pdf')
  }

  // Toolbar lives in the Introduction header (right side). Sections are
  // always-expanded now (no CollapseCtx provider below), so the
  // Expand/Collapse toggle is gone — only Download PDF remains.
  const headerActions = (
    <button
      type="button"
      onClick={downloadPdf}
      className="inline-flex items-center justify-center gap-1.5 px-3 sm:px-4 py-1.5 text-xs font-medium rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors whitespace-nowrap"
      aria-label="Download API reference as PDF"
    >
      <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
      <span className="hidden sm:inline">Download PDF</span>
      <span className="sm:hidden">PDF</span>
    </button>
  )

  return (
    <div className="docs-print-root w-full">

      <Section title="Introduction" icon={BookOpen} tooltip="Base URL, SSO + JWT authentication, and the standard JSON error envelope" alwaysOpen headerActions={headerActions}>
        <p><B>Base URL:</B> <IC>https://agenticai.pabbly.com</IC> (production) or <IC>http://localhost:4000</IC> (local development).</p>
        <p><B>Authentication:</B> In production, sign-in is handled exclusively through Pabbly Accounts SSO. User traffic is redirected to <IC>https://accounts.pabbly.com/backend/access?project=pabbly-agentic-ai</IC>, which POSTs a short-lived (60s, single-use) JWT back to <IC>/api/auth/tauth</IC>. That endpoint verifies the token, creates or links the local user, and issues an HttpOnly <IC>pabbly_token</IC> cookie used for all subsequent API calls. On a transient validation failure (accounts unreachable, single-use token replayed by an nginx retry during a deploy roll, etc.) the handler 303-redirects the browser back to <IC>https://accounts.pabbly.com/login/?s=paa</IC> so accounts mints a fresh token automatically — capped at 2 retries via a short-lived <IC>pabbly_sso_retry</IC> cookie before falling through to a terminal error page.</p>
        <p>The <IC>Authorization: Bearer</IC> header is still accepted and is used by local development tooling (Google OAuth path).</p>
        <Code>{`Authorization: Bearer YOUR_JWT_TOKEN`}</Code>
        <p><B>Response format:</B> JSON. Errors return <IC>{`{ "error": "message" }`}</IC> with the appropriate HTTP status code.</p>
      </Section>

      <Section title="Authentication" icon={Shield} tooltip="Pabbly Accounts SSO token exchange, logout, and current-user profile endpoints">
        <Endpoint method="POST" path="/api/auth/tauth" desc="Pabbly Accounts SSO token exchange — the ONLY supported sign-in path. accounts.pabbly.com auto-POSTs a form here after user sign-in. Verifies the token against accounts.pabbly.com/api/customer/authenticate, creates or links the local user, sets an HttpOnly cookie, and 302-redirects to /dashboard."
          body={`token=<60s_single_use_jwt>&s=<project>&pl=<payment_link>  (application/x-www-form-urlencoded)`} />
        <Endpoint method="POST" path="/api/auth/logout" desc="Clear the HttpOnly pabbly_token cookie server-side. The frontend then redirects to https://accounts.pabbly.com/logout/ to destroy the accounts session in the same flow." />
        <Endpoint method="GET" path="/api/me" desc="Get current user profile. Requires JWT (Bearer header or pabbly_token cookie)." />
        <Endpoint method="PUT" path="/api/me" desc="Update user profile (name, preferences). Requires JWT." />
      </Section>

      <Section title="Workflows" icon={Bot} tooltip="CRUD on workflows, soft-delete + restore, sharing, mode switching, bundle export, and bulk actions">
        <Endpoint method="GET" path="/api/workflows" desc="List agents. Supports filtering by status, search, folder, and trash state."
          response={`[{ "id": "...", "name": "My Agent", "status": "active", "slug": "my-agent", "folder_id": "...", "created_at": "..." }]`} />
        <Endpoint method="POST" path="/api/workflows" desc="Create a new agent."
          body={`{ "name": "My Agent", "description": "Optional description", "folder_id": "optional_folder_id" }`} />
        <Endpoint method="GET" path="/api/workflows/:id" desc="Get agent details by ID or slug." />
        <Endpoint method="PUT" path="/api/workflows/:id" desc="Update agent fields."
          body={`{ "name": "New Name", "description": "...", "model": "claude-sonnet-4-6", "status": "ready", "instructions": "...", "config": {}, "webhook_input_schema": [] }`} />
        <Endpoint method="DELETE" path="/api/workflows/:id" desc="Soft-delete (move to trash)." />
        <Endpoint method="POST" path="/api/workflows/:id/restore" desc="Restore from trash." />
        <Endpoint method="DELETE" path="/api/workflows/:id/permanent-delete" desc="Permanently delete. Cascades to messages, files, and steps." />
        <Endpoint method="POST" path="/api/workflows/bulk-action" desc="Perform bulk operations."
          body={`{ "agent_ids": ["id1", "id2"], "action": "move|activate|deactivate|delete", "folder_id": "..." }`} />
        <Endpoint method="GET" path="/api/workflows/:id/share" desc="Get the active share-link status for this workflow (returns active flag, share_token, clone_count, created_at)." />
        <Endpoint method="POST" path="/api/workflows/:id/share" desc="Create or return the active share link. Idempotent — re-issues the existing token if one is already active."
          body={`(no body)`} />
        <Endpoint method="DELETE" path="/api/workflows/:id/share" desc="Revoke the active share link. Future visits to /share/:token return 404." />
        <Endpoint method="GET" path="/api/share/:token" noAuth desc="PUBLIC — preview a shared workflow before cloning. Returns name, owner_name, step list (names + types only), and credential_keys[]. No prompt bodies, no values." />
        <Endpoint method="POST" path="/api/share/:token/clone" desc="Clone a shared workflow into the caller's workspace. Inline credentials in prompts/code are redacted; credential KEY NAMES are copied with empty placeholder values; chat / run history / deployment are not. Returns { id, slug, name, credential_keys, credentials_redacted }." />
        <Endpoint method="POST" path="/api/workflows/:id/mode" desc="Switch workflow status (draft → planning → active)."
          body={`{ "status": "active" }`} />
        <Endpoint method="POST" path="/api/workflows/:id/reset" desc="Reset agent state (deletes files, keeps messages)." />
        <Endpoint method="GET" path="/api/workflows/:id/bundle" desc="Export agent as a deployable bundle." />
        <Endpoint method="POST" path="/api/trash/empty" desc="Permanently delete all trashed agents." />
      </Section>

      <Section title="Workflow Steps" icon={Layers} tooltip="Step CRUD with gap-numbered ordering; bulk reorder endpoint accepts new step_orders without renumbering">
        <Endpoint method="GET" path="/api/workflows/:id/steps" desc="List all steps for an agent, sorted by order." />
        <Endpoint method="POST" path="/api/workflows/:id/steps" desc="Create a new step."
          body={`{
  "name": "Extract Data",
  "description": "Extracts relevant info from webhook payload",
  "step_type": "ai",
  "llm_model": "claude-sonnet-4-6",
  "system_prompt": "You are a data extraction assistant...",
  "tools": ["http_request", "json_transform"],
  "max_tool_calls": 10
}`} />
        <Endpoint method="PUT" path="/api/workflows/:id/steps/:stepId" desc="Update step fields. All fields optional." />
        <Endpoint method="DELETE" path="/api/workflows/:id/steps/:stepId" desc="Delete a step." />
        <Endpoint method="POST" path="/api/workflows/:id/steps/reorder" desc="Bulk reorder steps (gap numbering — 10, 20, 30 lets you insert later without renumbering)."
          body={`{ "step_orders": [{ "step_id": "...", "order": 10 }, { "step_id": "...", "order": 20 }] }`} />
      </Section>

      <Section title="Chat" icon={MessageSquare} tooltip="Send messages to the Master Agent (sync or SSE stream), delete a message, or cancel an in-progress turn">
        <Endpoint method="GET" path="/api/workflows/:id/chat" desc="Get chat history. Optional: ?session_id= for specific session." />
        <Endpoint method="POST" path="/api/workflows/:id/chat" desc="Send a message. The Master Agent runs the agentic tool loop (up to 25 iterations) with native function calling for the selected provider."
          body={`{
  "messages": [{ "role": "user", "content": "Create a step that..." }],
  "system_prompt": "...",
  "model": "claude-sonnet-4-6",
  "provider": "anthropic",
  "use_platform": false,
  "session_id": "optional"
}`}
          response={`{
  "message_id": "...",
  "content": "...",
  "tool_executions": [...],
  "usage": { "credits_used": 0.05, "balance_after": 49.95, "input_tokens": 1234, "output_tokens": 567 }
}`} />
        <Endpoint method="POST" path="/api/workflows/:id/chat/stream" desc="Streaming chat via Server-Sent Events. Same body as above." />
        <Endpoint method="DELETE" path="/api/workflows/:id/chat/:messageId" desc="Delete a message." />
        <Endpoint method="POST" path="/api/workflows/:id/chat/cancel" desc="Cancel an in-progress chat." />
      </Section>

      <Section title="Files" icon={FileText} tooltip="Read, write, and delete the per-workflow definition files used by the Master Agent and code steps">
        <Endpoint method="GET" path="/api/workflows/:id/files" desc="List all files for an agent." />
        <Endpoint method="GET" path="/api/workflows/:id/files/:filename" desc="Get file content." />
        <Endpoint method="POST" path="/api/workflows/:id/files" desc="Create a file."
          body={`{ "filename": "config.md", "content": "# Config\\n...", "file_type": "definition" }`} />
        <Endpoint method="PUT" path="/api/workflows/:id/files/:filename" desc="Update file content." />
        <Endpoint method="DELETE" path="/api/workflows/:id/files/:filename" desc="Delete a file." />
      </Section>

      <Section title="Storage" icon={Database} tooltip="Per-workflow runtime file storage — list, read, and quota lookup. Writes happen from deployed code via the pabbly-storage SDK, not via REST.">
        <p>Editor-and-above access only. Errors return a sanitized public message and a stable <IC>code</IC> field for clients to switch on.</p>
        <Endpoint method="GET" path="/api/workflows/:id/storage" desc="List files for a workflow. Query params: folder (generated | management | all), limit (default 100, cap 1000), cursor (opaque, from previous response), with_metadata (1/true to include content-type)."
          response={`{
  "items": [
    { "path": "management/state.json", "folder": "management",
      "name": "state.json", "size": 412, "last_modified": "2026-05-15T07:00:00Z" }
  ],
  "cursor": null
}`} />
        <Endpoint method="GET" path="/api/workflows/:id/storage/content" desc="Stream the content of a single file. Query param: path=<folder>/<filename>. Returns the raw bytes with the upstream Content-Type. Hard cap 32 MB per object."
          response="<raw bytes>" />
        <Endpoint method="GET" path="/api/me/storage-usage" desc="Per-user quota summary across every workflow you own. Lazy refresh on read (15-minute TTL); pass ?force=1 to await a synchronous re-list (heavier — one upstream LIST per workflow)."
          response={`{
  "bytes_used": 3584, "bytes_limit": 104857600,
  "file_count": 1, "file_limit": 500,
  "refreshed_at": "2026-05-15T07:05:00Z"
}`} />
      </Section>

      <Section title="Stored Credentials (Memory)" icon={Lock} tooltip="Encrypted (AES-256-GCM) per-workflow key/value store — list, reveal, update, delete; updates flag the workflow for redeploy">
        <p>Each workflow has an encrypted key-value store for API keys, webhook URLs, and other secrets. Values are AES-256-GCM encrypted at rest.</p>
        <Endpoint method="GET" path="/api/workflows/:id/memory" desc="List all stored credential keys (values are not returned)."
          response={`{ "credentials": [{ "key": "openai_api_key" }, { "key": "slack_webhook_url" }] }`} />
        <Endpoint method="GET" path="/api/workflows/:id/memory/:key" desc="Reveal (decrypt) a single credential value."
          response={`{ "key": "openai_api_key", "value": "sk-..." }`} />
        <Endpoint method="PUT" path="/api/workflows/:id/memory/:key" desc="Update a credential value. Triggers redeploy flag."
          body={`{ "value": "new-secret-value" }`} />
        <Endpoint method="DELETE" path="/api/workflows/:id/memory/:key" desc="Delete a credential. Triggers redeploy flag." />
      </Section>

      <Section title="Webhooks & Run History" icon={Webhook} tooltip="Public webhook trigger, run status (with one-time status_token), per-run step results, and cancel">
        <Endpoint method="POST" path="/api/webhook/:userId/:agentId" noAuth desc="PUBLIC — Trigger workflow execution. Send any JSON payload; it becomes the input to Step 1."
          body={`{ "message": "Hello from webhook", "data": { "key": "value" } }`}
          response={`{ "run_id": "...", "status": "executing", "status_url": "/api/run-history/{run_id}?status_token=..." }`} />
        <Endpoint method="GET" path="/api/workflows/:id/run-history" desc="List runs for a workflow (paginated, with filters). Legacy alias: /api/workflows/:id/task-history." />
        <Endpoint method="GET" path="/api/run-history/:runId" noAuth desc="Get run status + step results. Accepts a JWT OR a one-time ?status_token= query param returned by the webhook trigger response, so status polling works for clients that never authenticated. Legacy alias: /api/task-history/:runId." />
        <Endpoint method="POST" path="/api/run-history/:runId/cancel" desc="Cancel an in-progress execution. Legacy alias: /api/task-history/:runId/cancel." />
      </Section>

      <Section title="Schedules" icon={CalendarClock} tooltip="Cron schedules attached to deployed workflows. Mutations happen via the Master Agent's chat tools (get_schedule / create_schedule / update_schedule / delete_schedule); REST endpoints below are for the management page and the per-workflow chip.">
        <Endpoint method="GET" path="/api/schedules" desc="List schedules across this user's workflows. Always server-scoped to created_by={user.email} AND folder_id=PABBLY_FUNCTIONS_FOLDER_ID — the user can never widen the scope. Supports page, limit (cap 50), search, status (enabled / disabled / paused)."
          response={`{ "schedules": [...], "total": 1, "page": 1, "limit": 25, "has_more": false }`} />
        <Endpoint method="DELETE" path="/api/schedules/bulk" desc="Bulk delete (cap 50 ids per call). Double-gated — backend lists this user's schedules first, intersects with the requested ids, and 403s the entire request if any id is unauthorized. No partial deletion."
          body={`{ "schedule_ids": ["65a1...", "65a2..."] }`}
          response={`{ "deleted": 2 }`} />
        <Endpoint method="GET" path="/api/workflows/:id/schedule" desc="Read the schedule attached to one workflow. Used by the Schedule chip in the workflow chat header on cold reload, when the schedule action is older than the loaded chat history."
          response={`{ "exists": true, "schedule": { "_id": "...", "cron_expression": "0 9 * * 1-5", "timezone": "UTC", "enabled": true, "next_run_at": "2026-05-12T09:00:00Z", "last_run_at": "2026-05-09T09:00:04Z", "last_run_status": "success" } }`} />
      </Section>

      <Section title="Builds & Deployments" icon={Rocket} tooltip="Validate, deploy, sync, model/provider switch, deployment history, and undeploy — all routed through Pabbly Functions">
        <Endpoint method="POST" path="/api/workflows/:id/build" desc="Validate and activate agent."
          response={`{ "valid": true, "status": "active", "steps_count": 3, "errors": [], "warnings": [] }`} />
        <Endpoint method="GET" path="/api/workflows/:id/builds" desc="List build history." />
        <Endpoint method="POST" path="/api/workflows/:id/deploy" desc="Deploy to Pabbly Functions."
          response={`{ "status": "deployed", "function_id": "...", "invoke_url": "https://...", "curl_command": "curl ...", "code_size_kb": 42, "is_update": false }`} />
        <Endpoint method="POST" path="/api/workflows/:id/sync" desc="Re-push current steps/model/memory to an already-deployed function. Used after credential or step changes." />
        <Endpoint method="POST" path="/api/workflows/:id/update-env" desc="Update model/provider on a deployed function without full redeploy."
          body={`{ "model": "claude-sonnet-4-6", "provider": "anthropic" }`} />
        <Endpoint method="GET" path="/api/workflows/:id/deployments" desc="List deployment history." />
        <Endpoint method="DELETE" path="/api/workflows/:id/deploy" desc="Remove deployed function (undeploy)." />
      </Section>

      <Section title="Tests" icon={Play} tooltip="Run all steps or a single step with sample input; list past test runs for replay">
        <Endpoint method="POST" path="/api/workflows/:id/test" desc="Run all steps with test data."
          body={`{ "input": "{ \\"message\\": \\"test\\" }", "model": "claude-sonnet-4-6" }`}
          response={`{ "status": "passed", "output": "...", "duration_ms": 1234, "step_results": [...] }`} />
        <Endpoint method="POST" path="/api/workflows/:id/test-step/:stepId" desc="Test a single step in isolation."
          body={`{ "step_id": "...", "payload": { "key": "value" }, "previous_steps": { "Step 1": "output from step 1" } }`} />
        <Endpoint method="GET" path="/api/workflows/:id/tests" desc="List test history." />
      </Section>

      <Section title="API Keys" icon={Key} tooltip="BYOK CRUD — list (masked), upsert per provider, reveal full key (5/hour limit), delete, and validity test">
        <Endpoint method="GET" path="/api/keys" desc="List user's API keys (provider + last 4 chars hint, not full key)." />
        <Endpoint method="POST" path="/api/keys" desc="Create or update an API key. Upserts per provider."
          body={`{ "provider": "anthropic", "api_key": "sk-ant-..." }`} />
        <Endpoint method="DELETE" path="/api/keys/:id" desc="Delete an API key." />
        <Endpoint method="GET" path="/api/keys/:id/reveal" desc="Decrypt and show the full key. Rate-limited: 5/hour. Audit-logged." />
        <Endpoint method="POST" path="/api/keys/test" desc="Test key validity by calling the provider's API."
          body={`{ "provider": "anthropic", "api_key": "sk-ant-..." }`} />
      </Section>

      <Section title="Sessions" icon={Clock} tooltip="List, create, rename, and delete the parallel chat threads inside a workflow">
        <Endpoint method="GET" path="/api/workflows/:id/sessions" desc="List conversation sessions for an agent." />
        <Endpoint method="POST" path="/api/workflows/:id/sessions" desc="Create a new session."
          body={`{ "label": "My Session" }`} />
      </Section>

      <Section title="Credits & Usage" icon={CreditCard} tooltip="Balance, paginated transaction history, model pricing table, package list, and per-period usage summaries">
        <Endpoint method="GET" path="/api/credits" desc="Get balance and recent transactions. Numeric fields are in milli-credits (1 credit = 1,000 milli-credits); *_credits fields are the friendly decimal representation."
          response={`{ "balance": 100000, "balance_credits": 100.0, "lifetime_purchased": 100000, "lifetime_used": 0, "credits_per_dollar": 20, "recent_transactions": [...] }`} />
        <Endpoint method="GET" path="/api/credits/pricing" desc="Get model pricing table." />
        <Endpoint method="GET" path="/api/credits/history" desc="Paginated transaction history. Query: ?page=, ?limit=, ?tx_type=, ?period=, ?model=, ?agent_id=." />
        <Endpoint method="GET" path="/api/credits/packages" desc="List active credit packages (public)." />
        <Endpoint method="GET" path="/api/credits/invoice/:invoiceId" desc="Post-payment invoice status (credited | pending | unknown)." />
        <Endpoint method="GET" path="/api/usage/summary" desc="Token usage overview. Query: ?period= (7d, 30d, 90d)." />
        <Endpoint method="GET" path="/api/usage/agent/:agentId" desc="Per-agent usage breakdown." />
        <Endpoint method="GET" path="/api/usage/all-pricing" desc="Full pricing table for all models." />
      </Section>

      <Section title="Templates & Folders" icon={FolderOpen} tooltip="Public templates list + clone-to-workspace; folder CRUD for organizing workflows">
        <Endpoint method="GET" path="/api/templates" desc="List all public templates, sorted by popularity and clone count." />
        <Endpoint method="POST" path="/api/templates/:id/clone" desc="Clone a template to your workspace." />
        <Endpoint method="GET" path="/api/folders" desc="List user's folders." />
        <Endpoint method="POST" path="/api/folders" desc="Create a folder."
          body={`{ "name": "My Folder" }`} />
        <Endpoint method="PUT" path="/api/folders/:id" desc="Update a folder." />
        <Endpoint method="DELETE" path="/api/folders/:id" desc="Delete a folder." />
      </Section>

      <Section title="Other Endpoints" icon={Server} tooltip="Misc helpers — verify-step, transcribe audio, message reactions, model + tool catalogs, health check">
        <Endpoint method="POST" path="/api/verify-step" desc="Verify step credentials by testing them against the provider." />
        <Endpoint method="POST" path="/api/transcribe" desc="Transcribe audio to text." />
        <Endpoint method="POST" path="/api/feedback/react" desc="Submit a thumbs up/down reaction on a message." />
        <Endpoint method="GET" path="/api/models" desc="List available LLM models." />
        <Endpoint method="GET" path="/api/tools" desc="List available tools." />
        <Endpoint method="GET" path="/health" noAuth desc="Health check (no auth required)." />
      </Section>

      <Section title="cURL Examples" icon={Code2} tooltip="Copy-paste cURL snippets for the most common flows: create workflow, trigger webhook, list steps, add BYOK key, store credential">
        <p><B>Create a workflow:</B></p>
        <Code>{`curl -X POST https://agenticai.pabbly.com/api/workflows \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "My Workflow", "description": "Test workflow"}'`}</Code>

        <p><B>Trigger webhook (no auth needed):</B></p>
        <Code>{`curl -X POST https://agenticai.pabbly.com/api/webhook/USER_ID/AGENT_ID \\
  -H "Content-Type: application/json" \\
  -d '{"message": "Hello from webhook"}'`}</Code>

        <p><B>List steps:</B></p>
        <Code>{`curl https://agenticai.pabbly.com/api/workflows/AGENT_ID/steps \\
  -H "Authorization: Bearer YOUR_TOKEN"`}</Code>

        <p><B>Check run history (public):</B></p>
        <Code>{`curl https://agenticai.pabbly.com/api/run-history/RUN_ID`}</Code>

        <p><B>Add an API key (BYOK):</B></p>
        <Code>{`curl -X POST https://agenticai.pabbly.com/api/keys \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"provider": "anthropic", "api_key": "sk-ant-api03-..."}'`}</Code>

        <p><B>Store a credential:</B></p>
        <Code>{`curl -X PUT https://agenticai.pabbly.com/api/workflows/AGENT_ID/memory/my_api_key \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"value": "sk-secret-value"}'`}</Code>
      </Section>

    </div>
  )
}

// ── Tab: Admin Guide ──

function AdminGuideTab() {
  return (
    <div className="w-full">

      <Section title="Admin Panel Overview" icon={Shield} tooltip="The 5 management tabs — Providers & Models, Token Pricing, Credit Economics, Pricing Plans, Users & Usage">
        <p>
          The Admin Panel is accessible from the <B>Admin</B> nav item in the sidebar (visible only to admin users).
          It provides 4 management tabs:
        </p>
        <table className={tableClass}>
          <thead><tr><th className={thClass}>Tab</th><th className={thClass}>Purpose</th></tr></thead>
          <tbody>
            {[
              ['Providers & Models', 'Configure platform API keys, enable/disable AI models'],
              ['Credit Economics', 'Credit flow dashboard, margin configuration, profit tracking'],
              ['Pricing Plans', 'Manage Stripe/Pabbly checkout URLs for credit packages'],
              ['Users & Usage', 'Search users, manage roles, grant credits'],
            ].map(([t, p]) => (
              <tr key={t}><td className={tdClass}><B>{t}</B></td><td className={tdClass}>{p}</td></tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="AI Providers & Models" icon={Cpu} tooltip="Five provider channels (Anthropic / OpenAI / Google / xAI / Custom OpenAI-compatible), BYOK vs platform routing, native function calling, and 429/529 retry policy">
        <p>
          The platform supports five provider channels — <B>Anthropic</B>, <B>OpenAI</B>, <B>Google</B>, <B>xAI</B>, and a
          generic <B>custom (OpenAI-compatible)</B> channel that works with any endpoint implementing the OpenAI chat API
          (Friendli, Together, Groq, DeepSeek, Baseten, Ollama, LM Studio, etc.).
          Each channel is configured with a platform-level API key stored AES-256-GCM encrypted in <IC>admin_settings</IC>.
        </p>
        <p className={subHeadClass}>BYOK vs Platform key</p>
        <div className="flex flex-col gap-2 mt-1">
          <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
            <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
            <div>
              <span className="font-semibold text-emerald-800 dark:text-emerald-300">BYOK User</span>
              <span className="text-emerald-700 dark:text-emerald-400"> — Uses their own API key. No credits deducted. Usage is logged for analytics only.</span>
            </div>
          </div>
          <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
            <Coins className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
            <div>
              <span className="font-semibold text-blue-800 dark:text-blue-300">Platform User</span>
              <span className="text-blue-700 dark:text-blue-400"> — Uses the platform key. Credits are deducted. Revenue is generated for the operator.</span>
            </div>
          </div>
        </div>
        <p className={subHeadClass}>Native function calling loop</p>
        <p>
          The system uses <B>native function calling</B> — tools are sent as structured JSON Schema in each provider's <IC>tools</IC> API parameter.
          Providers return structured tool call objects (no text parsing needed). The backend executes tools, appends results,
          and loops — up to <B>25 iterations</B> per request. This eliminates hallucinated tool calls and parsing errors.
        </p>
        <p className={subHeadClass}>Active model</p>
        <p>
          Exactly one model per channel is marked as <B>active</B> — the one the platform routes to when a user selects "Pabbly Provider".
          Switch it from the <B>Providers & Models</B> tab (<IC>POST /api/admin/settings/active-model</IC>).
          Per-model raw cost and user-facing rates live alongside each model in the same tab.
        </p>
        <p className={subHeadClass}>Rate-limit retry</p>
        <p>All provider calls (both streaming and non-streaming) retry 429 and 529 responses with exponential backoff — 3 retries at 1s / 2s / 4s. After that the error surfaces to the caller with a "(after 3 retries)" suffix.</p>
      </Section>

      <Section title="Token Cost Model" icon={BarChart3} tooltip="Four token types (input / output / cache read / cache write), pricing resolution order, and the raw $/Mtok rates per model before margin">
        <p>AI providers charge per token (~4 characters). Four token types are tracked:</p>
        <table className={tableClass}>
          <thead><tr><th className={thClass}>Token Type</th><th className={thClass}>What it is</th><th className={thClass}>Typical cost</th></tr></thead>
          <tbody>
            {[
              ['Input tokens', 'Text sent to the model (system prompt + history + message)', 'Low'],
              ['Output tokens', 'Text generated by the model', 'High (3–5× input)'],
              ['Cache read tokens', 'Re-read from cached prompt (Anthropic only)', 'Very low (~10% of input)'],
              ['Cache write tokens', 'First-time cache write (Anthropic only)', 'Slightly above input'],
            ].map(([t, d, c]) => (
              <tr key={t}><td className={tdClass}><B>{t}</B></td><td className={tdClass}>{d}</td><td className={tdClass}>{c}</td></tr>
            ))}
          </tbody>
        </table>
        <p className={subHeadClass}>Pricing resolution order</p>
        <div className="flex flex-col gap-2 mt-1">
          {[
            ['1', 'credit_pricing collection (MongoDB)', 'Primary source — operator-customizable per model'],
            ['2', 'OpenRouter pricing cache', 'Auto-refreshed fallback for unlisted models'],
            ['3', 'Zero cost', 'Logged as warning — usage recorded but not charged'],
          ].map(([n, source, note]) => (
            <div key={n} className="flex items-start gap-2">
              <span className={stepBadge}>{n}</span>
              <div><B>{source}</B> — {note}</div>
            </div>
          ))}
        </div>
        <p className={subHeadClass}>Provider pricing (raw cost, before margin)</p>
        <table className={tableClass}>
          <thead><tr><th className={thClass}>Model</th><th className={thClass}>Input $/Mtok</th><th className={thClass}>Output $/Mtok</th><th className={thClass}>Cache Read</th><th className={thClass}>Cache Write</th></tr></thead>
          <tbody>
            {[
              ['Claude Opus 4.6', '$5.00', '$25.00', '$0.50', '$6.25'],
              ['Claude Sonnet 4.6', '$3.00', '$15.00', '$0.30', '$3.75'],
              ['Claude Haiku 4.5', '$0.80', '$4.00', '$0.08', '$1.00'],
              ['GPT-4o', '$2.50', '$10.00', '—', '—'],
              ['GPT-4o Mini', '$0.15', '$0.60', '—', '—'],
              ['GPT-4 Turbo', '$10.00', '$30.00', '—', '—'],
              ['Gemini 2.5 Pro', '$1.25', '$10.00', '—', '—'],
              ['Gemini 2.5 Flash', '$0.15', '$0.60', '—', '—'],
              ['Gemini 2.0 Flash', '$0.10', '$0.40', '—', '—'],
              ['Grok 3', '$3.00', '$15.00', '—', '—'],
              ['Grok 3 Mini', '$0.30', '$0.50', '—', '—'],
            ].map(([m, i, o, cr, cw]) => (
              <tr key={m}><td className={tdClass}><B>{m}</B></td><td className={tdClass}>{i}</td><td className={tdClass}>{o}</td><td className={tdClass}>{cr}</td><td className={tdClass}>{cw}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-neutral-500">Prices stored internally as milli-credits (1 credit = 1,000 milli-credits). $1 = 20 credits (configurable).</p>
      </Section>

      <Section title="Credit Management" icon={Coins} tooltip="How credits are added (signup bonus + purchases), the deduction flow, cost formula, margin multiplier, worked example, and atomicity guarantees">
        <p>
          Credits are stored as <B>1,000 milli-credits</B> per credit internally. <B>$1 = 20 credits</B> (configurable from admin panel). The UI displays values with 2 decimal places.
        </p>
        <p className={subHeadClass}>How credits are added</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
          <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-700/40">
            <p className="font-semibold text-neutral-700 dark:text-neutral-300 mb-1">Signup bonus</p>
            <p className="text-neutral-500 dark:text-neutral-400"><B>50 free credits</B> on account creation.</p>
          </div>
          <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-700/40">
            <p className="font-semibold text-neutral-700 dark:text-neutral-300 mb-1">Purchases</p>
            <table className="w-full text-xs mt-1">
              <tbody>
                {[['100 credits', '$5'], ['440 credits', '$20 ★'], ['1,200 credits', '$50']].map(([c, p]) => (
                  <tr key={c}><td className="pr-4 py-0.5 text-neutral-600 dark:text-neutral-400">{c}</td><td className="font-medium text-neutral-700 dark:text-neutral-300">{p}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-1 text-neutral-500">Admins can also grant credits manually from the <B>Users & Usage</B> tab.</p>
        <p className={subHeadClass}>Credit deduction flow</p>
        <div className="flex flex-col gap-0 mt-1">
          {[
            { icon: Zap, label: 'User sends message or runs a workflow step' },
            { icon: Key, label: 'System checks for BYOK key — if found, uses it; no credits deducted' },
            { icon: Server, label: 'No BYOK → use platform key; verify balance ≥ cost (returns 402 if insufficient)' },
            { icon: Cpu, label: 'Call AI provider API; receive token counts (input, output, cache read/write)' },
            { icon: DollarSign, label: 'calculate_cost(): raw cost from tokens × rates, then × margin multiplier' },
            { icon: Database, label: 'deduct_credits(): atomic MongoDB findOneAndUpdate with balance guard' },
            { icon: Lock, label: 'Log transaction to credit_transactions; update cached balance' },
          ].map(({ icon: Icon, label }, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-neutral-100 dark:bg-neutral-700/40 border border-neutral-200 dark:border-neutral-700 flex-shrink-0">
                  <Icon className="w-3.5 h-3.5 text-neutral-500 dark:text-neutral-400" />
                </div>
                {i < 6 && <div className="w-px h-4 bg-neutral-200 dark:bg-neutral-700" />}
              </div>
              <p className="pt-1.5 pb-2">{label}</p>
            </div>
          ))}
        </div>
        <p className={subHeadClass}>Cost formula</p>
        <div className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 font-mono text-[11px] text-neutral-700 dark:text-neutral-300 space-y-1">
          <p>raw_sum = input_tokens × input_rate</p>
          <p className="pl-10">+ output_tokens × output_rate</p>
          <p className="pl-10">+ cache_read_tokens × cache_read_rate</p>
          <p className="pl-10">+ cache_write_tokens × cache_write_rate</p>
          <p className="mt-2 pt-2 border-t border-neutral-200 dark:border-neutral-700">cost = ⌈ raw_sum × margin × credits_per_dollar ÷ 1,000,000,000 ⌉</p>
          <p className="text-neutral-500 text-[10px] mt-1">Rates are micro-dollars/Mtok. Result is milli-credits (÷1000 for display).</p>
        </div>
        <p className={subHeadClass}>Profit margin configuration</p>
        <p>The <IC>CREDIT_MARGIN_MULTIPLIER</IC> controls markup on every AI call. Configurable from the <B>Credit Economics</B> tab without a server restart.</p>
        <table className={tableClass + ' mt-2'}>
          <thead><tr><th className={thClass}>Multiplier</th><th className={thClass}>Profit margin</th><th className={thClass}>$0.0547 raw → charged</th></tr></thead>
          <tbody>
            {[
              ['1.0', 'Break even (0%)', '$0.0547'],
              ['1.25', '20% profit', '$0.0684'],
              ['1.5', '33% profit', '$0.0821'],
              ['2.0', '50% profit', '$0.1094'],
              ['3.0', '67% profit', '$0.1641'],
            ].map(([m, p, e]) => (
              <tr key={m}><td className={tdClass}><IC>{m}</IC></td><td className={tdClass}>{p}</td><td className={tdClass}>{e}</td></tr>
            ))}
          </tbody>
        </table>
        <p className={subHeadClass}>Worked example</p>
        <p>
          <B>Claude Opus 4.6</B> — 3,967 input tokens + 1,396 output tokens at 1.5× margin:
        </p>
        <div className="mt-2 rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden">
          {[
            ['Input cost', '3,967 × $5 / 1M', '$0.0198'],
            ['Output cost', '1,396 × $25 / 1M', '$0.0349'],
            ['Raw cost', '', '$0.0547'],
            ['After 1.5× margin', '', '$0.0821'],
            ['Operator profit', '', '$0.0274'],
          ].map(([label, calc, val], i) => (
            <div key={label} className={`flex items-center justify-between px-3 py-2 text-xs
              ${i < 4 ? 'border-b border-neutral-100 dark:border-neutral-700/50' : ''}
              ${label === 'Raw cost' || label === 'After 1.5× margin' ? 'font-semibold text-neutral-700 dark:text-neutral-300 bg-neutral-50 dark:bg-neutral-700/40' : ''}
              ${label === 'Operator profit' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 font-semibold' : ''}
            `}>
              <span>{label}</span>
              <div className="flex items-center gap-4">
                {calc && <span className="text-neutral-400 dark:text-neutral-500 font-mono text-[11px]">{calc}</span>}
                <span className="font-mono">{val}</span>
              </div>
            </div>
          ))}
        </div>
        <p className={subHeadClass}>At scale</p>
        <table className={tableClass}>
          <thead><tr><th className={thClass}>Users spend</th><th className={thClass}>Provider cost (~67%)</th><th className={thClass}>Profit (~33%)</th></tr></thead>
          <tbody>
            {[['$100', '~$67', '~$33'], ['$1,000', '~$667', '~$333'], ['$10,000', '~$6,667', '~$3,333']].map(([s, p, pr]) => (
              <tr key={s}><td className={tdClass}>{s}</td><td className={tdClass}>{p}</td><td className={tdClass}><span className="font-semibold text-emerald-600 dark:text-emerald-400">{pr}</span></td></tr>
            ))}
          </tbody>
        </table>
        <p className={subHeadClass}>Safety & atomicity</p>
        <div className="flex flex-col gap-2 mt-1">
          {[
            ['Race conditions prevented', 'MongoDB findOneAndUpdate with a balance ≥ cost guard. Negative balances are impossible.'],
            ['Double-crediting prevented', 'Unique indexes on credit_transactions.stripe_payment_id AND pending_credits.invoice_id — duplicate Pabbly webhook deliveries are idempotent.'],
            ['Pre-signup purchases', 'Pabbly invoice_paid webhooks for emails that have not registered yet are queued in pending_credits and drained automatically on first signup.'],
            ['Platform key isolation', 'Platform API keys are only ever read server-side. Users never see them — BYOK keys are stored encrypted, per-user, in the api_keys collection.'],
          ].map(([title, desc]) => (
            <div key={title} className="flex items-start gap-2 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-700/40 border border-neutral-200 dark:border-neutral-700">
              <Lock className="w-3.5 h-3.5 text-neutral-400 mt-0.5 flex-shrink-0" />
              <div><B>{title}</B> — {desc}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Admin API Endpoints" icon={Server} tooltip="Backend admin routes — stats, users + role toggle, credit grant, pricing/margin/active-model settings, packages, and platform usage analytics">
        <Endpoint method="GET" path="/api/admin/stats" desc="Platform-wide statistics (users, agents, credits, usage)." />
        <Endpoint method="GET" path="/api/admin/users" desc="List all users with search and pagination." />
        <Endpoint method="POST" path="/api/admin/users/:id/toggle-role" desc="Toggle a user's admin role." />
        <Endpoint method="POST" path="/api/admin/users/:id/grant-credits" desc="Grant credits to a user."
          body={`{ "credits": 100 }`} />
        <Endpoint method="GET" path="/api/admin/pricing" desc="Get pricing for every tracked model." />
        <Endpoint method="PUT" path="/api/admin/pricing/:id" desc="Update provider pricing for a specific model." />
        <Endpoint method="GET" path="/api/admin/settings" desc="Get platform settings (margin multiplier, credits_per_dollar, platform keys — masked)." />
        <Endpoint method="PUT" path="/api/admin/settings/margin" desc="Update the credit margin multiplier."
          body={`{ "margin_multiplier": 2.0 }`} />
        <Endpoint method="PUT" path="/api/admin/settings/credits-per-dollar" desc="Update the credits-per-dollar exchange rate (default 20)."
          body={`{ "credits_per_dollar": 20 }`} />
        <Endpoint method="PUT" path="/api/admin/settings/platform-key/:provider" desc="Set the platform API key for a provider (anthropic | openai | google | xai | custom). For custom, also accepts base_url, model_id, auth_header_prefix, provider_name."
          body={`{ "api_key": "sk-..." }`} />
        <Endpoint method="GET" path="/api/admin/settings/active-model" desc="Get the platform's current active default model." />
        <Endpoint method="POST" path="/api/admin/settings/active-model" desc="Set the platform's active default model."
          body={`{ "provider": "anthropic", "model": "claude-sonnet-4-6" }`} />
        <Endpoint method="PUT" path="/api/admin/settings/preferred-model" desc="Set the preferred model per provider (used as the BYOK default for that provider)." />
        <Endpoint method="GET" path="/api/admin/packages" desc="List all credit packages (admin view — includes inactive)." />
        <Endpoint method="POST" path="/api/admin/packages" desc="Create a new credit package. Matched to the Pabbly plan via pabbly_plan_id."
          body={`{ "pabbly_plan_id": "...", "label": "Pro", "credits": 440, "price_cents": 2000, "embed_script": "...", "checkout_url": "...", "icon": "🚀", "popular": true, "sort_order": 2 }`} />
        <Endpoint method="PUT" path="/api/admin/packages/:id" desc="Update an existing credit package." />
        <Endpoint method="DELETE" path="/api/admin/packages/:id" desc="Soft-delete a package (sets active=false) so historical transactions keep their reference." />
        <Endpoint method="GET" path="/api/admin/deployed-agents-health" desc="Health status for every deployed workflow (Pabbly Functions)." />
        <Endpoint method="GET" path="/api/admin/usage/summary" desc="Platform-wide usage summary (period / model / provider filters)." />
        <Endpoint method="GET" path="/api/admin/usage/users" desc="Top users by spend / tokens." />
        <Endpoint method="GET" path="/api/admin/usage/transactions" desc="All credit transactions (paginated, filterable)." />
      </Section>

    </div>
  )
}

// ── Main Page Component ──

export default function DocsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()
  const activeTab = searchParams.get('tab') || 'guide'

  useEffect(() => {
    document.title = 'Pabbly AgenticAI | Docs'
    // DashboardLayout puts .scrollbar-hide on its <main> so other pages don't
    // get a "dancing" scrollbar when content shrinks. Docs is long-form and
    // benefits from a visible scroll indicator, so opt out here only.
    const main = document.querySelector('main.scrollbar-hide')
    main?.classList.remove('scrollbar-hide')
    return () => {
      document.title = 'Pabbly AgenticAI'
      main?.classList.add('scrollbar-hide')
    }
  }, [])

  // API Reference and Admin Guide are both admin-only — the endpoint reference
  // is operator-facing material (internal routes, secret rotation, etc.) that
  // regular users should not see.
  const tabs = [
    { id: 'guide', label: 'User Guide', icon: BookOpen, tip: 'Getting started, building workflows, and best practices' },
    ...(user?.is_admin ? [{ id: 'api', label: 'API Reference', icon: Code2, tip: 'Internal endpoint reference for operators' }] : []),
    ...(user?.is_admin ? [{ id: 'admin', label: 'Admin Guide', icon: Shield, tip: 'Admin operations: providers, pricing, secrets' }] : []),
  ]

  return (
    <div className="p-3 sm:p-6 [overflow-x:clip]">
      {/* Page header */}
      <div className="mb-4 sm:mb-6 min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-neutral-100">Documentation</h1>
        <p className="text-sm sm:text-base text-gray-600 dark:text-neutral-400 mt-0.5 sm:mt-1">
          Everything you need to build and run AI workflows.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-6 mb-6 border-b border-neutral-200 dark:border-neutral-700">
        {tabs.map((tab) => {
          const TabIcon = tab.icon
          return (
            <Tooltip key={tab.id} content={tab.tip}>
              <button
                onClick={() => setSearchParams({ tab: tab.id })}
                aria-current={activeTab === tab.id ? 'page' : undefined}
                aria-label={tab.label}
                className={`flex items-center gap-1.5 pb-2.5 text-[13px] font-medium transition-all border-b-2 -mb-px
                  ${activeTab === tab.id
                    ? 'border-neutral-900 dark:border-neutral-100 text-neutral-900 dark:text-neutral-100'
                    : 'border-transparent text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300'
                  }`}
              >
                <TabIcon className="w-4 h-4" />
                {tab.label}
              </button>
            </Tooltip>
          )
        })}
      </div>

      {/* Tab content wrapped in DocsLayout — provides the left section
          nav, right "On this page" TOC, sticky search bar, and mobile
          drawer. Each tab gets its own DocsLayout so section registries
          don't bleed across tabs.
          Admin-only tabs are double-gated — both the trigger in the nav
          and the content renderer check is_admin so a URL-crafted
          ?tab=api / ?tab=admin never reveals anything to a non-admin. */}
      {activeTab === 'guide' && (
        <DocsLayout tabKey="guide"><UserGuideTab /></DocsLayout>
      )}
      {user?.is_admin && activeTab === 'api' && (
        <DocsLayout tabKey="api"><ApiReferenceTab /></DocsLayout>
      )}
      {user?.is_admin && activeTab === 'admin' && (
        <DocsLayout tabKey="admin"><AdminGuideTab /></DocsLayout>
      )}
    </div>
  )
}
