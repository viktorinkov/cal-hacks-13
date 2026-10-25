import { expect, test } from '@playwright/test'

/**
 * The full simulated demonstration, through the real interface:
 * venue → congestion → SOS → camera evidence → acknowledge → preview corridor → approve →
 * band acknowledgements → resolve → reset.
 */
test('the simulated SOS flow runs end to end', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')

  const h1 = page.getByRole('heading', { level: 1 })
  await expect(h1).toHaveText('All quiet.')
  await page.getByRole('button', { name: 'Venue', exact: true }).click()
  await page.getByRole('option', { name: 'Simulation' }).click()
  await expect(page.getByText('Simulation', { exact: true }).first()).toBeVisible()
  // the map really rendered (the CalHacks hall mesh adds a second, hidden canvas)
  await expect(page.locator('canvas')).not.toHaveCount(0)

  const story = page.getByRole('list', { name: 'Story' })
  await story.getByRole('button', { name: 'Surge' }).click()
  await expect(h1).toHaveText(/Getting tight|is packed/, { timeout: 45_000 })

  await story.getByRole('button', { name: 'SOS' }).click()
  await expect(h1).toHaveText('Someone pressed SOS.')
  const panel = page.locator('section', { has: page.getByRole('heading', { level: 2, name: 'SOS pressed' }) })
  await expect(panel.getByText('Needs a person', { exact: true })).toBeVisible()
  await expect(panel.getByText(/Flash pattern matched/)).toBeVisible()
  await expect(panel.getByText('Simulated frame')).toBeVisible()

  await panel.getByRole('button', { name: 'Acknowledge' }).click()
  await expect(panel.getByText('Acknowledged', { exact: true })).toBeVisible()
  await expect(panel.getByText('Path for First Aid, preview')).toBeVisible()

  await panel.getByRole('button', { name: /Clear the path · signal ~?\d+ bands/ }).click()
  await expect(panel.getByText('Responding', { exact: true })).toBeVisible()
  await expect(panel.getByText(/^(\d+) of \1 demo bands confirmed$/)).toBeVisible()
  await expect(h1).toHaveText('A path is open.')
  await expect(page.getByRole('heading', { name: 'With the bands, and without' })).toBeVisible()

  await panel.getByRole('button', { name: 'Resolve', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: /Resolve INC-/ }).click()
  await expect(panel.getByText('Resolved', { exact: true })).toBeVisible()
  // live congestion, if any, outranks a closed incident in the headline
  await expect(h1).toHaveText(/^(Resolved\.|Getting tight at .+\.|.+ is packed\.)$/)

  await page.getByRole('button', { name: 'Reset the simulation' }).click()
  await expect(h1).toHaveText('All quiet.')
  expect(errors).toEqual([])
})
