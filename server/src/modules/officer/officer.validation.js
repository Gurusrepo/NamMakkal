import { z } from 'zod';
import { departments } from '../intelligence/intelligence.taxonomy.js';

export const issueIdSchema = z.object({ id: z.coerce.number().int().positive() }).strict();
export const issueListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED']).optional(),
  department: z.enum(departments).optional(),
  category: z.enum([
    'ROAD_DAMAGE', 'WATER_SUPPLY', 'DRAINAGE', 'WASTE_MANAGEMENT',
    'STREETLIGHT', 'PUBLIC_HEALTH', 'PUBLIC_PROPERTY', 'OTHER'
  ]).optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  teamId: z.coerce.number().int().positive().optional(),
  wardId: z.coerce.number().int().positive().optional(),
  assignedFrom: z.string().date().optional(),
  assignedTo: z.string().date().optional(),
  search: z.string().trim().min(1).max(120).optional(),
  sort: z.enum(['NEWEST', 'OLDEST']).default('NEWEST')
}).strict().superRefine((query, context) => {
  if (query.assignedFrom && query.assignedTo && query.assignedFrom > query.assignedTo) {
    context.addIssue({
      code: 'custom',
      path: ['assignedTo'],
      message: 'Assignment end date must not precede the start date'
    });
  }
});
export const repairEvidenceSchema = z.object({ stage: z.enum(['BEFORE', 'AFTER']) }).strict();
export const inspectionSchema = z.object({
  findings: z.string().trim().min(1).max(4000)
}).strict();
export const progressUpdateSchema = z.object({
  message: z.string().trim().min(1).max(2000)
}).strict();
export const actionPlanSchema = z.object({
  description: z.string().trim().min(1).max(4000),
  steps: z.array(z.string().trim().min(1).max(300)).max(10).default([])
}).strict();
export const resolutionSchema = z.object({
  summary: z.string().trim().min(1).max(2000)
}).strict();
