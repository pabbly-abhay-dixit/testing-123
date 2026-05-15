/**
 * Shared provider SVG logos.
 *
 * Single source of truth for the small inline SVG icons we render for each
 * AI model provider. Used by:
 *   - frontend/src/components/agent/ModelsTab.jsx (per-agent settings panel)
 *   - frontend/src/pages/AISettings.jsx           (top-level AI Settings page)
 *   - frontend/src/pages/Admin.jsx                (admin Providers tab)
 *   - frontend/src/components/builder/ChatPanel.jsx (chat header model picker)
 *
 * Adding a new provider: drop a `<path>` into the map below and export it via
 * the same `ProviderLogo` wrapper.
 */

export const ProviderLogos = {
  openai: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.998 5.998 0 0 0-3.998 2.9 6.042 6.042 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
    </svg>
  ),
  anthropic: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M17.304 3.541h-3.48l6.157 16.918h3.48L17.303 3.541zm-10.61 0L.54 20.459H4.1l1.273-3.574h6.57l1.272 3.574h3.56L10.618 3.541H6.694zm.575 10.484l2.14-6.003 2.14 6.003H7.269z" />
    </svg>
  ),
  google: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" />
    </svg>
  ),
  openrouter: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" />
      <path d="M7 9l5 3-5 3V9zm10 0v6l-5-3 5-3z" />
    </svg>
  ),
  xai: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M2.87 4h4.46l6.6 9.49L20.59 4H24L15.75 15.93 21.08 24h-4.46l-4.73-6.81L7.16 24H3.73l5.33-8.07L2.87 4z" />
    </svg>
  ),
  mistral: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M3 3h4v4H3V3zm14 0h4v4h-4V3zM3 7h4v4H3V7zm7 0h4v4h-4V7zm7 0h4v4h-4V7zM3 11h4v4H3v-4zm3.5 0H11v4H6.5v-4zm7 0H18v4h-4.5v-4zm3.5 0h4v4h-4v-4zM3 15h4v4H3v-4zm7 0h4v4h-4v-4zm7 0h4v4h-4v-4zM3 19h4v4H3v-4zm14 0h4v4h-4v-4z" />
    </svg>
  ),
  together: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <circle cx="7" cy="7" r="3" />
      <circle cx="17" cy="7" r="3" />
      <circle cx="7" cy="17" r="3" />
      <circle cx="17" cy="17" r="3" />
      <rect x="9" y="6" width="6" height="2" rx="1" />
      <rect x="6" y="9" width="2" height="6" rx="1" />
      <rect x="16" y="9" width="2" height="6" rx="1" />
      <rect x="9" y="16" width="6" height="2" rx="1" />
    </svg>
  ),
  perplexity: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M12 2L4 7v10l8 5 8-5V7l-8-5zm0 2.5L17.5 8 12 11.5 6.5 8 12 4.5zM5.5 9.27l5.5 3.18v6.3L5.5 15.57V9.27zm13 0v6.3l-5.5 3.18v-6.3l5.5-3.18z" />
    </svg>
  ),
  groq: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
    </svg>
  ),
  custom: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  ),
}

/**
 * Renders the SVG logo for a provider id, falling back to the first letter
 * of the provider name when the id is unknown. Both consumers (small chips
 * in chat header, larger squares in admin/AI settings) use the same wrapper
 * with different sizing classes via `className`.
 */
export const ProviderLogo = ({ providerId, fallbackLetter, className = '' }) => {
  const logo = ProviderLogos[providerId]
  if (logo) {
    return <span className={`flex items-center justify-center ${className}`}>{logo}</span>
  }
  return (
    <span className={`font-bold text-xs ${className}`}>
      {fallbackLetter}
    </span>
  )
}

/**
 * Shared provider color metadata. Used to tint the background of the logo
 * square so each provider feels visually distinct (matches the colors used
 * in the admin Providers tab and the existing in-agent settings panel).
 */
export const PROVIDER_COLORS = {
  anthropic: '#D97757',
  openai: '#10A37F',
  openrouter: '#6366F1',
  google: '#4285F4',
  xai: '#1D9BF0',
  mistral: '#FF6B35',
  perplexity: '#20B2AA',
  together: '#3B82F6',
  groq: '#F97316',
  custom: '#F59E0B',
}

/**
 * Human-readable provider names.
 */
export const PROVIDER_NAMES = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  google: 'Google',
  xai: 'xAI',
  mistral: 'Mistral AI',
  perplexity: 'Perplexity',
  together: 'Together AI',
  groq: 'Groq',
  custom: 'OpenAI Compatible',
}
