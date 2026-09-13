import { describe, expect, it } from 'vitest'
import { assertPythonFreePayload } from '../src/installation/dst-package.js'

describe('formal player package runtime policy', () => {
  it.each(['app.py', 'runtime/python.exe', 'runtime/python313.dll', 'runtime/pythonw.exe', 'ChesterAI.exe', 'runtime/foo.pyd', 'runtime/base.pyz', '.venv/config', '__pycache__/foo.pyc', 'runtime/libpython3.11.so'])('rejects %s even when signed by the manifest', path => {
    expect(() => assertPythonFreePayload([path])).toThrow('Python')
  })
  it('retains Node, JS, Lua and game assets', () => {
    expect(() => assertPythonFreePayload(['runtime/node.exe', 'runtime/cli.js', 'modmain.lua', 'anim/jingling.zip'])).not.toThrow()
  })
})
