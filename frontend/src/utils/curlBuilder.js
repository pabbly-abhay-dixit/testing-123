// Build a Postman-compatible cURL command for invoking a deployed Pabbly Functions
// agent. The body MUST be on one line (no pretty-print line breaks inside the
// quoted body) — that's the #1 cause of Postman "Import → Raw text" failures.
//
// Single quotes inside the JSON body are escaped using the POSIX-safe
// '\'' sequence so the command is also runnable as-is from a real shell.
export function buildInvokeCurl({ url, schema, invokedBy } = {}) {
  if (!url) return ''

  // `invoked_by` is the calling user's identity, used for the FaaS audit
  // trail and per-invocation logging. Callers MUST pass the logged-in user
  // here — the chat panel and the deploy modal both pull it from AuthContext.
  // We deliberately fall back to empty strings (NOT a fake "API Caller" /
  // "api@example.com") so that if AuthContext hasn't loaded yet, the cURL
  // has obviously-blank fields the user has to fill in, instead of a
  // misleading dummy that ships out under a fake name.
  const sample = {
    invoked_by: {
      name: invokedBy?.name || '',
      email: invokedBy?.email || '',
    },
  }

  if (Array.isArray(schema) && schema.length > 0) {
    schema.forEach((f) => {
      const key = f?.name || f?.field
      if (!key) return
      if (f.example != null) {
        sample[key] = f.example
      } else if (f.type === 'number') {
        sample[key] = 0
      } else if (f.type === 'boolean') {
        sample[key] = false
      } else if (f.type === 'object') {
        sample[key] = {}
      } else {
        sample[key] = ''
      }
    })
  } else {
    sample.message = 'your input here'
  }

  const body = JSON.stringify(sample)
  const escapedBody = body.replace(/'/g, "'\\''")

  return [
    `curl --location '${url}' \\`,
    `--header 'Content-Type: application/json' \\`,
    `--data '${escapedBody}'`,
  ].join('\n')
}
