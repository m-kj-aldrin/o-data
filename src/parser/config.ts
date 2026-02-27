/**
 * High-level negative filters applied by name.
 * Each array is interpreted as a list of strings or RegExp patterns.
 * For strings, the parser internally does `new RegExp(pattern)`.
 */
export interface ExcludeFilters {
  /**
   * Entity set names to exclude, e.g. ['^msdyn', /^tmp_/].
   * Applied to entity set names, not type names.
   */
  entities?: (string | RegExp)[];

  /**
   * Complex type names to exclude (FQN or short name patterns).
   */
  complexTypes?: (string | RegExp)[];

  /**
   * Action names to exclude (bound and unbound).
   */
  actions?: (string | RegExp)[];

  /**
   * Function names to exclude (bound and unbound).
   */
  functions?: (string | RegExp)[];

  /**
   * Structural property names to exclude on all entity and complex types.
   * Example: ['^adx', '^coop_(?!customerid$|personalnumber$|kimcustomerid$)'].
   */
  properties?: (string | RegExp)[];

  /**
   * Navigation property names to exclude on all entity types.
   */
  navigations?: (string | RegExp)[];
}

/**
 * Hard masks that run after discovery and selection mode.
 * Masks have higher precedence than `wanted*` and `only*` lists.
 */
export interface MaskRules {
  /**
   * Entity set or entity type names to completely hide.
   * Matches against entity set name, short type name, or FQN.
   */
  entities?: (string | RegExp)[];

  /**
   * Per-entity masks for bound actions.
   * Key: entity identifier (set name, short type name, or FQN).
   * Value:
   *   - 'ALL' → mask all bound actions for that entity.
   *   - string[] / RegExp[] → mask only matching bound actions.
   */
  boundActionsByEntity?: Record<string, (string | RegExp)[] | 'ALL'>;

  /**
   * Per-entity masks for bound functions.
   * Shape is identical to `boundActionsByEntity` but for functions.
   */
  boundFunctionsByEntity?: Record<string, (string | RegExp)[] | 'ALL'>;

  /**
   * Global masks for unbound actions (by operation name).
   */
  unboundActions?: (string | RegExp)[];

  /**
   * Global masks for unbound functions (by operation name).
   */
  unboundFunctions?: (string | RegExp)[];

  /**
   * Per-entity whitelist for bound actions.
   * Key: entity identifier (set name, short type name, or FQN).
   * Value: names / patterns of bound actions to KEEP for that entity.
   * When a rule exists for an entity, any non-matching bound action
   * on that entity is implicitly removed.
   */
  onlyBoundActionsByEntity?: Record<string, (string | RegExp)[]>;
}

/**
 * How `only*` lists are interpreted.
 * - 'additive' (default): start from `wanted*` + dependencies, then filter.
 * - 'only': treat `only*` lists as hard whitelists.
 */
export type SelectionMode = 'additive' | 'only';

/**
 * Top-level configuration for the schema generator.
 * This is what you pass to `defineConfig` in `odata-parser.config.ts`.
 */
export interface ParserConfig {
  /**
   * Path to the CSDL XML file, relative to the config file.
   */
  inputPath: string;

  /**
   * Directory where the generated TypeScript schema file will be written.
   * The generator will write `<outputPath>/generated-o-data-schema.ts`.
   */
  outputPath: string;

  /**
   * List of entity set names you explicitly care about, or 'ALL'.
   * - When array: acts as a whitelist for entity sets discovered via
   *   the entity container and navigation; navs never introduce sets
   *   that are not in this list.
   * - When 'ALL': include all entity sets (still subject to excludes/masks).
   */
  wantedEntities?: string[] | 'ALL';

  /**
   * Unbound actions to include, or 'ALL' for all unbound actions.
   * Exclude filters and masks still apply on top.
   */
  wantedUnboundActions?: string[] | 'ALL';

  /**
   * Unbound functions to include, or 'ALL' for all unbound functions.
   * Exclude filters and masks still apply on top.
   */
  wantedUnboundFunctions?: string[] | 'ALL';

  /**
   * Name-based negative filters applied early in discovery.
   * Use these for broad "never include X" rules.
   */
  excludeFilters?: ExcludeFilters;

  /**
   * Controls whether `only*` lists act as hard whitelists.
   * - 'additive' (default): `wanted*` + dependencies → filter → masks.
   * - 'only': final entities/operations must also be present in the
   *   corresponding `only*` list, if provided.
   */
  selectionMode?: SelectionMode;

  /**
   * Additional whitelist for entity sets / types when `selectionMode === 'only'`.
   * Entries can be entity set names or short entity type names.
   */
  onlyEntities?: string[];

  /**
   * Global whitelist for bound actions when `selectionMode === 'only'`.
   * Keeps only actions whose name appears here (after excludes/masks).
   */
  onlyBoundActions?: string[];

  /**
   * Global whitelist for bound functions when `selectionMode === 'only'`.
   */
  onlyBoundFunctions?: string[];

  /**
   * Global whitelist for unbound actions when `selectionMode === 'only'`.
   */
  onlyUnboundActions?: string[];

  /**
   * Global whitelist for unbound functions when `selectionMode === 'only'`.
   */
  onlyUnboundFunctions?: string[];

  /**
   * Hard masks and per-entity operation rules that run after discovery
   * and selection mode. Masks always win over `wanted*` and `only*`.
   */
  mask?: MaskRules;
}

export function defineConfig(config: ParserConfig): ParserConfig {
  return config;
}
