export interface SessionLoadCoordinator<Input> {
  load(input: Input): Promise<boolean>
  invalidate(): Promise<void>
}

export function createSessionLoadCoordinator<Input, Prepared>(
  prepare: (input: Input) => Promise<Prepared>,
  commit: (input: Input, prepared: Prepared) => void | Promise<void>,
  destroy: (prepared: Prepared) => void | Promise<void>,
): SessionLoadCoordinator<Input> {
  let epoch = 0
  const activeLoads = new Set<Promise<boolean>>()
  const runLoad = async (input: Input): Promise<boolean> => {
    const loadEpoch = ++epoch
    let prepared: Prepared
    try {
      prepared = await prepare(input)
    } catch (error) {
      if (loadEpoch !== epoch) return false
      throw error
    }
    if (loadEpoch !== epoch) {
      await destroy(prepared)
      return false
    }
    try {
      await commit(input, prepared)
    } catch (error) {
      await destroy(prepared)
      throw error
    }
    return true
  }
  return {
    load(input) {
      const loading = runLoad(input)
      activeLoads.add(loading)
      void loading.then(
        () => activeLoads.delete(loading),
        () => activeLoads.delete(loading),
      )
      return loading
    },
    async invalidate() {
      epoch += 1
      await Promise.all([...activeLoads])
    },
  }
}
