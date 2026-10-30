// texto incrustado en el bundle con el sufijo ?raw de Vite (lo usa el skill de Claude Code)
declare module '*?raw' {
  const content: string
  export default content
}
