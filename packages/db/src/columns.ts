import { customType, text, timestamp } from 'drizzle-orm/pg-core'

export type IdKind =
  | 'workspace'
  | 'member'
  | 'invite'
  | 'library'
  | 'presentation'
  | 'theme'
  | 'playlist'
  | 'media'
  | 'font'
  | 'session'
  | 'op'
  | 'conflict'
  | 'live'

export function newId(kind: IdKind): string {
  return `${kind}_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`
}

export const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

export const idColumn = (kind: IdKind) =>
  text('id')
    .primaryKey()
    .$defaultFn(() => newId(kind))

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())

export const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
  fromDriver: (value) => (value instanceof Uint8Array ? value : new Uint8Array(value)),
})
