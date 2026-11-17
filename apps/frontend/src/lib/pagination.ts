export interface PaginatedCollection<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
}

export function nextCollectionPage(page: PaginatedCollection<unknown>) {
  return page.pagination.hasMore ? page.pagination.page + 1 : undefined;
}
