export interface ExcludeFilters {
  entities?: (string | RegExp)[];
  complexTypes?: (string | RegExp)[];
  actions?: (string | RegExp)[];
  functions?: (string | RegExp)[];
  properties?: (string | RegExp)[];
  navigations?: (string | RegExp)[];
}

export interface ParserConfig {
  inputPath: string;
  outputPath: string;
  wantedEntities?: string[];
  wantedActions?: string[];
  wantedFunctions?: string[];
  excludeFilters?: ExcludeFilters;
}

export function defineConfig(config: ParserConfig): ParserConfig {
  return config;
}
