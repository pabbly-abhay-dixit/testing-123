import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { react, track } from '../../services/analytics'

/**
 * Contextual micro-feedback — non-blocking bottom toast.
 * Auto-dismisses after 8 seconds. One-tap, no forms.
 *
 * Props:
 *   type — "deploy_success" | "agent_working" | "template_used"
 *   agentId — current agent ID
 *   onDismiss — callback when dismissed
 */

const PROMPTS = {
  deploy_success: {
    text: 'How was the setup?',
    options: [
      { label: 'Easy', emoji: '\ud83c\udf89', value: 'easy' },
      { label: 'Okay', emoji: '\ud83d\ude10', value: 'okay' },
      { label: 'Hard', emoji: '\ud83d\ude24', value: 'hard' },
    ],
  },
  agent_working: {
    text: 'Is this agent working well?',
    options: [
      { label: 'Yes', emoji: '\ud83d\udc4d', value: 'helpful' },
      { label: 'No', emoji: '\ud83d\udc4e', value: 'wrong' },
    ],
  },
  template_used: {
    text: 'Was this template useful?',
    options: [
      { label: 'Yes', emoji: '\u2b50', value: 'helpful' },
      { label: 'Meh', emoji: '\ud83d\ude10', value: 'okay' },
      { label: 'No', emoji: '\ud83d\udc4e', value: 'wrong' },
    ],
  },
}

export default function MicroFeedback({ type, agentId, onDismiss }) {
  const [visible, setVisible] = useState(true)
  const prompt = PROMPTS[type]

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false)
      onDismiss?.()
    }, 8000)
    return () => clearTimeout(timer)
  }, [onDismiss])

  if (!visible || !prompt) return null

  const handleSelect = (value) => {
    react(value, { agent_id: agentId, context: type })
    track('micro_feedback', { type, value, agent_id: agentId })
    setVisible(false)
    onDismiss?.()
  }

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-slide-up">
      <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-[#383838] rounded-2xl shadow-lg border border-neutral-200 dark:border-[#484848]">
        <span className="text-sm text-neutral-700 dark:text-neutral-300 font-medium whitespace-nowrap">
          {prompt.text}
        </span>
        <div className="flex items-center gap-1.5">
          {prompt.options.map(({ label, emoji, value }) => (
            <button
              key={value}
              onClick={() => handleSelect(value)}
              className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-full bg-neutral-100 dark:bg-[#2c2c2c] hover:bg-neutral-200 dark:hover:bg-[#333] text-neutral-700 dark:text-neutral-300 transition-colors"
            >
              <span>{emoji}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>
        <button
          onClick={() => { setVisible(false); onDismiss?.() }}
          className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 rounded-lg transition-colors"
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
