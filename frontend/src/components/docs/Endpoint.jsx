import Code from './Code'
import { BASE_URL } from './styles'

export default function Endpoint({ method, path, desc, body, response, noAuth }) {
  // Always-expanded layout — the cURL block is the whole point of an
  // API doc, so hiding it behind a collapse just adds an extra click.
  // The endpoint's header (`METHOD path`) carries the `docs-subhead`
  // marker, so each endpoint inside a Section becomes a navigable
  // subsection in the left nav.

  const fullUrl = `${BASE_URL}${path.replace(/:(\w+)/g, '{$1}')}`
  const curlParts = [`curl -X ${method} "${fullUrl}"`]
  if (!noAuth) curlParts.push('  -H "Authorization: Bearer YOUR_TOKEN"')
  if (body) {
    curlParts.push('  -H "Content-Type: application/json"')
    try { curlParts.push(`  -d '${JSON.stringify(JSON.parse(body), null, 2)}'`) } catch { curlParts.push(`  -d '${body}'`) }
  }
  const curlCmd = curlParts.join(' \\\n')

  const borderColor =
    method === 'GET' ? 'border-l-blue-400' :
    method === 'POST' ? 'border-l-green-400' :
    method === 'DELETE' ? 'border-l-red-400' :
    'border-l-amber-400'

  const methodBadgeClass =
    method === 'GET' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
    method === 'POST' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
    method === 'DELETE' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' :
    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'

  return (
    <div
      className={`docs-endpoint mb-3 border border-gray-200 dark:border-neutral-700 border-l-[3px] ${borderColor} rounded-lg overflow-hidden shadow-sm`}
      data-method={method}
      data-path={path}
      data-desc={desc}
      data-curl={curlCmd}
      data-response={response || ''}
    >
      {/* Header doubles as a docs-subhead so DocsLayout picks it up for
          the left-nav subsection list. textContent = "METHOD path"
          which is exactly what we want as the nav label. */}
      <div className="docs-subhead w-full px-4 py-2.5 bg-gray-50 dark:bg-neutral-700/40 flex items-center gap-2.5 text-left !mt-0 !mb-0">
        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ${methodBadgeClass} min-w-[42px] text-center flex-shrink-0`}>{method}</span>
        {/* Plain space between method and path so textContent reads
            "GET /api/workflows" instead of "GET/api/workflows" — that
            string is what the left-nav subhead label shows. */}
        {' '}
        <code className="text-[12px] font-mono text-gray-900 dark:text-neutral-100 flex-1 break-all min-w-0">{path}</code>
      </div>
      <div className="docs-collapsible-body">
        <div className="px-4 py-2.5 text-sm text-gray-600 dark:text-neutral-300 border-b border-gray-100 dark:border-neutral-700/50">{desc}</div>
        <div className="px-4 py-3 bg-white dark:bg-neutral-800">
          <div className="text-[10px] font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wider mb-1">cURL</div>
          <Code>{curlCmd}</Code>
        </div>
        {response && (
          <div className="px-4 py-3 border-t border-gray-100 dark:border-neutral-700/50 bg-white dark:bg-neutral-800">
            <div className="text-[10px] font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wider mb-1">Response</div>
            <Code>{response}</Code>
          </div>
        )}
      </div>
    </div>
  )
}
