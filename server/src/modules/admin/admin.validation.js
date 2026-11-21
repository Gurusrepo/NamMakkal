import { z } from 'zod';
import { departments } from '../intelligence/intelligence.taxonomy.js';

export const issueListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
  status: z.enum(['ALL', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'MERGED']).optional(),
  department: z.enum(departments).optional(),
  category: z.enum(['ROAD_DAMAGE', 'WATER_SUPPLY', 'DRAINAGE', 'WASTE_MANAGEMENT',
    'STREETLIGHT', 'PUBLIC_HEALTH', 'PUBLIC_PROPERTY', 'OTHER']).optional(),
  wardId: z.coerce.number().int().positive().optional(),
  teamId: z.coerce.number().int().positive().optional(),
  search: z.string().trim().min(1).max(100).optional()
}).strict();

export const issueIdSchema = z.object({ id: z.coerce.number().int().positive() }).strict();
export const disputeIssueIdSchema = z.object({ issueId: z.coerce.number().int().positive() }).strict();
export const disputeListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(1000000).default(0)
}).strict();
export const disputeReviewSchema = z.object({
  decision: z.enum(['ACCEPT','REJECT']),
  reason: z.string().trim().min(1).max(2000)
}).strict();
export const assignOfficerSchema = z.object({ officerId: z.coerce.number().int().positive() }).strict();
export const duplicateListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
  status: z.enum(['PENDING','APPROVED','REJECTED','STALE']).default('PENDING')
}).strict();
export const duplicateIdSchema = z.object({ id: z.coerce.number().int().positive() }).strict();
export const approveDuplicateSchema = z.object({ canonicalIssueId: z.number().int().positive() }).strict();
export const rejectDuplicateSchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

const activeQuery = z.enum(['true', 'false']).optional().transform(value => value === 'true');
export const wardIdSchema = z.object({ id: z.coerce.number().int().positive() }).strict();
export const memberParamsSchema = z.object({ id: z.coerce.number().int().positive(), userId: z.coerce.number().int().positive() }).strict();
export const wardListQuerySchema = z.object({ includeInactive: activeQuery }).strict();
export const teamListQuerySchema = z.object({
  wardId: z.coerce.number().int().positive().optional(),
  includeInactive: activeQuery
}).strict();
export const membershipListQuerySchema = z.object({ includeHistory: activeQuery }).strict();
export const createWardSchema = z.object({
  code: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/).transform(value => value.toUpperCase()),
  name: z.string().trim().min(1).max(100)
}).strict();
export const updateWardSchema = z.object({
  code: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/).transform(value => value.toUpperCase()).optional(),
  name: z.string().trim().min(1).max(100).optional(),
  active: z.boolean().optional()
}).strict();
export const createTeamSchema = z.object({
  wardId: z.number().int().positive(),
  name: z.string().trim().min(1).max(100),
  department: z.enum(departments)
}).strict();
export const updateTeamSchema = z.object({
  wardId: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(100).optional(),
  department: z.enum(departments).optional(),
  active: z.boolean().optional()
}).strict();
export const addTeamMemberSchema = z.object({ officerId: z.number().int().positive() }).strict();
export const teamRoutingSchema = z.object({
  teamId: z.number().int().positive(),
  routingDepartment: z.enum(departments)
}).strict();

export const reportedProblemListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
  status: z.enum(['NEW', 'IN_PROGRESS', 'RESOLVED', 'REJECTED']).optional(),
  category: z.enum(['LOGIN_ISSUE', 'PROFILE_ISSUE', 'TECHNICAL_ERROR', 'UI_DESIGN', 'OTHER']).optional(),
  search: z.string().trim().max(100).optional()
}).strict();

export const reportedProblemReferenceSchema = z.object({
  referenceId: z.string().trim().regex(/^NM-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/)
}).strict();

export const updateReportedProblemStatusSchema = z.object({
  status: z.enum(['NEW', 'IN_PROGRESS', 'RESOLVED', 'REJECTED']),
  adminNotes: z.string().trim().max(5000).nullable().optional()
}).strict();

export const suggestionListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
  status: z.enum(['NEW', 'UNDER_REVIEW', 'PLANNED', 'IMPLEMENTED', 'REJECTED']).optional(),
  category: z.enum(['NEW_FEATURE', 'ACCESSIBILITY', 'USER_EXPERIENCE', 'GOVERNMENT_SERVICES', 'OTHER']).optional(),
  search: z.string().trim().max(100).optional()
}).strict();

export const officerIdSchema = z.object({ id: z.coerce.number().int().positive() }).strict();
export const officerListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
  status: z.enum(['ACTIVE', 'PENDING_EMAIL_VERIFICATION', 'DEACTIVATED']).optional(),
  teamId: z.coerce.number().int().positive().optional(),
  search: z.string().trim().min(1).max(100).optional()
}).strict();
export const createOfficerSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  wardId: z.number().int().positive(),
  teamIds: z.array(z.number().int().positive()).min(1).max(20)
    .refine((ids) => new Set(ids).size === ids.length, 'Team IDs must be unique')
}).strict();
export const updateOfficerStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'DEACTIVATED'])
}).strict();

export const suggestionReferenceSchema = z.object({
  referenceId: z.string().trim().regex(/^NM-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/)
}).strict();

export const updateSuggestionStatusSchema = z.object({
  status: z.enum(['NEW', 'UNDER_REVIEW', 'PLANNED', 'IMPLEMENTED', 'REJECTED']),
  rejectionReason: z.string().trim().min(3).max(1000).nullable().optional(),
  adminNotes: z.string().trim().max(5000).nullable().optional()
}).strict();
