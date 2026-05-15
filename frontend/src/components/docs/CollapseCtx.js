import { createContext } from 'react'

// Tab-scoped collapse state. ApiReferenceTab provides this; Section + Endpoint
// read it. When the context is null (User Guide / Admin Guide), components
// render uncollapsible (always-expanded) just like before.
//
// Shape: { isOpen: (id) => boolean, toggle: (id) => void }
export const CollapseCtx = createContext(null)
