export interface ExcludeFilters {
  entities?: (string | RegExp)[];
  complexTypes?: (string | RegExp)[];
  actions?: (string | RegExp)[];
  functions?: (string | RegExp)[];
  properties?: (string | RegExp)[];
  navigations?: (string | RegExp)[];
}

export interface MaskRules {
  entities?: (string | RegExp)[];
  boundActionsByEntity?: Record<string, (string | RegExp)[] | 'ALL'>;
  boundFunctionsByEntity?: Record<string, (string | RegExp)[] | 'ALL'>;
  unboundActions?: (string | RegExp)[];
  unboundFunctions?: (string | RegExp)[];
}

export type SelectionMode = 'additive' | 'only';

export interface ParserConfig {
  inputPath: string;
  outputPath: string;
  wantedEntities?: string[] | 'ALL';
  wantedUnboundActions?: string[] | 'ALL';
  wantedUnboundFunctions?: string[] | 'ALL';
  excludeFilters?: ExcludeFilters;
  selectionMode?: SelectionMode;
  onlyEntities?: string[];
  onlyBoundActions?: string[];
  onlyBoundFunctions?: string[];
  onlyUnboundActions?: string[];
  onlyUnboundFunctions?: string[];
  mask?: MaskRules;
}

export function defineConfig(config: ParserConfig): ParserConfig {
  return config;
}
