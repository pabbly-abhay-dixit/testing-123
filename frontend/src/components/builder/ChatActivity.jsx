import { useState, useRef, useEffect } from 'react'

// Typewriter text animation — erase old text backwards, then write new text forwards
export const TypewriterText = ({ text, speed = 25 }) => {
  const [displayed, setDisplayed] = useState('')
  const lenRef = useRef(0)
  const targetRef = useRef(text)
  const prevRef = useRef('')
  const timerRef = useRef(null)
  const phaseRef = useRef('idle')

  useEffect(() => {
    const prev = prevRef.current
    targetRef.current = text
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }

    const startWrite = () => {
      phaseRef.current = 'write'
      let i = 0
      lenRef.current = 0
      setDisplayed('')
      timerRef.current = setInterval(() => {
        i++
        lenRef.current = i
        setDisplayed(targetRef.current.slice(0, i))
        if (i >= targetRef.current.length) {
          clearInterval(timerRef.current); timerRef.current = null
          phaseRef.current = 'idle'
          prevRef.current = targetRef.current
        }
      }, speed)
    }

    if (prev && prev !== text) {
      phaseRef.current = 'erase'
      let len = prev.length
      lenRef.current = len
      setDisplayed(prev)
      timerRef.current = setInterval(() => {
        len--
        lenRef.current = len
        if (len <= 0) {
          clearInterval(timerRef.current); timerRef.current = null
          setDisplayed('')
          startWrite()
        } else {
          setDisplayed(prev.slice(0, len))
        }
      }, speed * 0.6)
    } else if (text !== prev) {
      startWrite()
    }

    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null } }
  }, [text, speed])

  const showCursor = phaseRef.current === 'write' || phaseRef.current === 'erase'
  return <>{displayed}{showCursor && <span className="typing-cursor" />}</>
}

// Rotating thinking words when no specific tool is active
const THINKING_WORDS = ['Thinking...', 'Processing...', 'Analyzing...', 'Computing...', 'Working on it...']

export const RotatingThinking = () => {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex(i => (i + 1) % THINKING_WORDS.length)
    }, 3000)
    return () => clearInterval(timer)
  }, [])

  return <TypewriterText text={THINKING_WORDS[index]} speed={40} />
}

// Extract last meaningful line from streamed text — used as activity description
export const extractLastLine = (text) => {
  if (!text) return ''
  const lines = text.trim().split('\n').filter(l => {
    const t = l.replace(/[#*_>`\-\s]/g, '').trim()
    return t.length > 3 && !t.startsWith('```')
  })
  return lines.length > 0 ? lines[lines.length - 1].replace(/^[#*>\- ]+/, '').trim() : ''
}

// Friendly tool display names — replaces naive snake_case → Title Case.
// Wire names (the keys) MUST stay in sync with backend/src/utils/tools.rs all_native_tool_schemas().
// Display names should read like a human action, not a function name.
// Used as the headline on tool-call cards and as a fallback for the activity pill.
export const TOOL_DISPLAY_NAMES = {
  http_request: 'Call API',
  web_search: 'Search the web',
  web_fetch: 'Read webpage',
  send_message: 'Send chat notification',
  send_email: 'Send email',
  read_file: 'Read file',
  write_file: 'Write file',
  edit_file: 'Edit file',
  memory_store: 'Save credential',
  memory_get: 'Read credential',
  memory_delete: 'Delete credential',
  exec_command: 'Run command',
  json_transform: 'Transform JSON',
  base64_encode: 'Encode/decode text',
  process_start: 'Start background task',
  process_status: 'Check background task',
  process_kill: 'Stop background task',
  update_workflow: 'Deploy workflow',
  test_workflow: 'Test workflow',
  test_step: 'Test step',
  create_step: 'Add step',
  get_agent_status: 'Check workflow setup',
  update_step: 'Edit step',
  set_step_code: 'Save step code',
  set_step_prompt: 'Save step instructions',
  delete_step: 'Remove step',
  get_webhook_info: 'View webhook URL',
  set_webhook_schema: 'Set webhook fields',
  get_captured_webhook: 'View captured webhook',
  get_run_history: 'View run history',
  upload_file: 'Upload file',
}

// Friendly descriptions for tool activity pill
export const TOOL_DESCRIPTIONS = {
  get_agent_status: 'Checking workflow configuration...',
  create_step: 'Creating new workflow step...',
  update_step: 'Updating step configuration...',
  delete_step: 'Removing workflow step...',
  http_request: 'Making API request...',
  web_search: 'Searching the web...',
  web_fetch: 'Fetching webpage content...',
  send_message: 'Sending message...',
  send_email: 'Sending email...',
  read_file: 'Reading file...',
  write_file: 'Writing file...',
  edit_file: 'Editing file...',
  memory_store: 'Saving to memory...',
  memory_get: 'Reading from memory...',
  exec_command: 'Running command...',
  json_transform: 'Transforming data...',
  base64_encode: 'Encoding data...',
  process_start: 'Starting process...',
  test_workflow: 'Running workflow test...',
  test_step: 'Testing step...',
  get_webhook_info: 'Checking webhook info...',
  set_webhook_schema: 'Setting webhook schema...',
}
