import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Shared markdown CSS classes for consistent rendering
export const MARKDOWN_CLASSES = `
  prose prose-sm max-w-none prose-neutral
  [&_h1]:text-base sm:[&_h1]:text-lg [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1.5
  [&_h2]:text-[13px] sm:[&_h2]:text-[15px] [&_h2]:font-bold [&_h2]:mt-2.5 [&_h2]:mb-1
  [&_h3]:text-[13px] sm:[&_h3]:text-sm [&_h3]:font-bold [&_h3]:mt-2 [&_h3]:mb-1
  [&_h4]:text-[13px] sm:[&_h4]:text-sm [&_h4]:font-semibold [&_h4]:mt-1.5
  [&_p]:text-[13px] sm:[&_p]:text-[15px] [&_p]:leading-relaxed [&_p]:my-1 [&_p]:break-words
  [&_ul]:text-[13px] sm:[&_ul]:text-[15px] [&_ul]:my-1 [&_ul]:pl-5 [&_ul]:list-disc
  [&_ol]:text-[13px] sm:[&_ol]:text-[15px] [&_ol]:my-1 [&_ol]:pl-5 [&_ol]:list-decimal
  [&_li]:my-0.5 [&_li]:pl-1
  [&_strong]:font-semibold
  [&_em]:italic
  [&_a]:text-primary-600 [&_a]:underline
  [&_blockquote]:border-l-2 [&_blockquote]:border-neutral-300 dark:[&_blockquote]:border-[#484848] [&_blockquote]:pl-3 [&_blockquote]:text-neutral-500 dark:[&_blockquote]:text-neutral-400 [&_blockquote]:italic [&_blockquote]:my-2
  [&_hr]:border-neutral-200 dark:[&_hr]:border-[#484848] [&_hr]:my-3
  [&_table]:w-full [&_table]:text-[11px] sm:[&_table]:text-[13px] [&_table]:my-2 [&_table]:border-collapse
  [&_th]:bg-neutral-50 dark:[&_th]:bg-transparent [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold [&_th]:border [&_th]:border-neutral-200 dark:[&_th]:border-[#484848]
  [&_td]:px-2 [&_td]:py-1 [&_td]:border [&_td]:border-neutral-200 dark:[&_td]:border-[#484848]
  [&_pre]:bg-neutral-800 [&_pre]:text-neutral-100 [&_pre]:p-3 [&_pre]:text-[13px] [&_pre]:leading-relaxed [&_pre]:whitespace-pre-wrap [&_pre]:break-all [&_pre]:max-w-full [&_pre]:m-0 [&_pre]:[contain:inline-size] [&_pre]:min-w-0
  [&_code]:text-[13px] [&_code]:font-mono
  [&_:not(pre)>code]:bg-neutral-200 dark:[&_:not(pre)>code]:bg-[#383838] [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:rounded [&_:not(pre)>code]:text-red-600 dark:[&_:not(pre)>code]:text-red-400
  [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-neutral-100
`.trim().replace(/\n\s+/g, ' ')

// Sanitize text for markdown — fix unclosed code fences, convert literal \n \t,
// and strip internal system tokens that should never reach the user.
export const sanitizeForMarkdown = (text) => {
  if (!text) return text
  // Strip internal bracketed system tokens that occasionally leak from the model's
  // output. These are for backend/model coordination, not for the end user.
  // Examples: [STEP_CREATED_AWAITING_USER_CONFIRMATION], [SYSTEM REMINDER — ...],
  // [TOOL RESULTS — BLOCKED BY SYSTEM], [BRACKETED_SYSTEM_TOKEN]
  let stripped = text
    .replace(/\[STEP_CREATED_AWAITING_USER_CONFIRMATION\]/g, '')
    .replace(/\[SYSTEM REMINDER[^\]]*\][^\n]*\n?/g, '')
    .replace(/\[TOOL RESULTS[^\]]*\][^\n]*\n?/g, '')
    .replace(/\[BRACKETED_SYSTEM_TOKEN\]/g, '')
  // Close unclosed code fences by appending a closing ``` so code stays in a code block
  const fences = stripped.match(/```/g)
  let fixed = (fences && fences.length % 2 !== 0) ? stripped + '\n```' : stripped
  // Convert literal \n \t to real whitespace outside code blocks
  const parts = fixed.split(/(```[\s\S]*?```)/g)
  return parts.map((part, i) => {
    if (i % 2 === 1) return part // preserve code blocks
    return part.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\r/g, '')
  }).join('')
}

