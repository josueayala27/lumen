import type { ControlCommand, LiveCommand } from '@lumen/schema'

/** Stamps timer commands because MIDI carries no wall clock. */
export function toLiveCommand(command: ControlCommand, now = Date.now()): LiveCommand {
  switch (command.type) {
    case 'timerStart':
      return { type: 'timerStart', timerId: command.timerId, now }
    case 'timerStop':
      return { type: 'timerStop', timerId: command.timerId, now }
    case 'timerReset':
      return { type: 'timerReset', timerId: command.timerId }
    default:
      return command
  }
}
