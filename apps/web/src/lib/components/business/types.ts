import type { ServiceTimeStatus, ServiceTimeReviewAction } from '@pulsar/shared';
export interface Partner {
  id: string;
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  active: boolean;
  isCustomer: boolean;
  isSupplier: boolean;
  updatedAt: string;
}
export interface CatalogItem {
  id: string;
  code: string;
  name: string;
  kind: 'GOODS' | 'SERVICE';
  unit: string;
  description: string;
  active: boolean;
  updatedAt: string;
}
export interface Project {
  id: string;
  number: string;
  title: string;
  description: string;
  partnerId: string;
  partner: { id: string; name: string };
  dueDate: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  updatedAt: string;
  _count: { jobs: number };
}
export interface ServiceJob {
  id: string;
  number: string;
  title: string;
  projectId: string;
  project: { id: string; number: string; title: string; status: Project['status'] };
  catalogItemId: string | null;
  catalogItem: { id: string; name: string } | null;
  instructions: string;
  assigneeLabel: string;
  assigneeUserId: string | null;
  assignee: ServicePerson | null;
  scheduledAt: string | null;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  report: string;
  completedAt: string | null;
  updatedAt: string;
}
export interface ServicePerson {
  id: string;
  firstName: string;
  lastName: string;
  status: string;
}
export interface ServiceTimeEntry {
  id: string;
  jobId: string;
  userId: string;
  workDate: string;
  minutes: number;
  billable: boolean;
  note: string;
  status: ServiceTimeStatus;
  voidReason: string | null;
  updatedAt: string;
  user: ServicePerson;
  createdBy: ServicePerson;
  reviews: ServiceTimeReview[];
  _count: { reviews: number };
  job: {
    id: string;
    number: string;
    title: string;
    status: ServiceJob['status'];
    project: ServiceJob['project'];
  };
}
export interface ServiceTimeReview {
  id: string;
  action: ServiceTimeReviewAction;
  fromStatus: ServiceTimeStatus;
  toStatus: ServiceTimeStatus;
  reason: string | null;
  actor: ServicePerson;
  createdAt: string;
  entryVersion: string;
  snapshot: { before: TimeSnapshot; after: TimeSnapshot };
}
interface TimeSnapshot {
  workDate: string;
  minutes: number;
  billable: boolean;
  note: string;
}
export interface SupplierOrder {
  id: string;
  number: string;
  supplierId: string;
  supplier: { id: string; name: string };
  currency: string;
  expectedDate: string | null;
  notes: string;
  closeReason: string | null;
  status: 'DRAFT' | 'CONFIRMED' | 'CLOSED' | 'CANCELLED';
  total: string;
  updatedAt: string;
  lines: {
    id: string;
    stockItem: boolean;
    received: string;
    remaining: string;
    catalogItemId: string;
    nameSnapshot: string;
    unitSnapshot: string;
    quantity: string;
    unitPrice: string;
  }[];
}
