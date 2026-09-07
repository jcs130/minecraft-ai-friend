// Compatibility entry point for existing runtime and tooling imports.
export type { SkillCatalogEntry, SkillCatalog } from './gameplay/magic/catalog.ts'
export { validateSkillCatalog, projectCatalogEntry } from './gameplay/magic/catalog.ts'
export { loadSkillCatalog } from './infrastructure/skill-catalog-file.ts'
