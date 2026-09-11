import { useLocaleStore } from '../stores/locale.store'

export function startLocalizedRenderer(render: () => void): () => void {
  let active = true
  document.documentElement.lang = useLocaleStore.getState().resolvedLocale
  const unsubscribe = useLocaleStore.subscribe((state) => {
    document.documentElement.lang = state.resolvedLocale
  })
  const dispose = () => {
    if (!active) return
    active = false
    unsubscribe()
    useLocaleStore.getState().dispose()
    window.removeEventListener('beforeunload', dispose)
  }
  window.addEventListener('beforeunload', dispose)
  void useLocaleStore
    .getState()
    .hydrate()
    .then(() => {
      if (active) render()
    })
  return dispose
}
