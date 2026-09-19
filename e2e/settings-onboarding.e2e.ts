import { expect, test } from 'vitest'
import { McpTestSession } from './support/McpTestSession'

test('first-run preparation is optional and settings persist appearance and feature choices', async () => {
  const ui = new McpTestSession()
  try {
    await ui.start({ keepOnboarding: true })
    await expect
      .poll(() =>
        ui.page.getByRole('heading', { name: 'Welcome to RedenCut', exact: true }).count(),
      )
      .toBe(1)
    await ui.screenshot('welcome')
    await ui.call('browser_click', { target: 'button[aria-label="Light"]' })
    await ui.call('browser_click', { target: 'button:text-is("Continue")' })
    await expect
      .poll(() => ui.page.getByRole('switch', { name: 'Text editing', exact: true }).isChecked())
      .toBe(true)
    expect(
      await ui.page.getByRole('switch', { name: 'Speaker recognition', exact: true }).isChecked(),
    ).toBe(true)
    expect(await ui.page.getByRole('button', { name: 'Verify access', exact: true }).count()).toBe(
      0,
    )
    await ui.screenshot('preparation')
    await ui.call('browser_click', { target: 'button:text-is("Skip for now")' })
    await ui.call('browser_click', { target: 'button[aria-label="Settings"]' })
    await expect
      .poll(() => ui.page.getByRole('heading', { name: 'General', exact: true }).count())
      .toBe(1)
    await ui.call('browser_click', { target: 'button[data-value="resources"]' })
    await expect
      .poll(
        () => ui.page.getByRole('switch', { name: 'Speaker recognition', exact: true }).isEnabled(),
        { timeout: 70_000 },
      )
      .toBe(true)
    await ui.call('browser_click', { target: 'input[aria-label="Speaker recognition"]' })
    await expect
      .poll(() =>
        ui.page.getByRole('switch', { name: 'Speaker recognition', exact: true }).isChecked(),
      )
      .toBe(false)
    await ui.screenshot('settings-resources')
    await ui.call('browser_click', { target: 'button[aria-label="Close"]' })
    await ui.restart()
    expect(
      await ui.page.getByRole('heading', { name: 'Welcome to RedenCut', exact: true }).count(),
    ).toBe(0)
    await ui.call('browser_click', { target: 'button[aria-label="Settings"]' })
    await ui.call('browser_click', { target: 'button[data-value="theme"]' })
    await expect
      .poll(() =>
        ui.page.getByRole('button', { name: 'Light', exact: true }).getAttribute('aria-pressed'),
      )
      .toBe('true')
    await ui.call('browser_click', { target: 'button[data-value="resources"]' })
    expect(
      await ui.page.getByRole('switch', { name: 'Speaker recognition', exact: true }).isChecked(),
    ).toBe(false)
    await ui.screenshot('settings-restarted')
  } finally {
    await ui.close()
  }
})

test.each(['sample', 'empty'] as const)(
  'onboarding starts a %s project without speech downloads',
  async (kind) => {
    const ui = new McpTestSession()
    try {
      await ui.start({ keepOnboarding: true })
      await ui.call('browser_click', { target: 'button:text-is("Continue")' })
      await expect
        .poll(
          () => ui.page.getByRole('switch', { name: 'Text editing', exact: true }).isEnabled(),
          { timeout: 70_000 },
        )
        .toBe(true)
      await ui.call('browser_click', { target: 'input[aria-label="Text editing"]' })
      await expect
        .poll(() => ui.page.getByRole('button', { name: 'Continue', exact: true }).isEnabled())
        .toBe(true)
      await ui.call('browser_click', { target: 'button:text-is("Continue")' })
      await ui.call('browser_click', {
        target:
          kind === 'sample'
            ? 'button:has-text("Explore a sample")'
            : 'button:has-text("Start an empty project")',
      })
      await expect.poll(() => ui.page.locator('dialog[open]').count(), { timeout: 30000 }).toBe(0)
      await expect
        .poll(() => ui.page.locator('.waveform-clip canvas').count(), { timeout: 30000 })
        .toBe(kind === 'sample' ? 1 : 0)
      await ui.screenshot(`started-${kind}`)
      await ui.restart()
      expect(
        await ui.page.getByRole('heading', { name: 'Welcome to RedenCut', exact: true }).count(),
      ).toBe(0)
    } finally {
      await ui.close()
    }
  },
)

