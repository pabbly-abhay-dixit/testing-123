import { useState } from 'react'
import { ThumbsUp, ThumbsDown, Zap, Bug } from 'lucide-react'
import { react } from '../../services/analytics'

const REACTIONS = [
  { id: 'helpful', icon: ThumbsUp, label: 'Helpful', color: 'hover:text-emerald-500 dark:hover:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/30' },
  { id: 'wrong', icon: ThumbsDown, label: 'Wrong', color: 'hover:text-red-500 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30' },
  { id: 'fast', icon: Zap, label: 'Fast', color: 'hover:text-amber-500 dark:hover:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/30' },
  { id: 'bug', icon: Bug, label: 'Bug', color: 'hover:text-orange-500 dark:hover:text-orange-300 hover:bg-orange-50 dark:hover:bg-orange-900/30' },
]

const ACTIVE_COLORS = {
  helpful: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/30',
  wrong: 'text-red-500 bg-red-50 dark:bg-red-900/30',
  fast: 'text-amber-500 bg-amber-50 dark:bg-amber-900/30',
  bug: 'text-orange-500 bg-orange-50 dark:bg-orange-900/30',
}

/**
 * Reaction bar — appears on hover for assistant messages.
 *
 * Props:
 *   agentId — current agent ID
 *   messageId — message timestamp or ID (optional)
 *   runId — webhook run ID (optional, for task history)
 *   context — "chat" | "task_history" | "template"
 */
export default function ReactionBar({ agentId, messageId, runId, context = 'chat' }) {
  const [selected, setSelected] = useState(null)

  const handleReact = async (reactionId) => {
    if (selected === reactionId) {
      setSelected(null)
      return
    }
    setSelected(reactionId)
    await react(reactionId, { agent_id: agentId, message_id: messageId, run_id: runId, context })
  }

  return (
    <div className="flex items-center gap-0 opacity-0 group-hover/msg:opacity-100 transition-opacity duration-150">
      {REACTIONS.map(({ id, icon: Icon, label, color }) => (
        <button
          key={id}
          onClick={() => handleReact(id)}
          title={label}
          aria-label={label}
          className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md transition-all ${
            selected === id
              ? ACTIVE_COLORS[id]
              : `text-neutral-300 dark:text-neutral-600 ${color}`
          }`}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  )
}
