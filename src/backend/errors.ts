/** Error con código y mensaje en español para la interfaz. Nunca lleva un valor secreto. */
export class VaultError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}