test('development setup explains missing runtime and validates without starting downloads', async () => {
  const ui = new McpTestSession()
  try {
    await ui.start({ keepOnboarding: true, missingRuntime: true })
    await ui.call('browser_click', { target: 'button:text-is("Continue")' })
    await expect
      .poll(() => ui.page.getByText('Runtime', { exact: true }).count(), {
        timeout: 70000,
      })
      .toBe(1)
    await expect
      .poll(() => ui.page.getByRole('button', { name: 'Download', exact: true }).isDisabled())
      .toBe(true)
    await ui.call('browser_snapshot')
    await ui.call('browser_click', {
      target: '.dev-block:nth-child(2) button:text-is("Install guide")',
    })
    expect(await ui.page.getByText('npm run runtime:setup', { exact: true }).count()).toBe(1)
    await ui.screenshot('development-install-guide')
    await ui.call('browser_click', { target: '.dev-block:nth-child(2) button:text-is("Validate")' })
    await expect
      .poll(() => ui.page.getByRole('button', { name: 'Validate', exact: true }).count(), {
        timeout: 70000,
      })
      .toBe(2)
    expect(await ui.page.getByRole('button', { name: 'Download', exact: true }).isDisabled()).toBe(
      true,
    )
    await ui.call('browser_click', { target: '.dev-summary' })
    expect(await ui.page.getByText(/Prepare the tools needed by each model above/).count()).toBe(1)
    await ui.screenshot('development-models-locked')
    await ui.call('browser_click', { target: '.section-disclosure' })
    expect(
      await ui.page
        .getByRole('button', { name: 'Text editing', exact: true })
        .getAttribute('aria-expanded'),
    ).toBe('false')
    expect(await ui.page.getByRole('button', { name: 'Download', exact: true }).isVisible()).toBe(
      false,
    )
    expect(
      await ui.page.getByRole('switch', { name: 'Text editing', exact: true }).isChecked(),
    ).toBe(true)
    const developmentHeader = ui.page.locator('.dev-summary')
    const textHeader = ui.page.locator('.text-resource > .resource-heading')
    const textDisclosure = ui.page.locator('.section-disclosure')
    await developmentHeader.hover()
    const developmentHover = await developmentHeader.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    )
    await textDisclosure.hover()
    await expect
      .poll(() => textHeader.evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe(developmentHover)
    await ui.screenshot('resource-header-hover')
    await textDisclosure.focus()
    await ui.page.keyboard.press('Tab')
    expect(
      await ui.page
        .getByRole('switch', { name: 'Text editing', exact: true })
        .evaluate((element) => element === document.activeElement),
    ).toBe(true)
    await ui.page.keyboard.press('Shift+Tab')
    await ui.screenshot('resource-header-keyboard-focus')
    await ui.screenshot('resource-sections-collapsed')
    await ui.call('browser_click', { target: '.section-disclosure' })
    expect(await ui.page.getByRole('button', { name: 'Download', exact: true }).isDisabled()).toBe(
      true,
    )
    await ui.call('browser_click', { target: 'button:text-is("Skip for now")' })
    await ui.call('browser_click', { target: 'button[aria-label="Settings"]' })
    await ui.call('browser_click', { target: 'button[data-value="resources"]' })
    expect(await ui.page.getByText('Runtime', { exact: true }).count()).toBe(1)
  } finally {
    await ui.close()
  }
})
