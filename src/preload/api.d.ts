export {}

declare global {
  interface Window {
    api: {
      invoke: (channel: string, payload: unknown) => Promise<unknown>
      pathForFile: (file: File) => string
      onEvent: (cb: (event: unknown) => void) => () => void
    }
  }
}
