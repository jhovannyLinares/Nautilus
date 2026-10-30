import { describe, expect, it } from 'vitest'
import { buildSubfolders, childrenAt, inSubfolder, isDirectlyIn, pathTo, prefixesTo, type Subfolder } from '../../src/shared/subfolders'

/** El árbol como texto: una línea por subcarpeta, sangrada por nivel. */
function outline(subfolders: Subfolder[], depth = 0): string[] {
  return subfolders.flatMap((s) => [`${'  '.repeat(depth)}${s.label} ${s.total}`, ...outline(s.children, depth + 1)])
}

const URUGUAY = ['AZDO_PAT', 'DEV_CURRENCIES', 'DEV_INSIS_AMX', 'DEV_INSIS_CLAIM', 'DEV_INSIS_CLAIM_UF_RLS', 'DEV_INSIS_GEN_V10', 'DEV_INSIS_GEN_V10_RLS', 'DEV_INSIS_GEN_BLC_V10', 'DEV_INSIS_GEN_BLC_V10_RLS']

describe('subcarpetas por prefijo', () => {
  it('dos variables con el mismo prefijo ya son carpeta, a cualquier profundidad', () => {
    expect(outline(buildSubfolders(URUGUAY))).toEqual([
      'DEV 8',
      '  INSIS 7',
      '    CLAIM 2',
      '    GEN 4',
      '      BLC_V10 2',
      '      V10 2'
    ])
  })

  it('una variable suelta no hace carpeta', () => {
    expect(buildSubfolders(['AZDO_PAT', 'VALKIRIA_PASS', 'M365_PASS'])).toEqual([])
  })

  it('un nivel que solo contiene otra carpeta se junta con ella', () => {
    const mexico = buildSubfolders(['AZDO_PAT', 'DEV_INSIS_AMX', 'DEV_INSIS_BPMX', 'SIT_INSIS_CUST', 'SIT_INSIS_GEN_V10'])
    expect(outline(mexico)).toEqual(['DEV_INSIS 2', 'SIT_INSIS 2'])
    expect(mexico[0]!.prefix).toBe('DEV_INSIS')
  })

  it('la variable homónima cae dentro de su carpeta, y no confunde prefijos parecidos', () => {
    expect(inSubfolder('DEV_INSIS_CLAIM', 'DEV_INSIS_CLAIM')).toBe(true)
    expect(inSubfolder('DEV_INSIS_CLAIM_UF_RLS', 'DEV_INSIS_CLAIM')).toBe(true)
    expect(inSubfolder('DEV_INSIS_CLAIMX', 'DEV_INSIS_CLAIM')).toBe(false)
  })

  it('la ruta sale del árbol: dos niveles en Uruguay, uno juntado en México', () => {
    expect(pathTo(buildSubfolders(URUGUAY), 'DEV_INSIS_GEN_BLC_V10_RLS')).toEqual(['DEV', 'INSIS', 'GEN', 'BLC_V10'])
    expect(pathTo(buildSubfolders(['DEV_INSIS_AMX', 'DEV_INSIS_BPMX']), 'DEV_INSIS_AMX')).toEqual(['DEV_INSIS'])
    expect(pathTo(buildSubfolders(URUGUAY), 'AZDO_PAT')).toEqual([])
  })

  it('cada nivel muestra sus subcarpetas y solo sus variables sueltas, como un explorador', () => {
    const tree = buildSubfolders(URUGUAY)
    const level = (prefix: string | null) => {
      const children = childrenAt(tree, prefix)
      return { folders: children.map((c) => c.label), vars: URUGUAY.filter((short) => isDirectlyIn(short, prefix, children)) }
    }
    expect(level(null)).toEqual({ folders: ['DEV'], vars: ['AZDO_PAT'] })
    expect(level('DEV')).toEqual({ folders: ['INSIS'], vars: ['DEV_CURRENCIES'] })
    expect(level('DEV_INSIS')).toEqual({ folders: ['CLAIM', 'GEN'], vars: ['DEV_INSIS_AMX'] })
    expect(level('DEV_INSIS_CLAIM')).toEqual({ folders: [], vars: ['DEV_INSIS_CLAIM', 'DEV_INSIS_CLAIM_UF_RLS'] })
    expect(level('DEV_INSIS_GEN_BLC_V10').vars).toEqual(['DEV_INSIS_GEN_BLC_V10', 'DEV_INSIS_GEN_BLC_V10_RLS'])
  })

  it('al entrar en una subcarpeta se despliega todo el camino hasta ella', () => {
    expect(prefixesTo(buildSubfolders(URUGUAY), 'DEV_INSIS_GEN_BLC_V10')).toEqual(['DEV', 'DEV_INSIS', 'DEV_INSIS_GEN', 'DEV_INSIS_GEN_BLC_V10'])
  })
})
