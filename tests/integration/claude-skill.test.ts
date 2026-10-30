import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { ClaudeSkill } from '../../src/backend/claude-skill'

const TEMPLATE = '---\nname: nautilus\n---\n<!-- nautilus-skill {{VERSION}} -->\nCuerpo\n'
const SCRIPT = '# <!-- nautilus-skill {{VERSION}} -->\nparam()\n'
let home: string

function skill(version = '0.1.0'): ClaudeSkill {
  return new ClaudeSkill({ homeDir: home, template: TEMPLATE, importScript: SCRIPT, version })
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'nautilus-claude-'))
})

describe('skill de Claude Code', () => {
  it('encendido: lo escribe en .claude/skills/nautilus con la versión', () => {
    const s = skill()
    s.sync(true)
    expect(s.file).toBe(join(home, '.claude', 'skills', 'nautilus', 'SKILL.md'))
    expect(readFileSync(s.file, 'utf8')).toContain('<!-- nautilus-skill 0.1.0 -->')
    expect(readFileSync(s.scriptFile, 'utf8')).toContain('<!-- nautilus-skill 0.1.0 -->')
  })

  it('no escribe nada si el script de importar existe y es ajeno', () => {
    const s = skill()
    mkdirSync(dirname(s.scriptFile), { recursive: true })
    writeFileSync(s.scriptFile, 'script propio del usuario')
    expect(() => s.sync(true)).toThrow('no lo escribió Nautilus')
    expect(existsSync(s.file)).toBe(false)
    expect(readFileSync(s.scriptFile, 'utf8')).toBe('script propio del usuario')
  })

  it('una versión nueva reemplaza la anterior', () => {
    skill('0.1.0').sync(true)
    const updated = skill('0.2.0')
    updated.sync(true)
    expect(readFileSync(updated.file, 'utf8')).toContain('nautilus-skill 0.2.0')
  })

  it('no pisa un SKILL.md que no lleva su marca', () => {
    const s = skill()
    mkdirSync(dirname(s.file), { recursive: true })
    writeFileSync(s.file, 'skill propio del usuario')
    expect(() => s.sync(true)).toThrow('no lo escribió Nautilus')
    s.sync(false)
    expect(readFileSync(s.file, 'utf8')).toBe('skill propio del usuario')
  })

  it('apagado: borra los dos archivos y la carpeta vacía', () => {
    const s = skill()
    s.sync(true)
    s.sync(false)
    expect(existsSync(s.file)).toBe(false)
    expect(existsSync(s.scriptFile)).toBe(false)
    expect(existsSync(dirname(s.file))).toBe(false)
    expect(existsSync(join(home, '.claude', 'skills'))).toBe(true)
  })

  it('apagado: conserva la carpeta si tiene otros archivos', () => {
    const s = skill()
    s.sync(true)
    writeFileSync(join(dirname(s.file), 'notas.md'), 'del usuario')
    s.sync(false)
    expect(existsSync(s.file)).toBe(false)
    expect(existsSync(join(dirname(s.file), 'notas.md'))).toBe(true)
  })

  it('estado: apagado, listo sin Claude instalado, conectado con .claude.json', () => {
    const s = skill()
    expect(s.state(false)).toBe('off')
    s.sync(true)
    expect(s.state(true)).toBe('noclaude')
    writeFileSync(join(home, '.claude.json'), '{}')
    expect(s.state(true)).toBe('on')
  })
})
