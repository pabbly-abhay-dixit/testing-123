import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { ThemeProvider } from './context/ThemeContext'
import { AuthProvider } from './context/AuthContext'
import { AgentsProvider } from './context/AgentsContext'
import { EntitlementsProvider } from './context/EntitlementsContext'
import { ConfirmProvider } from './components/ui/ConfirmModal'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <EntitlementsProvider>
          <AgentsProvider>
          <ConfirmProvider>
          <App />
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 3000,
              style: { fontSize: '14px' },
            }}
          />
        </ConfirmProvider>
        </AgentsProvider>
        </EntitlementsProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
