import { homedir } from 'node:os'

// V8 uses a shared accessor for lazily generated Error stacks. Never trust function source text.
const builtinStackGetter = Object.getOwnPropertyDescriptor(new Error(), 'stack')?.get

export interface SanitizerOptions {
  home?: string
  secrets?: string[]
}
export class LogSanitizer {
  private readonly home: string
  private readonly secrets: string[]
  constructor(options: SanitizerOptions = {}) {
    this.home = options.home ?? homedir()
    this.secrets = (options.secrets ?? []).filter((s) => s.length >= 4)
  }
  text(input: string): string {
    let text = input.slice(0, 32768)
    text = text
      .replace(/\b(Bearer\s+)[\w.+/=:-]+/gi, '$1[redacted]')
      .replace(/\b((?:hf_|gh[pousr]_)[A-Za-z0-9_-]{8,})\b/g, '[redacted]')
      .replace(
        /((?:token|secret|password|authorization|api[_-]?key)\s*[=:]\s*["']?)[^\s,"';}\]]+/gi,
        '$1[redacted]',
      )
      .replace(/https?:\/\/[^\s/]+:[^\s@]+@/gi, 'https://[redacted]@')
    for (const secret of this.secrets) text = text.split(secret).join('[redacted]')
    // Preserve package-relative stack locations without exposing installation paths.
    text = text.replace(/(?:[A-Za-z]:[\\/]|\/)[^\s()"']*?[\\/]node_modules[\\/]/g, 'node_modules/')
    if (this.home) text = text.split(this.home).join('[home]')
    return text
      .replace(
        /(?:\[home\]|\/(?:Users|home|private|tmp|var|Volumes|workspace|source|opt|etc)\/)[^\s()"'<>]*/g,
        '[path]',
      )
      .replace(/[A-Za-z]:[\\/][^\s()"'<>]*/g, '[path]')
  }
  error(error: unknown): { message: string; stack?: string } {
    if (!(error instanceof Error))
      return { message: typeof error === 'string' ? this.text(error) : 'Unknown error' }
    const parts: string[] = []
    const stacks: string[] = []
    let current: unknown = error
    const seen = new Set<unknown>()
    for (let depth = 0; current instanceof Error && depth < 4 && !seen.has(current); depth++) {
      seen.add(current)
      const message = Object.getOwnPropertyDescriptor(current, 'message')?.value
      const descriptor = Object.getOwnPropertyDescriptor(current, 'stack')
      const stack =
        descriptor?.value ??
        (descriptor?.get && descriptor.get === builtinStackGetter
          ? descriptor.get.call(current)
          : undefined)
      if (typeof message === 'string') parts.push(this.text(message))
      if (typeof stack === 'string') stacks.push(this.text(stack))
      current = Object.getOwnPropertyDescriptor(current, 'cause')?.value
    }
    return {
      message: parts.join(' | '),
      ...(stacks.length ? { stack: stacks.join('\nCaused by:\n').slice(0, 16384) } : {}),
    }
  }
}
