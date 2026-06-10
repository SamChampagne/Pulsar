/** Standard list-response envelope used by all paginated API endpoints. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiError {
  statusCode: number;
  message: string | string[];
  error?: string;
}

export interface ListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
}
