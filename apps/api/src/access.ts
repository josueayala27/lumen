import { schema } from '@lumen/db'
import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import type { AppEnv } from './types'
import { ApiError } from './errors'

export const WORKSPACE_ROLES = ['owner', 'admin', 'editor', 'operator', 'viewer'] as const
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

const rank: Record<WorkspaceRole, number> = {
  owner: 4,
  admin: 3,
  editor: 2,
  operator: 1,
  viewer: 0,
}

export async function memberRole(c: Context<AppEnv>, workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
  const [row] = await c.var.db
    .select({ role: schema.workspaceMembers.role })
    .from(schema.workspaceMembers)
    .where(and(eq(schema.workspaceMembers.workspaceId, workspaceId), eq(schema.workspaceMembers.userId, userId)))
    .limit(1)
  return (row?.role as WorkspaceRole | undefined) ?? null
}

export async function requireRole(
  c: Context<AppEnv>,
  workspaceId: string,
  min: WorkspaceRole,
): Promise<{ userId: string; role: WorkspaceRole }> {
  const userId = c.var.user?.id
  if (!userId) throw new ApiError(401, 'unauthorized', 'Sign in required')
  const role = await memberRole(c, workspaceId, userId)
  // A non-member sees the same 404 as a missing workspace, so ids do not leak.
  if (!role) throw new ApiError(404, 'not_found', 'Workspace not found')
  if (rank[role] < rank[min]) throw new ApiError(403, 'forbidden', 'Insufficient role')
  return { userId, role }
}

export async function libraryWorkspace(c: Context<AppEnv>, libraryId: string): Promise<string> {
  const [row] = await c.var.db
    .select({ workspaceId: schema.libraries.workspaceId })
    .from(schema.libraries)
    .where(eq(schema.libraries.id, libraryId))
    .limit(1)
  if (!row) throw new ApiError(404, 'not_found', 'Library not found')
  return row.workspaceId
}
