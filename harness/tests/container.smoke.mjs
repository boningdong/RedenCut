import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { EofOnlyTransport } from './fixtures/EofOnlyTransport.mjs'

for (const shutdown of ['EOF', 'docker stop']) {
  test(
    `host MCP controls container Electron and ${shutdown} cleans up while retaining evidence`,
    { timeout: 180_000 },
    async () => {
      const name = `redencut-smoke-${randomUUID()}`
      const transport = new EofOnlyTransport('sh', [resolve('harness/container/run.sh')], {
        ...process.env,
        REDENCUT_CONTAINER_NAME: name,
      })
      const client = new Client({ name: 'redencut-container-acceptance', version: '1.0.0' })
      let runId
      const call = async (name, args = {}) => {
        const result = await client.callTool({ name, arguments: args }, undefined, {
          timeout: 90_000,
        })
        assert.ok(!result.isError, JSON.stringify(result.content))
        return result
      }
      try {
        await client.connect(transport)
        const catalog = await client.listTools()
        assert.ok(catalog.tools.some((tool) => tool.name === 'redencut_start'))
        const started = (await call('redencut_start')).structuredContent
        assert.equal(started.state, 'ready')
        const container = JSON.parse(
          execFileSync('docker', ['inspect', name], { encoding: 'utf8' }),
        )[0]
        assert.equal(container.Config.User, 'node')
        assert.equal(container.Mounts.find((mount) => mount.Destination === '/source').RW, false)
        const gitDirectory = execFileSync(
          'git',
          ['rev-parse', '--path-format=absolute', '--git-common-dir'],
          { encoding: 'utf8' },
        ).trim()
        assert.equal(container.Mounts.find((mount) => mount.Destination === gitDirectory).RW, false)
        const artifacts = container.Mounts.find(
          (mount) => mount.Destination === '/workspace/.harness-runs',
        )
        assert.equal(artifacts.Type, 'bind')
        assert.equal(artifacts.Source, resolve('.harness-runs/container'))
        assert.equal(artifacts.RW, true)
        assert.equal(
          container.Mounts.find((mount) => mount.Destination === '/workspace/node_modules').Type,
          'volume',
        )
        assert.equal(
          container.Mounts.find((mount) => mount.Destination === '/workspace/out').Type,
          'volume',
        )
        assert.equal(container.HostConfig.Privileged, false)
        assert.equal(Object.keys(container.HostConfig.PortBindings ?? {}).length, 0)
        runId = started.runId
        let identity = { runId, generation: started.generation }
        await call('browser_snapshot', identity)
        await call('browser_click', { ...identity, target: 'button:text-is("Set up later")' })
        const snapshot = await call('browser_snapshot', identity)
        assert.match(JSON.stringify(snapshot.content), /Add Track/)
        await call('browser_click', {
          ...identity,
          target: 'button[aria-label="Settings"]',
        })
        const screen = await call('browser_take_screenshot', { ...identity, type: 'png' })
        const png = screen.content.find((item) => item.type === 'image')
        assert.equal(png?.mimeType, 'image/png')
        const bytes = Buffer.from(png.data, 'base64')
        assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
        await writeFile(resolve('.harness-runs/container', runId, 'host-received.png'), bytes)
        const restarted = (await call('redencut_restart', { ...identity, rebuild: true }))
          .structuredContent
        assert.equal(restarted.generation, started.generation + 1)
        identity = { runId, generation: restarted.generation }
        await call('browser_snapshot', identity)
        // Neither path uses redencut_stop: both must reach the server shutdown handler.
        if (shutdown === 'docker stop') {
          execFileSync('docker', ['stop', '--time', '20', name], { stdio: 'pipe', timeout: 30_000 })
        }
        await client.close()
        assert.deepEqual(transport.exitResult, { code: 0, signal: null })
        const manifest = JSON.parse(
          await readFile(resolve('.harness-runs/container', runId, 'manifest.json'), 'utf8'),
        )
        assert.equal(manifest.status.state, 'stopped')
        for (const generation of [1, 2]) {
          const directory = resolve('.harness-runs/container', runId, `generation-${generation}`)
          const events = (await readFile(join(directory, 'events.jsonl'), 'utf8'))
            .trim()
            .split('\n')
            .map(JSON.parse)
          assert.ok(
            events.some(
              (event) =>
                event.kind === 'process-exit' &&
                event.data.code === 0 &&
                event.data.signal === null,
            ),
          )
          assert.ok(!events.some((event) => event.kind === 'forced-close'))
        }
        assert.equal(
          execFileSync('docker', ['ps', '-aq', '--filter', `name=^/${name}$`], {
            encoding: 'utf8',
          }).trim(),
          '',
        )
        console.log(`Container evidence: ${resolve('.harness-runs/container', runId)}`)
      } catch (error) {
        console.error(transport.stderr)
        throw error
      } finally {
        try {
          await client.close()
        } finally {
          // Target only this test's UUID-named container if assertion/transport cleanup failed.
          const remaining = execFileSync('docker', ['ps', '-aq', '--filter', `name=^/${name}$`], {
            encoding: 'utf8',
          }).trim()
          if (remaining) execFileSync('docker', ['stop', '--time', '20', name], { stdio: 'pipe' })
        }
      }
    },
  )
}
