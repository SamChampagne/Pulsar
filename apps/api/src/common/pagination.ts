import type { Paginated } from '@pulsar/shared';
import { ListQueryDto } from './dto/list-query.dto';

export function paginationArgs(query: ListQueryDto) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function paginated<T>(items: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return { items, total, page, pageSize };
}
