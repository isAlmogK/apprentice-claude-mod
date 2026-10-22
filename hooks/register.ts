import type { Area } from '../src/core/types.ts'

export const MAP_PANE = 'apprentice'

// Module state. Task 10 adds the rest.
let areas: Area[] = []

export function register(on: any) {
  on('session.start', async ($: any, e: any, next: any) => {
    await $.command.register({
      name: 'apprentice',
      description: 'Open your knowledge map of this repo',
      argumentHint: '[wrapped | quiet [minutes] | remap]',
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: 'apprentice' }, async () => {
    return { text: 'Apprentice has ' + areas.length + ' areas mapped.' }
  })
}
