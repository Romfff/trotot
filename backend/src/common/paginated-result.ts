// Explicit marker prevents accidentally treating a resource's own data/meta fields as an envelope.
export class PaginatedResult<T> {
  constructor(public readonly data: T[], public readonly meta: { page: number; limit: number; total: number; totalPages: number; unreadCount?: number }) {}
}
