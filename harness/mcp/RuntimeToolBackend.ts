import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { HarnessDialogRequestSchema } from '../../src/shared/harnessDialog.types'
import type { HarnessRuntime } from '../runtime/HarnessRuntime'
import type { ToolBackend } from './ToolBackend'
import { allowedUiTools, generationSchema, runtimeTools } from './runtimeTools'

export class RuntimeToolBackend implements ToolBackend {
  private catalog: Promise<Tool[]> | undefined

  constructor(private readonly runtime: HarnessRuntime) {}

  async listTools(): Promise<Tool[]> {
    this.catalog ??= this.loadCatalog().catch((error: unknown) => {
      this.catalog = undefined
      throw error
    })
    return this.catalog
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CallToolResult> {
    try {
      if (signal?.aborted) throw new Error('CALL_CANCELLED')
      const definition = runtimeTools.find((tool) => tool.name === name)
      if (definition) {
        const parsed = definition.schema.parse(args)
        if ('runId' in parsed) {
          const status = this.runtime.status()
          if (status.runId !== parsed.runId || status.generation !== parsed.generation)
            throw new Error('STALE_GENERATION: read redencut_status before retrying')
        }
        switch (name) {
          case 'redencut_prepare_dialog':
            return jsonResult(
              await this.runtime.prepareDialog(
                HarnessDialogRequestSchema.parse('request' in parsed ? parsed.request : undefined),
                generationSchema.parse(parsed),
              ),
            )
          case 'redencut_start':
            return jsonResult(await this.runtime.start())
          case 'redencut_status':
            return jsonResult({
              ...this.runtime.status(),
              orphanedRuns: this.runtime.inspectOrphans(),
            })
          case 'redencut_restart':
            return jsonResult(
              await this.runtime.restart(parsed as { rebuild?: boolean; discardUnsaved?: boolean }),
            )
          case 'redencut_stop':
            return jsonResult(await this.runtime.stop(parsed as { discardUnsaved?: boolean }))
          case 'redencut_read_diagnostics':
            return jsonResult(await this.runtime.readDiagnostics(generationSchema.parse(parsed)))
          case 'redencut_list_artifacts':
            return jsonResult({
              runId: this.runtime.status().runId,
              runDirectory: this.runtime.status().runDirectory,
              artifacts: this.runtime.listArtifacts(),
            })
        }
      }
      if (!allowedUiTools.has(name)) throw new Error('TOOL_NOT_ALLOWED')
      const tool = (await this.listTools()).find((candidate) => candidate.name === name)
      if (!tool) throw new Error('TOOL_UNAVAILABLE_IN_PINNED_VERSION')
      const properties = tool.inputSchema.properties ?? {}
      for (const key of Object.keys(args)) {
        if (!Object.hasOwn(properties, key)) throw new Error(`UNSUPPORTED_ARGUMENT: ${key}`)
      }
      const identity = generationSchema.parse(args)
      const uiArgs = { ...args }
      delete uiArgs.runId
      delete uiArgs.generation
      return await this.runtime.callUiTool(name, uiArgs, identity, signal)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        isError: true,
        content: [{ type: 'text', text: message }],
        structuredContent: {
          error: { code: message.match(/^[A-Z_]+/)?.[0] ?? 'INVALID_REQUEST', message },
          status: this.runtime.status(),
          recovery:
            'Inspect redencut_status; do not automatically replay mutations. Use the current identity and a fresh browser_snapshot after restart.',
        },
      }
    }
  }

  private async loadCatalog(): Promise<Tool[]> {
    const ui = (await this.runtime.listUiTools())
      .filter((tool) => allowedUiTools.has(tool.name))
      .map((tool): Tool => {
        const properties = { ...tool.inputSchema.properties }
        delete properties.filename
        return {
          ...tool,
          description: `${tool.description ?? ''} RedenCut: requires current runId/generation and an initial full browser_snapshot. Prepare import/open/save/export dialog replies with redencut_prepare_dialog before clicking; dirty-project confirmation is unsupported. Generated files use the runtime-owned artifact directory.`,
          inputSchema: {
            ...tool.inputSchema,
            additionalProperties: false,
            properties: {
              ...properties,
              runId: { type: 'string', description: 'Current runId from redencut_start/status.' },
              generation: {
                type: 'integer',
                minimum: 1,
                description: 'Current application generation; changes on restart.',
              },
            },
            required: [
              ...(tool.inputSchema.required ?? []).filter((key) => key !== 'filename'),
              'runId',
              'generation',
            ],
          },
        }
      })
    return [
      ...runtimeTools.map((tool): Tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: z.toJSONSchema(tool.schema) as Tool['inputSchema'],
        annotations: {
          readOnlyHint: tool.readOnly,
          destructiveHint: !tool.readOnly,
          openWorldHint: false,
        },
      })),
      ...ui,
    ]
  }
}

function jsonResult(value: object): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
  }
}
