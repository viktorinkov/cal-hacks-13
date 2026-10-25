import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { color, cssVar } from '@/lib/tokens'

describe('design tokens', () => {
  it('match between CSS and the PixiJS renderer', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    for (const [key, name] of Object.entries(cssVar)) {
      const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)
      expect(m, `${name} missing from index.css`).not.toBeNull()
      expect(m![1].toLowerCase()).toBe(color[key as keyof typeof color])
    }
  })
})
