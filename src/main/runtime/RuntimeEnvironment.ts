/** Native libraries resolve through the managed build's relative loader paths. */
export function runtimeEnvironment(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(input).filter(([key]) => !/^(LD_|DYLD_)/.test(key)))
}
