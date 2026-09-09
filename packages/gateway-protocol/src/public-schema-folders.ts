// Public per-folder access contracts for the shared mount.
//
// Split out of public-schema.ts so that file stays under the repository's per-file line
// ceiling; the export list is the same one, in the same order.
export {
  FolderAccessRuleSchema,
  FolderTreeEntrySchema,
  FolderEffectiveRuleSchema,
  FolderSubjectDepartmentSchema,
  FolderSubjectUserSchema,
  FoldersTreeListParamsSchema,
  FoldersTreeListResultSchema,
  FoldersRulesListParamsSchema,
  FoldersRulesListResultSchema,
  FoldersRulesSetParamsSchema,
  FoldersRulesSetResultSchema,
  FoldersRulesClearParamsSchema,
  FoldersRulesClearResultSchema,
  FolderOrphanReasonSchema,
  FolderOrphanRuleSchema,
  FoldersRulesOrphansParamsSchema,
  FoldersRulesOrphansResultSchema,
  FoldersRulesOrphansClearParamsSchema,
  FoldersRulesOrphansClearResultSchema,
  FoldersSubjectsListParamsSchema,
  FoldersSubjectsListResultSchema,
} from "./schema/folder-rules.js";
