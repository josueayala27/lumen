import { bigint, boolean, index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { createdAt, idColumn, updatedAt } from '../columns'

export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex('user_email_key').on(table.email)],
)

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [uniqueIndex('session_token_key').on(table.token), index('session_user_idx').on(table.userId)],
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('account_user_idx').on(table.userId)],
)

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
)

export const workspaceRole = pgEnum('workspace_role', ['owner', 'admin', 'editor', 'operator', 'viewer'])
export const presentationKind = pgEnum('presentation_kind', ['presentation', 'song'])
export const mediaKind = pgEnum('media_kind', ['image', 'video', 'audio'])
export const fontSource = pgEnum('font_source', ['bundled', 'imported'])

export const workspaces = pgTable(
  'workspaces',
  {
    id: idColumn('workspace'),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    plan: text('plan').notNull().default('free'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('workspaces_slug_key').on(table.slug)],
)

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    role: workspaceRole('role').notNull().default('editor'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('workspace_members_key').on(table.workspaceId, table.userId),
    index('workspace_members_user_idx').on(table.userId),
  ],
)

export const workspaceInvites = pgTable(
  'workspace_invites',
  {
    id: idColumn('invite'),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: workspaceRole('role').notNull().default('editor'),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('workspace_invites_workspace_idx').on(table.workspaceId)],
)

export const libraries = pgTable(
  'libraries',
  {
    id: idColumn('library'),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('general'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('libraries_workspace_idx').on(table.workspaceId)],
)

export const presentations = pgTable(
  'presentations',
  {
    id: idColumn('presentation'),
    libraryId: text('library_id').notNull().references(() => libraries.id, { onDelete: 'cascade' }),
    kind: presentationKind('kind').notNull().default('presentation'),
    title: text('title').notNull(),
    themeId: text('theme_id'),
    doc: jsonb('doc').notNull(),
    docSchema: text('doc_schema').notNull().default('1'),
    version: bigint('version', { mode: 'number' }).notNull().default(0),
    clientUpdatedAt: timestamp('client_updated_at', { withTimezone: true }).notNull().defaultNow(),
    serverRev: bigint('server_rev', { mode: 'number' }).notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('presentations_library_idx').on(table.libraryId),
    index('presentations_rev_idx').on(table.serverRev),
  ],
)

export const themes = pgTable(
  'themes',
  {
    id: idColumn('theme'),
    libraryId: text('library_id').notNull().references(() => libraries.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    doc: jsonb('doc').notNull(),
    docSchema: text('doc_schema').notNull().default('1'),
    serverRev: bigint('server_rev', { mode: 'number' }).notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('themes_library_idx').on(table.libraryId), index('themes_rev_idx').on(table.serverRev)],
)

export const playlists = pgTable(
  'playlists',
  {
    id: idColumn('playlist'),
    libraryId: text('library_id').notNull().references(() => libraries.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    doc: jsonb('doc').notNull(),
    docSchema: text('doc_schema').notNull().default('1'),
    serverRev: bigint('server_rev', { mode: 'number' }).notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('playlists_library_idx').on(table.libraryId), index('playlists_rev_idx').on(table.serverRev)],
)

export const mediaAssets = pgTable(
  'media_assets',
  {
    id: idColumn('media'),
    libraryId: text('library_id').notNull().references(() => libraries.id, { onDelete: 'cascade' }),
    kind: mediaKind('kind').notNull(),
    name: text('name').notNull(),
    sha256: text('sha256').notNull(),
    mime: text('mime').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    durationMs: bigint('duration_ms', { mode: 'number' }),
    width: bigint('width', { mode: 'number' }),
    height: bigint('height', { mode: 'number' }),
    r2Key: text('r2_key'),
    serverRev: bigint('server_rev', { mode: 'number' }).notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('media_library_idx').on(table.libraryId),
    uniqueIndex('media_library_sha_key').on(table.libraryId, table.sha256),
  ],
)

export const fonts = pgTable(
  'fonts',
  {
    id: idColumn('font'),
    libraryId: text('library_id').notNull().references(() => libraries.id, { onDelete: 'cascade' }),
    family: text('family').notNull(),
    sha256: text('sha256').notNull(),
    r2Key: text('r2_key'),
    source: fontSource('source').notNull().default('imported'),
    licenseFlag: text('license_flag').notNull().default('local-only'),
    serverRev: bigint('server_rev', { mode: 'number' }).notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('fonts_library_idx').on(table.libraryId)],
)

export const workspaceRevs = pgTable('workspace_revs', {
  workspaceId: text('workspace_id').primaryKey().references(() => workspaces.id, { onDelete: 'cascade' }),
  rev: bigint('rev', { mode: 'number' }).notNull().default(0),
})

export const syncOps = pgTable(
  'sync_ops',
  {
    opId: text('op_id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    baseRev: bigint('base_rev', { mode: 'number' }).notNull().default(0),
    result: text('result').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('sync_ops_workspace_idx').on(table.workspaceId, table.createdAt)],
)

export const syncConflicts = pgTable(
  'sync_conflicts',
  {
    id: idColumn('conflict'),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    baseRev: bigint('base_rev', { mode: 'number' }).notNull(),
    localDoc: jsonb('local_doc').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('sync_conflicts_workspace_idx').on(table.workspaceId, table.createdAt)],
)

export const liveSessions = pgTable(
  'live_sessions',
  {
    id: idColumn('live'),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('live_sessions_code_key').on(table.code)],
)
