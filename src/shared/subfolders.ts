/** Subcarpetas que salen solas de los nombres: no se guardan, se recalculan con cada lista de variables. */

/** Un prefijo compartido por al menos esta cantidad de variables es subcarpeta. */
const MIN_SHARED = 2
const SEPARATOR = '_'

export interface Subfolder {
  /** Lo que muestra el árbol: un segmento, o varios unidos si el nivel solo contenía otra carpeta (`DEV_INSIS`). */
  label: string
  /** El prefijo completo del nombre corto (`DEV_INSIS`): identifica la subcarpeta dentro de su carpeta. */
  prefix: string
  /** Variables cuyo nombre corto es el prefijo o empieza con él. */
  total: number
  children: Subfolder[]
}

export function buildSubfolders(shorts: string[]): Subfolder[] {
  return build(shorts.map((short) => short.split(SEPARATOR)), [])
}

/** Si el nombre corto cae en esa subcarpeta: es el prefijo mismo o empieza con él. */
export function inSubfolder(short: string, prefix: string): boolean {
  return short === prefix || short.startsWith(prefix + SEPARATOR)
}

/** Las etiquetas desde la raíz hasta la subcarpeta más profunda que contiene el nombre (`['DEV', 'INSIS']`). */
export function pathTo(subfolders: Subfolder[], short: string): string[] {
  const match = subfolders.find((subfolder) => inSubfolder(short, subfolder.prefix))
  if (!match) return []
  return [match.label, ...pathTo(match.children, short)]
}

/** Las subcarpetas que cuelgan directo de un nivel: la carpeta (`null`) o una subcarpeta por su prefijo. */
export function childrenAt(subfolders: Subfolder[], prefix: string | null): Subfolder[] {
  if (prefix === null) return subfolders
  const container = subfolders.find((subfolder) => inSubfolder(prefix, subfolder.prefix))
  if (!container) return []
  if (container.prefix === prefix) return container.children
  return childrenAt(container.children, prefix)
}

/** Si la variable está suelta en ese nivel, y no dentro de una de sus subcarpetas (como en un explorador). */
export function isDirectlyIn(short: string, prefix: string | null, children: Subfolder[]): boolean {
  const insideLevel = prefix === null || inSubfolder(short, prefix)
  const insideChild = children.some((child) => inSubfolder(short, child.prefix))
  return insideLevel && !insideChild
}

/** Los prefijos de cada subcarpeta desde la raíz hasta la que tiene ese prefijo: se despliegan al entrar en ella. */
export function prefixesTo(subfolders: Subfolder[], prefix: string): string[] {
  const container = subfolders.find((subfolder) => inSubfolder(prefix, subfolder.prefix))
  if (!container) return []
  return [container.prefix, ...(container.prefix === prefix ? [] : prefixesTo(container.children, prefix))]
}

function build(names: string[][], parentSegments: string[]): Subfolder[] {
  const groups = new Map<string, string[][]>()
  for (const parts of names) {
    const [first, ...rest] = parts
    if (first === undefined) continue
    groups.set(first, [...(groups.get(first) ?? []), rest])
  }
  const subfolders: Subfolder[] = []
  for (const [segment, rests] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (rests.length < MIN_SHARED) continue
    const segments = [...parentSegments, segment]
    const children = build(rests.filter((rest) => rest.length > 0), segments)
    subfolders.push(mergeOnlyChild({ label: segment, prefix: segments.join(SEPARATOR), total: rests.length, children }))
  }
  return subfolders
}

/** Un nivel que solo contiene otra carpeta (ni variables propias ni sueltas) se junta con ella: un clic menos. */
function mergeOnlyChild(subfolder: Subfolder): Subfolder {
  const [onlyChild] = subfolder.children
  const holdsOnlyThatChild = subfolder.children.length === 1 && onlyChild!.total === subfolder.total
  if (!holdsOnlyThatChild) return subfolder
  return { ...onlyChild!, label: subfolder.label + SEPARATOR + onlyChild!.label }
}
