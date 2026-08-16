export interface SessionLoadCoordinator<Input> {
  load(input: Input): Promise<boolean>
  invalidate(): void
}

export function createSessionLoadCoordinator<Input, Prepared>(
  prepare: (input: Input) => Promise<Prepared>,
  commit: (input: Input, prepared: Prepared) => void,
  destroy: (prepared: Prepared) => void,
): SessionLoadCoordinator<Input> {
  let epoch = 0
  return {
    async load(input) {
      const loadEpoch = ++epoch
      let prepared: Prepared
      try {
        prepared = await prepare(input)
      } catch (error) {
        if (loadEpoch !== epoch) return false
        throw error
      }
      if (loadEpoch !== epoch) {
        destroy(prepared)
        return false
      }
      commit(input, prepared)
      return true
    },
    invalidate() {
      epoch += 1
    },
  }
}