// Creates markdown components — needs ToolCallCard and AgentStatusCard/AgentInstructionsCard passed in
export function createMarkdownComponents(ToolCallCard, AgentStatusCard, AgentInstructionsCard) {
  return {
    pre({ children, node, ...props }) {
      const codeChild = node?.children?.[0]
      const hasLang = codeChild?.properties?.className?.some?.(c => c?.startsWith?.('language-'))
      if (hasLang) {
        return <div className="my-2">{children}</div>
      }
      return <pre className="bg-neutral-900 dark:bg-[#1a1a1a] text-neutral-100 rounded-lg p-3 my-2 text-[13px] leading-relaxed whitespace-pre-wrap max-w-full min-w-0" style={{ contain: 'inline-size', wordBreak: 'break-all' }} {...props}>{children}</pre>
    },
    code({ className, children, ...props }) {
      const isBlock = className?.startsWith('language-')
      if (isBlock) {
        const lang = className.replace('language-', '')
        let content = String(children).replace(/\n$/, '')
        const isJson = lang === 'json' || lang === 'tool_call' || (!lang && content.trim().startsWith('{'))
        if (isJson) {
          try { content = JSON.stringify(JSON.parse(content), null, 2) } catch {}
        }
        if (isJson) {
          try {
            const parsed = JSON.parse(String(children).replace(/\n$/, ''))
            if (parsed.name && typeof parsed.name === 'string' && (parsed.params !== undefined || lang === 'tool_call')) {
              return <ToolCallCard data={parsed} />
            }
            if (parsed.step && typeof parsed.step === 'object' && parsed.step.name) {
              return <ToolCallCard data={{ name: 'create_step', params: parsed.step }} />
            }
            if (parsed.agent_status !== undefined) {
              return <AgentStatusCard data={parsed} />
            }
            if (parsed.agent_instructions && typeof parsed.agent_instructions === 'string') {
              return <AgentInstructionsCard text={parsed.agent_instructions} />
            }
            if (parsed.step_reorder && Array.isArray(parsed.step_reorder)) {
              return <ToolCallCard data={{ name: 'step_reorder', params: { steps: parsed.step_reorder } }} />
            }
            // clear_agent is deprecated — don't dress it up as a tool card.
            // If the model regresses and emits it, let it render as raw JSON
            // so the regression is obvious instead of silently pretending
            // a non-existent tool ran.
            const keys = Object.keys(parsed)
            if (keys.length <= 5 && keys.length > 0 && typeof parsed[keys[0]] !== 'string') {
              return <ToolCallCard data={{ name: lang || 'data', params: parsed }} />
            }
          } catch {}
          return (
            <div className="rounded-lg overflow-hidden border border-neutral-200 dark:border-[#484848]">
              {lang && <div className="px-3 py-1.5 bg-neutral-700 dark:bg-neutral-700 text-[10px] font-mono text-white uppercase">{lang.replace('_', ' ')}</div>}
              <pre className="px-3 py-2 bg-neutral-900 dark:bg-neutral-900 text-neutral-100 text-[13px] font-mono whitespace-pre-wrap max-w-full min-w-0 rounded-none rounded-b-lg" style={{ margin: 0, marginBlock: 0, contain: 'inline-size', wordBreak: 'break-all' }}><code>{content}</code></pre>
            </div>
          )
        }
        return (
          <div className="rounded-lg overflow-hidden border border-neutral-200 dark:border-[#484848]">
            {lang && <div className="px-3 py-1.5 bg-neutral-700 dark:bg-neutral-700 text-[10px] font-mono text-white uppercase">{lang}</div>}
            <pre className="p-3 bg-neutral-900 dark:bg-neutral-900 text-neutral-100 text-[13px] font-mono whitespace-pre-wrap max-w-full min-w-0" style={{ contain: 'inline-size', wordBreak: 'break-all' }}><code>{content}</code></pre>
          </div>
        )
      }
      return <code className="bg-neutral-200 dark:bg-[#383838] px-1 py-0.5 rounded text-red-600 dark:text-red-400 text-[13px] font-mono" {...props}>{children}</code>
    },
    table({ children }) {
      return <div className="overflow-x-auto my-2"><table className="w-full border-collapse text-[13px]">{children}</table></div>
    },
    thead({ children }) {
      return <thead className="bg-neutral-200 dark:bg-primary-800">{children}</thead>
    },
    th({ children }) {
      return <th className="border-0 px-3 py-2 text-left font-bold text-neutral-900 dark:text-primary-100 uppercase tracking-wide text-[12px]">{children}</th>
    },
    td({ children }) {
      return <td className="border-b border-neutral-200 dark:border-[#484848] px-3 py-2 text-neutral-900 dark:text-neutral-300 bg-white dark:bg-[#383838] hover:bg-neutral-50 dark:hover:bg-[#383838] transition-colors">{children}</td>
    },
    a({ href, children }) {
      return <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary-600 dark:text-primary-400 underline hover:text-primary-700 dark:hover:text-primary-300">{children}</a>
    },
  }
}

// Memoized markdown — only re-parses when content changes, not on every parent render
export const MemoMarkdown = memo(({ content, components }) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
    {sanitizeForMarkdown(content)}
  </ReactMarkdown>
))
