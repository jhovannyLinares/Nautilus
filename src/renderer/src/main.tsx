import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
// letra de la interfaz, empaquetada: la app no carga nada de internet
import '@fontsource/open-sans/latin-400.css'
import '@fontsource/open-sans/latin-600.css'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
