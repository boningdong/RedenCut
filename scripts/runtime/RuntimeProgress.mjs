const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function createRuntimeProgress({ stream = process.stderr } = {}) {
  let timer
  let frame = 0
  let status
  let previousLine
  const started = Date.now()
  const clear = () => {
    if (stream.isTTY) stream.write('\r\x1b[2K')
  }
  const render = () => {
    const percent =
      Number.isFinite(status.total) && status.total > 0 && Number.isFinite(status.completed)
        ? Math.min(100, Math.max(0, Math.floor((status.completed / status.total) * 100)))
        : undefined
    const label = status.label.replace(/[\x00-\x1f\x7f]/g, ' ')
    if (stream.isTTY) {
      const line = `${frames[frame++ % frames.length]} ${label}${percent === undefined ? '' : ` · ${percent}%`} · ${Math.floor((Date.now() - started) / 1000)}s`
      stream.write(`\r\x1b[2K${line.slice(0, Math.max(1, (stream.columns || 100) - 1))}`)
    } else {
      const line = `${label}${percent === undefined ? '' : ` · ${Math.floor(percent / 10) * 10}%`}`
      if (line !== previousLine) stream.write(`${line}\n`)
      previousLine = line
    }
  }
  const pause = () => {
    clearInterval(timer)
    timer = undefined
    clear()
  }
  return {
    update(next) {
      const changedStage = status?.label !== next.label
      status = next
      if (!stream.isTTY || changedStage || !timer) render()
      if (stream.isTTY && !timer) {
        timer = setInterval(render, 80)
        timer.unref()
      }
    },
    pause,
    finish(message, success = true) {
      pause()
      stream.write(`${success ? '✓' : '✗'} ${message}\n`)
    },
  }
}
