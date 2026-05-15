import { createContext, useContext, useState, useEffect } from 'react'

const ThemeContext = createContext()
const THEME_KEY = 'pabbly-agent-theme'
const ACCENT_KEY = 'pabbly-agent-accent-color'

// Pabbly green is the brand default
export const DEFAULT_ACCENT = '#059669'

export const ACCENT_PRESETS = [
  { id: 'pabbly',   hex: '#059669', label: 'Pabbly Green' },
  { id: 'emerald',  hex: '#10B981', label: 'Emerald' },
  { id: 'teal',     hex: '#0D9488', label: 'Teal' },
  { id: 'cyan',     hex: '#0891B2', label: 'Cyan' },
  { id: 'blue',     hex: '#1B5FDB', label: 'Blue' },
  { id: 'indigo',   hex: '#4F46E5', label: 'Indigo' },
  { id: 'violet',   hex: '#7C3AED', label: 'Violet' },
  { id: 'purple',   hex: '#9333EA', label: 'Purple' },
  { id: 'pink',     hex: '#DB2777', label: 'Pink' },
  { id: 'rose',     hex: '#E11D48', label: 'Rose' },
  { id: 'red',      hex: '#DC2626', label: 'Red' },
  { id: 'orange',   hex: '#EA580C', label: 'Orange' },
  { id: 'amber',    hex: '#D97706', label: 'Amber' },
  { id: 'slate',    hex: '#475569', label: 'Slate' },
]

// --- Palette generation (HSL) ---

function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h, s, l = (max + min) / 2
  if (max === min) {
    h = s = 0
  } else {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      case b: h = ((r - g) / d + 4) / 6; break
    }
  }
  return [h * 360, s * 100, l * 100]
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = (n) => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * Math.max(0, Math.min(255, color * 255))) / 255
    // fix: clamp properly
  }
  const toHex = (n) => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * Math.max(0, Math.min(1, color))).toString(16).padStart(2, '0')
  }
  return `#${toHex(0)}${toHex(8)}${toHex(4)}`
}

// Attempt to clamp a value between min and max
function clamp(v, min, max) { return Math.min(Math.max(v, min), max) }

// Attempt to interpolate between two values
function lerp(a, b, t) { return a + (b - a) * t }

/**
 * Generate a 10-shade palette from a single base color.
 * The base color is used as shade-500. Lighter shades (50–400) are
 * interpolated toward white; darker shades (600–900) toward black.
 * Saturation is gently reduced at the extremes so pastels and darks
 * look natural instead of garish.
 */
function generatePalette(hex) {
  const [h, s, baseL] = hexToHsl(hex)

  // Lightness anchors — the base color sits at shade 500.
  // We interpolate linearly between (lightest, base) for 50-400
  // and between (base, darkest) for 600-900.
  const lightEnd = 97   // shade 50 target
  const darkEnd  = 10   // shade 900 target

  // Position of each shade on the 50→900 scale (0 = lightest, 1 = darkest)
  const shadeMap = [
    [50,  0.00],
    [100, 0.10],
    [200, 0.25],
    [300, 0.40],
    [400, 0.65],
    [500, 1.00],   // base
    [600, 1.20],
    [700, 1.45],
    [800, 1.70],
    [900, 1.95],
  ]

  const result = {}
  for (const [shade, t] of shadeMap) {
    let l, sat
    if (t <= 1.0) {
      // 50–500: interpolate from lightEnd toward baseL
      l = lerp(lightEnd, baseL, t)
      // Reduce saturation for very light shades so they stay pastel
      sat = lerp(s * 0.25, s, t * t)
    } else {
      // 600–900: interpolate from baseL toward darkEnd
      const dt = (t - 1.0) / 0.95  // normalize 1.0→1.95 to 0→1
      l = lerp(baseL, darkEnd, dt)
      // Slightly reduce saturation in the darkest shades
      sat = lerp(s, s * 0.7, dt * dt)
    }
    result[shade] = hslToHex(h, clamp(sat, 0, 100), clamp(l, 0, 100))
  }
  return result
}

function applyAccentColor(hex) {
  const palette = generatePalette(hex)
  const root = document.documentElement
  for (const [shade, color] of Object.entries(palette)) {
    root.style.setProperty(`--color-primary-${shade}`, color)
  }
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    return localStorage.getItem(THEME_KEY) || 'light'
  })

  const [accentColor, setAccentColorState] = useState(() => {
    return localStorage.getItem(ACCENT_KEY) || DEFAULT_ACCENT
  })

  const getSystemTheme = () =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

  const isDark = theme === 'dark' || (theme === 'system' && getSystemTheme() === 'dark')

  // Apply dark class to <html> and persist
  useEffect(() => {
    const root = document.documentElement
    const apply = () => {
      const effective = theme === 'system' ? getSystemTheme() : theme
      if (effective === 'dark') {
        root.classList.add('dark')
      } else {
        root.classList.remove('dark')
      }
    }
    apply()
    localStorage.setItem(THEME_KEY, theme)

    // Listen for system preference changes when in system mode
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = () => apply()
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }
  }, [theme])

  // Apply accent color and persist
  useEffect(() => {
    applyAccentColor(accentColor)
    localStorage.setItem(ACCENT_KEY, accentColor)
  }, [accentColor])

  const setTheme = (t) => setThemeState(t)
  const toggleTheme = () => setThemeState(prev => prev === 'dark' ? 'light' : 'dark')
  const setAccentColor = (hex) => setAccentColorState(hex)

  return (
    <ThemeContext.Provider value={{
      theme, isDark, setTheme, toggleTheme,
      accentColor, setAccentColor,
    }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
