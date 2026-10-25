import { describe, expect, it } from 'vitest'
import { panelInset } from '@/components/dashboard/panelInsets'

describe('map panel insets', () => {
  const viewport = { left: 100, right: 1300, top: 64, bottom: 864 }

  it('measures controls relative to the map below the shared header', () => {
    expect(panelInset('top', { left: 100, right: 1300, top: 80, bottom: 160 }, viewport)).toBe(104)
    expect(panelInset('bottom', { left: 100, right: 800, top: 790, bottom: 850 }, viewport)).toBe(82)
  })

  it('reserves only the docked controls within the map bounds', () => {
    expect(panelInset('left', { left: 112, right: 160, top: 200, bottom: 600 }, viewport)).toBe(76)
    expect(panelInset('right', { left: 928, right: 1288, top: 180, bottom: 850 }, viewport)).toBe(388)
    expect(panelInset('right', { left: 1248, right: 1288, top: 180, bottom: 220 }, viewport)).toBe(68)
  })

  it('never emits a negative inset for an offscreen panel', () => {
    expect(panelInset('left', { left: 0, right: 20, top: 0, bottom: 20 }, viewport)).toBe(0)
  })
})
