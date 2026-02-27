import { XMLParser } from 'fast-xml-parser';
import * as fs from 'fs';
import path, { dirname } from 'path';
import type { ParserConfig, ExcludeFilters, MaskRules, SelectionMode } from './config';

// ----------------------------------------------------------------------------
// CONFIGURATION
// ----------------------------------------------------------------------------

interface NormalizedExcludeFilters {
  entities: RegExp[];
  complexTypes: RegExp[];
  actions: RegExp[];
  functions: RegExp[];
  properties: RegExp[];
  navigations: RegExp[];
}

interface NormalizedMaskRules {
  entities: RegExp[];
  boundActionsByEntity: Map<string, { all: boolean; patterns: RegExp[] }>;
  boundFunctionsByEntity: Map<string, { all: boolean; patterns: RegExp[] }>;
  unboundActions: RegExp[];
  unboundFunctions: RegExp[];
  onlyBoundActionsByEntity: Map<string, RegExp[]>;
}

function normalizeExcludeFilters(filters?: ExcludeFilters): NormalizedExcludeFilters {
  const normalize = (patterns?: (string | RegExp)[]): RegExp[] => {
    if (!patterns) return [];
    return patterns.map((p) => (typeof p === 'string' ? new RegExp(p) : p));
  };

  return {
    entities: normalize(filters?.entities),
    complexTypes: normalize(filters?.complexTypes),
    actions: normalize(filters?.actions),
    functions: normalize(filters?.functions),
    properties: normalize(filters?.properties),
    navigations: normalize(filters?.navigations),
  };
}

function normalizeMaskRules(mask?: MaskRules): NormalizedMaskRules {
  const normalize = (patterns?: (string | RegExp)[]): RegExp[] => {
    if (!patterns) return [];
    return patterns.map((p) => (typeof p === 'string' ? new RegExp(p) : p));
  };

  const normalizeByEntity = (
    input?: Record<string, (string | RegExp)[] | 'ALL'>
  ): Map<string, { all: boolean; patterns: RegExp[] }> => {
    const result = new Map<string, { all: boolean; patterns: RegExp[] }>();
    if (!input) return result;
    for (const [key, value] of Object.entries(input)) {
      if (value === 'ALL') {
        result.set(key, { all: true, patterns: [] });
      } else {
        result.set(key, { all: false, patterns: normalize(value) });
      }
    }
    return result;
  };

  const normalizeByEntityOnly = (
    input?: Record<string, (string | RegExp)[]>
  ): Map<string, RegExp[]> => {
    const result = new Map<string, RegExp[]>();
    if (!input) return result;
    for (const [key, value] of Object.entries(input)) {
      result.set(key, normalize(value));
    }
    return result;
  };

  return {
    entities: normalize(mask?.entities),
    boundActionsByEntity: normalizeByEntity(mask?.boundActionsByEntity),
    boundFunctionsByEntity: normalizeByEntity(mask?.boundFunctionsByEntity),
    unboundActions: normalize(mask?.unboundActions),
    unboundFunctions: normalize(mask?.unboundFunctions),
    onlyBoundActionsByEntity: normalizeByEntityOnly(mask?.onlyBoundActionsByEntity),
  };
}

async function loadConfig(configPathArgFromCaller?: string): Promise<{
  inputFile: string;
  outputFile: string;
  wantedEntities: string[] | 'ALL';
  wantedUnboundActions: string[] | 'ALL' | undefined;
  wantedUnboundFunctions: string[] | 'ALL' | undefined;
  excludeFilters: NormalizedExcludeFilters;
  selectionMode: SelectionMode;
  onlyEntities?: string[];
  onlyBoundActions?: string[];
  onlyBoundFunctions?: string[];
  onlyUnboundActions?: string[];
  onlyUnboundFunctions?: string[];
  mask: NormalizedMaskRules;
}> {
  const configPathArg = configPathArgFromCaller ?? process.argv[2];
  let configPath: string | null = null;

  // Check for config path in first CLI arg
  if (configPathArg) {
    const root = process.cwd();
    configPath = path.isAbsolute(configPathArg) ? configPathArg : path.join(root, configPathArg);
    if (!fs.existsSync(configPath)) {
      throw new Error(`Config file not found: ${configPath}`);
    }
  } else {
    // Look for default config file in cwd
    const defaultConfigPath = path.join(process.cwd(), 'odata-parser.config.ts');
    if (fs.existsSync(defaultConfigPath)) {
      configPath = defaultConfigPath;
    }
  }

  // Config file is required
  if (!configPath) {
    throw new Error(
      'Config file not found. Either provide a path or create odata-parser.config.ts in the current directory.'
    );
  }

  // Load config
  try {
    const configModule = await import(configPath);
    const config: ParserConfig = configModule.default || configModule;
    
    if (!config.inputPath || !config.outputPath) {
      throw new Error('Config must specify inputPath and outputPath');
    }

    const configDir = path.dirname(configPath);
    const inputFile = path.resolve(configDir, config.inputPath);
    const outputFile = path.resolve(configDir, config.outputPath, 'generated-o-data-schema.ts');

    return {
      inputFile,
      outputFile,
      wantedEntities: config.wantedEntities || [],
      wantedUnboundActions: config.wantedUnboundActions,
      wantedUnboundFunctions: config.wantedUnboundFunctions,
      excludeFilters: normalizeExcludeFilters(config.excludeFilters),
      selectionMode: config.selectionMode ?? 'additive',
      onlyEntities: config.onlyEntities,
      onlyBoundActions: config.onlyBoundActions,
      onlyBoundFunctions: config.onlyBoundFunctions,
      onlyUnboundActions: config.onlyUnboundActions,
      onlyUnboundFunctions: config.onlyUnboundFunctions,
      mask: normalizeMaskRules(config.mask),
    };
  } catch (error) {
    throw new Error(`Error loading config file: ${String(error)}`);
  }
}

// ----------------------------------------------------------------------------
// XML Types
// ----------------------------------------------------------------------------
interface CsdlProperty {
  '@_Name': string;
  '@_Type': string;
  '@_Nullable'?: string;
}

interface CsdlNavigationProperty {
  '@_Name': string;
  '@_Type': string;
}

interface CsdlKey {
  PropertyRef: { '@_Name': string }[] | { '@_Name': string };
}

interface CsdlEntityType {
  '@_Name': string;
  '@_BaseType'?: string;
  Key?: CsdlKey;
  Property?: CsdlProperty[];
  NavigationProperty?: CsdlNavigationProperty[];
}

interface CsdlComplexType {
  '@_Name': string;
  Property?: CsdlProperty[];
}

interface CsdlEnumType {
  '@_Name': string;
  '@_IsFlags'?: string;
  Member?: { '@_Name': string; '@_Value': string }[];
}

interface CsdlActionOrFunction {
  '@_Name': string;
  '@_IsBound'?: string;
  Parameter?: { '@_Name': string; '@_Type': string; '@_Nullable'?: string }[];
  ReturnType?: { '@_Type': string; '@_Nullable'?: string };
}

interface CsdlEntitySet {
  '@_Name': string;
  '@_EntityType': string;
  NavigationPropertyBinding?: { '@_Path': string; '@_Target': string }[];
}

interface CsdlSchema {
  '@_Namespace': string;
  '@_Alias'?: string;
  EntityType?: CsdlEntityType[];
  ComplexType?: CsdlComplexType[];
  EnumType?: CsdlEnumType[];
  Action?: CsdlActionOrFunction[];
  Function?: CsdlActionOrFunction[];
  EntityContainer?: {
    EntitySet?: CsdlEntitySet[];
    FunctionImport?: { '@_Name': string; '@_Function': string }[];
    ActionImport?: { '@_Name': string; '@_Action': string }[];
  };
}

// ----------------------------------------------------------------------------
// Internal Types for Processing
// ----------------------------------------------------------------------------
interface ProcessedOperation {
  def: CsdlActionOrFunction;
  type: 'Action' | 'Function';
  isBound: boolean;
  bindingTypeFQN?: string;
  isCollectionBound?: boolean;
}

// ----------------------------------------------------------------------------
// Main Conversion Logic
// ----------------------------------------------------------------------------

export async function generateSchema(configPath?: string): Promise<void> {
  // Load configuration
  const config = await loadConfig(configPath);
  const INPUT_FILE = config.inputFile;
  const OUTPUT_FILE = config.outputFile;
  const WANTED_ENTITIES = config.wantedEntities;
  const WANTED_UNBOUND_ACTIONS = config.wantedUnboundActions;
  const WANTED_UNBOUND_FUNCTIONS = config.wantedUnboundFunctions;
  const EXCLUDE_FILTERS = config.excludeFilters;
  const SELECTION_MODE = config.selectionMode;
  const ONLY_ENTITIES = config.onlyEntities;
  const ONLY_BOUND_ACTIONS = config.onlyBoundActions;
  const ONLY_BOUND_FUNCTIONS = config.onlyBoundFunctions;
  const ONLY_UNBOUND_ACTIONS = config.onlyUnboundActions;
  const ONLY_UNBOUND_FUNCTIONS = config.onlyUnboundFunctions;
  const MASK = config.mask;

  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Input file not found: ${INPUT_FILE}`);
  }

  const xmlData = fs.readFileSync(INPUT_FILE, 'utf-8');

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => {
      const arrayTags = [
        'Property',
        'NavigationProperty',
        'NavigationPropertyBinding',
        'EntitySet',
        'EntityType',
        'ComplexType',
        'EnumType',
        'Action',
        'Function',
        'Parameter',
        'PropertyRef',
        'FunctionImport',
        'ActionImport',
        'Member',
      ];
      return arrayTags.includes(name);
    },
  });

  const parsed = parser.parse(xmlData);
  const edmx = parsed['edmx:Edmx'] || parsed.Edmx;
  const dataServices = edmx['edmx:DataServices'] || edmx.DataServices;
  const schemas: CsdlSchema[] = Array.isArray(dataServices.Schema)
    ? dataServices.Schema
    : [dataServices.Schema];

  const mainSchema = schemas.find((s) => s.EntityType && s.EntityType.length > 0) || schemas[0];
  if (!mainSchema) {
    throw new Error('No schema found in CSDL document');
  }
  const namespace = mainSchema['@_Namespace'];
  const alias = mainSchema['@_Alias'] || '';

  // --------------------------------------------------------------------------
  // HELPER: Type Resolution (Handles Collections & Aliases)
  // --------------------------------------------------------------------------
  function resolveType(rawType: string): { name: string; isCollection: boolean; original: string } {
    let isCollection = false;
    let clean = rawType || '';

    if (clean.startsWith('Collection(')) {
      isCollection = true;
      clean = clean.match(/Collection\((.*?)\)/)?.[1] || clean;
    }

    // Resolve Alias (e.g. mscrm.incidentresolution -> Microsoft.Dynamics.CRM.incidentresolution)
    if (alias && clean.startsWith(alias + '.')) {
      clean = clean.replace(alias + '.', namespace + '.');
    }

    return { name: clean, isCollection, original: rawType };
  }

  // --------------------------------------------------------------------------
  // HELPER: Exclusion Check
  // --------------------------------------------------------------------------
  function isExcluded(name: string, category: keyof NormalizedExcludeFilters): boolean {
    return EXCLUDE_FILTERS[category].some((r) => r.test(name));
  }

  // --------------------------------------------------------------------------
  // Phase 0: Indexing Everything
  // --------------------------------------------------------------------------
  const typeToSetMap = new Map<string, string>(); // EntityType FQN -> EntitySet Name
  const setToTypeMap = new Map<string, string>(); // EntitySet name -> EntityType FQN
  const entityTypes = new Map<string, CsdlEntityType>(); // FQN -> EntityType Definition
  const complexTypes = new Map<string, CsdlComplexType>(); // FQN -> ComplexType Definition
  const enumTypes = new Map<string, CsdlEnumType>(); // FQN -> EnumType Definition

  for (const s of schemas) {
    const ns = s['@_Namespace'];
    if (s.EntityType) {
      for (const et of s.EntityType) entityTypes.set(`${ns}.${et['@_Name']}`, et);
    }
    if (s.EnumType) {
      for (const et of s.EnumType) {
        const fqn = `${ns}.${et['@_Name']}`;
        enumTypes.set(fqn, et);
      }
    }
    if (s.ComplexType) {
      for (const ct of s.ComplexType) complexTypes.set(`${ns}.${ct['@_Name']}`, ct);
    }
  }

  let entityContainer = mainSchema.EntityContainer;
  if (!entityContainer) {
    const containerSchema = schemas.find((s) => s.EntityContainer);
    if (containerSchema) entityContainer = containerSchema.EntityContainer;
  }

  if (entityContainer && entityContainer.EntitySet) {
    for (const set of entityContainer.EntitySet) {
      const setName = set['@_Name'];
      const typeFqn = set['@_EntityType'];
      typeToSetMap.set(typeFqn, setName);
      setToTypeMap.set(setName, typeFqn);
    }
  }

  // Parse FunctionImport and ActionImport for import tracking
  const functionImports = new Map<string, string>(); // ImportName -> FunctionFQN
  const actionImports = new Map<string, string>(); // ImportName -> ActionFQN

  if (entityContainer) {
    // Parse FunctionImports
    if (entityContainer.FunctionImport) {
      for (const fi of entityContainer.FunctionImport) {
        const functionFqn = fi['@_Function'];
        const { name: resolvedFqn } = resolveType(functionFqn);
        functionImports.set(fi['@_Name'], resolvedFqn);
      }
    }

    // Parse ActionImports
    if (entityContainer.ActionImport) {
      for (const ai of entityContainer.ActionImport) {
        const actionFqn = ai['@_Action'];
        const { name: resolvedFqn } = resolveType(actionFqn);
        actionImports.set(ai['@_Name'], resolvedFqn);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Phase 1: Core Schema Discovery
  // --------------------------------------------------------------------------

  // 1.1 EntitySet Discovery
  const includedEntitySets = new Set<string>();
  const operationExpandedEntitySets = new Set<string>();
  const operationExpandedEntityTypes = new Set<string>();
  if (WANTED_ENTITIES === 'ALL') {
    if (entityContainer && entityContainer.EntitySet) {
      for (const set of entityContainer.EntitySet) {
        if (!isExcluded(set['@_Name'], 'entities')) {
          includedEntitySets.add(set['@_Name']);
        }
      }
    }
  } else {
    for (const setName of WANTED_ENTITIES) {
      if (!isExcluded(setName, 'entities')) {
        includedEntitySets.add(setName);
      }
    }
  }

  // 1.2 EntityType Discovery (including baseType chain)
  const includedEntityTypes = new Set<string>(); // EntityType FQNs

  function resolveBaseTypeChain(entityTypeFQN: string, visited: Set<string> = new Set()) {
    if (visited.has(entityTypeFQN)) return; // Prevent circular references
    visited.add(entityTypeFQN);

    const entityType = entityTypes.get(entityTypeFQN);
    if (!entityType) return;

    includedEntityTypes.add(entityTypeFQN);

    if (entityType['@_BaseType']) {
      const { name: baseTypeFQN } = resolveType(entityType['@_BaseType']);
      resolveBaseTypeChain(baseTypeFQN, visited);
    }
  }

  // Add EntityTypes for included EntitySets
  for (const setName of includedEntitySets) {
    const typeFqn = setToTypeMap.get(setName);
    if (typeFqn) {
      resolveBaseTypeChain(typeFqn);
    }
  }

  // 1.3 Property and Navigation Extraction
  const includedComplexTypes = new Set<string>();
  const includedEnumTypes = new Set<string>();

  function extractTypeDependencies(
    typeFQN: string,
    isCollection: boolean,
    options?: { allowEntitySetExpansionFromEntityType?: boolean }
  ) {
    const { name: resolvedType } = resolveType(typeFQN);
    
    if (resolvedType.startsWith('Edm.')) {
      return; // Primitive type
    }

    if (enumTypes.has(resolvedType)) {
      if (!isExcluded(resolvedType, 'complexTypes')) {
        includedEnumTypes.add(resolvedType);
      }
      return;
    }

    if (complexTypes.has(resolvedType)) {
      if (!isExcluded(resolvedType, 'complexTypes')) {
        includedComplexTypes.add(resolvedType);
        // Recursively extract dependencies from complex type properties
        const ct = complexTypes.get(resolvedType);
        if (ct && ct.Property) {
          for (const prop of ct.Property) {
            extractTypeDependencies(prop['@_Type'], false, options);
          }
        }
      }
      return;
    }

    // Check if EntityType
    if (entityTypes.has(resolvedType)) {
      const entitySetName = typeToSetMap.get(resolvedType);
      if (options?.allowEntitySetExpansionFromEntityType) {
        // Operation-based or explicit expansion: allow new entity sets
        if (entitySetName && !isExcluded(entitySetName, 'entities')) {
          if (!includedEntitySets.has(entitySetName)) {
            includedEntitySets.add(entitySetName);
            operationExpandedEntitySets.add(entitySetName);
            operationExpandedEntityTypes.add(resolvedType);
          }
          if (!includedEntityTypes.has(resolvedType)) {
            resolveBaseTypeChain(resolvedType);
          }
        }
      } else {
        // Structural/entity-set–driven paths: respect wantedEntities whitelist
        if (entitySetName && includedEntitySets.has(entitySetName)) {
          if (!includedEntityTypes.has(resolvedType)) {
            resolveBaseTypeChain(resolvedType);
          }
        }
      }
      return;
    }
  }

  // Extract properties and navigations from included EntityTypes
  for (const entityTypeFQN of includedEntityTypes) {
    const entityType = entityTypes.get(entityTypeFQN);
    if (!entityType) continue;

    // Extract regular properties
    if (entityType.Property) {
      for (const prop of entityType.Property) {
        if (isExcluded(prop['@_Name'], 'properties')) continue;
        extractTypeDependencies(prop['@_Type'], false, { allowEntitySetExpansionFromEntityType: false });
      }
    }

    // Extract navigation properties (only if target is included)
    if (entityType.NavigationProperty) {
      for (const nav of entityType.NavigationProperty) {
        if (isExcluded(nav['@_Name'], 'navigations')) continue;
        const { name: navTargetFQN } = resolveType(nav['@_Type']);
        // Only include navigation if target EntityType is included
        if (includedEntityTypes.has(navTargetFQN)) {
          // Navigation is included, no additional dependencies
        }
      }
    }
  }

  // 1.4 Resolve Complex/Enum Dependencies Recursively
  function resolveComplexDependencies() {
    let changed = true;
    while (changed) {
      changed = false;
      for (const ctFqn of includedComplexTypes) {
        const ct = complexTypes.get(ctFqn);
        if (!ct || !ct.Property) continue;

        for (const prop of ct.Property) {
          const { name: propType } = resolveType(prop['@_Type']);
          if (propType.startsWith('Edm.')) continue;

          if (enumTypes.has(propType)) {
            if (!includedEnumTypes.has(propType) && !isExcluded(propType, 'complexTypes')) {
              includedEnumTypes.add(propType);
              changed = true;
            }
          } else if (complexTypes.has(propType)) {
            if (!includedComplexTypes.has(propType) && !isExcluded(propType, 'complexTypes')) {
              includedComplexTypes.add(propType);
              changed = true;
            }
          }
        }
      }
    }
  }

  resolveComplexDependencies();

  // --------------------------------------------------------------------------
  // Phase 2: Operations Discovery
  // --------------------------------------------------------------------------

  const boundOperations = new Map<string, { actions: ProcessedOperation[]; functions: ProcessedOperation[] }>();
  const unboundActions: ProcessedOperation[] = [];
  const unboundFunctions: ProcessedOperation[] = [];

  // Helper to check if operation should be included
  function shouldIncludeUnboundOperation(
    op: CsdlActionOrFunction,
    opType: 'Action' | 'Function'
  ): boolean {
    const name = op['@_Name'];
    const category = opType === 'Action' ? 'actions' : 'functions';
    const wantedList = opType === 'Action' ? WANTED_UNBOUND_ACTIONS : WANTED_UNBOUND_FUNCTIONS;

    if (isExcluded(name, category)) {
      return false;
    }

    if (wantedList === 'ALL') {
      return true;
    }

    if (wantedList && Array.isArray(wantedList)) {
      return wantedList.includes(name);
    }

    return false;
  }

  // Helper to register complex/enum dependencies from operations
  function registerOperationDependencies(op: CsdlActionOrFunction) {
    if (op.Parameter) {
      for (const param of op.Parameter) {
        extractTypeDependencies(param['@_Type'], false, { allowEntitySetExpansionFromEntityType: true });
      }
    }
    if (op.ReturnType) {
      extractTypeDependencies(op.ReturnType['@_Type'], false, { allowEntitySetExpansionFromEntityType: true });
    }
  }

  // Process Actions
  if (mainSchema.Action) {
    for (const op of mainSchema.Action) {
      const isBound = op['@_IsBound'] === 'true';

      if (isBound) {
        // Bound action - include if bound to included EntityType
        if (op.Parameter && op.Parameter.length > 0) {
          const bindingParam = op.Parameter[0];
          if (!bindingParam) continue;
          const { name: bindingTypeFQN, isCollection } = resolveType(bindingParam['@_Type']);
          const bindingSetName = typeToSetMap.get(bindingTypeFQN);

          let isBindingEntityAllowed = true;
          if (WANTED_ENTITIES !== 'ALL') {
            if (!bindingSetName || !WANTED_ENTITIES.includes(bindingSetName)) {
              isBindingEntityAllowed = false;
            }
          }

          if (isBindingEntityAllowed && includedEntityTypes.has(bindingTypeFQN) && !isExcluded(op['@_Name'], 'actions')) {
            registerOperationDependencies(op);

            const processed: ProcessedOperation = {
              def: op,
              type: 'Action',
              isBound: true,
              bindingTypeFQN,
              isCollectionBound: isCollection,
            };

            if (!boundOperations.has(bindingTypeFQN)) {
              boundOperations.set(bindingTypeFQN, { actions: [], functions: [] });
            }
            boundOperations.get(bindingTypeFQN)!.actions.push(processed);
          }
        }
      } else {
        // Unbound action
        if (shouldIncludeUnboundOperation(op, 'Action')) {
          registerOperationDependencies(op);
          unboundActions.push({
            def: op,
            type: 'Action',
            isBound: false,
          });
        }
      }
    }
  }

  // Process Functions
  if (mainSchema.Function) {
    for (const op of mainSchema.Function) {
      const isBound = op['@_IsBound'] === 'true';

      if (isBound) {
        // Bound function - include if bound to included EntityType
        if (op.Parameter && op.Parameter.length > 0) {
          const bindingParam = op.Parameter[0];
          if (!bindingParam) continue;
          const { name: bindingTypeFQN, isCollection } = resolveType(bindingParam['@_Type']);
          const bindingSetName = typeToSetMap.get(bindingTypeFQN);

          let isBindingEntityAllowed = true;
          if (WANTED_ENTITIES !== 'ALL') {
            if (!bindingSetName || !WANTED_ENTITIES.includes(bindingSetName)) {
              isBindingEntityAllowed = false;
            }
          }

          if (isBindingEntityAllowed && includedEntityTypes.has(bindingTypeFQN) && !isExcluded(op['@_Name'], 'functions')) {
            registerOperationDependencies(op);

            const processed: ProcessedOperation = {
              def: op,
              type: 'Function',
              isBound: true,
              bindingTypeFQN,
              isCollectionBound: isCollection,
            };

            if (!boundOperations.has(bindingTypeFQN)) {
              boundOperations.set(bindingTypeFQN, { actions: [], functions: [] });
            }
            boundOperations.get(bindingTypeFQN)!.functions.push(processed);
          }
        }
      } else {
        // Unbound function
        if (shouldIncludeUnboundOperation(op, 'Function')) {
          registerOperationDependencies(op);
          unboundFunctions.push({
            def: op,
            type: 'Function',
            isBound: false,
          });
        }
      }
    }
  }

  // Resolve dependencies again after operations
  resolveComplexDependencies();

  // Additional sweep: Re-extract dependencies from all included EntityTypes
  // This ensures we capture complex types that might have been missed
  // (e.g., complex types only referenced in properties of EntityTypes
  // that were added during operation dependency resolution)
  for (const entityTypeFQN of includedEntityTypes) {
    const entityType = entityTypes.get(entityTypeFQN);
    if (!entityType) continue;

    // Extract dependencies from regular properties
    if (entityType.Property) {
      for (const prop of entityType.Property) {
        if (isExcluded(prop['@_Name'], 'properties')) continue;
        extractTypeDependencies(prop['@_Type'], false, { allowEntitySetExpansionFromEntityType: false });
      }
    }

    // Note: Navigation properties don't typically have complex type dependencies
    // but we've already processed them in Phase 1
  }

  // Final dependency resolution after the sweep
  resolveComplexDependencies();

  // Apply selection-mode and mask rules before code generation
  applyOnlyModeFilters();
  applyMaskRules();
  pruneOperationExpandedEntities();

  // --------------------------------------------------------------------------
  // Phase 3: Code Generation
  // --------------------------------------------------------------------------

  // Helper to get short name from FQN
  function getShortName(fqn: string): string {
    return fqn.split('.').pop()!;
  }

  // Helper to generate property code
  function generatePropertyCode(
    prop: CsdlProperty,
    key?: CsdlKey
  ): string {
    const propName = prop['@_Name'];
    if (propName.startsWith('_')) return '';

    const { name: resolvedType, isCollection } = resolveType(prop['@_Type']);
    const nullable = prop['@_Nullable'] !== 'false';

    // Check if enum
    if (enumTypes.has(resolvedType)) {
      const shortName = getShortName(resolvedType);
      const options: string[] = [];
      if (isCollection) options.push('collection: true');
      if (!nullable) options.push('nullable: false');
      
      if (options.length > 0) {
        return `        "${propName}": { type: 'enum', target: '${shortName}', ${options.join(', ')} },\n`;
      }
      return `        "${propName}": { type: 'enum', target: '${shortName}' },\n`;
    }

    // Check if complex type
    if (complexTypes.has(resolvedType)) {
      const shortName = getShortName(resolvedType);
      const options: string[] = [];
      if (isCollection) options.push('collection: true');
      if (!nullable) options.push('nullable: false');
      
      if (options.length > 0) {
        return `        "${propName}": { type: 'complex', target: '${shortName}', ${options.join(', ')} },\n`;
      }
      return `        "${propName}": { type: 'complex', target: '${shortName}' },\n`;
    }

    // Check if EntityType (navigation)
    if (includedEntityTypes.has(resolvedType)) {
      const shortName = getShortName(resolvedType);
      const options: string[] = [];
      if (isCollection) options.push('collection: true');
      if (!nullable) options.push('nullable: false');
      
      if (options.length > 0) {
        return `        "${propName}": { type: 'navigation', target: '${shortName}', ${options.join(', ')} },\n`;
      }
      return `        "${propName}": { type: 'navigation', target: '${shortName}' },\n`;
    }

    // Primitive type
    const edmType = resolvedType.startsWith('Edm.') ? resolvedType : `Edm.${resolvedType}`;
    const options: string[] = [];
    if (isCollection) options.push('collection: true');
    if (!nullable) options.push('nullable: false');

    if (options.length > 0) {
      return `        "${propName}": { type: '${edmType}', ${options.join(', ')} },\n`;
    }
    return `        "${propName}": { type: '${edmType}' },\n`;
  }

  // Helper to generate navigation code
  function generateNavigationCode(nav: CsdlNavigationProperty): string {
    const navName = nav['@_Name'];
    const { name: navTargetFQN, isCollection } = resolveType(nav['@_Type']);

    if (!includedEntityTypes.has(navTargetFQN)) {
      return ''; // Skip navigation if target not included
    }

    const targetShortName = getShortName(navTargetFQN);
    return `        "${navName}": { type: 'navigation', target: '${targetShortName}', collection: ${isCollection} },\n`;
  }

  // Helper to generate parameter/return type code
  function generateTypeCode(type: string): string {
    const { name: resolvedType, isCollection } = resolveType(type);

    // Check if enum
    if (enumTypes.has(resolvedType)) {
      const shortName = getShortName(resolvedType);
      if (isCollection) {
        return `{ type: 'enum', target: '${shortName}', collection: true }`;
      }
      return `{ type: 'enum', target: '${shortName}' }`;
    }

    // Check if complex type
    if (complexTypes.has(resolvedType)) {
      const shortName = getShortName(resolvedType);
      if (isCollection) {
        return `{ type: 'complex', target: '${shortName}', collection: true }`;
      }
      return `{ type: 'complex', target: '${shortName}' }`;
    }

    // Check if EntityType
    if (includedEntityTypes.has(resolvedType)) {
      const shortName = getShortName(resolvedType);
      if (isCollection) {
        return `{ type: 'navigation', target: '${shortName}', collection: true }`;
      }
      return `{ type: 'navigation', target: '${shortName}' }`;
    }

    // Primitive type
    const edmType = resolvedType.startsWith('Edm.') ? resolvedType : `Edm.${resolvedType}`;
    if (isCollection) {
      return `{ type: '${edmType}', collection: true }`;
    }
    return `{ type: '${edmType}' }`;
  }

  // ------------------------------------------------------------------------
  // Phase 2.5: Apply selection-mode and mask rules
  // ------------------------------------------------------------------------

  function applyOnlyModeFilters() {
    if (SELECTION_MODE !== 'only') {
      return;
    }

    // Entities: intersect with ONLY_ENTITIES (by set name or short type name)
    if (ONLY_ENTITIES && ONLY_ENTITIES.length > 0) {
      const allowed = new Set(ONLY_ENTITIES);

      // Filter entity sets
      for (const setName of Array.from(includedEntitySets)) {
        const typeFqn = setToTypeMap.get(setName);
        const typeShort = typeFqn ? getShortName(typeFqn) : undefined;
        if (!allowed.has(setName) && (!typeShort || !allowed.has(typeShort))) {
          includedEntitySets.delete(setName);
        }
      }

      // Filter entity types to those whose set (or short name) is allowed
      for (const typeFqn of Array.from(includedEntityTypes)) {
        const shortName = getShortName(typeFqn);
        const setName = typeToSetMap.get(typeFqn);
        if (!setName) {
          // Entity types without a set are only kept if explicitly allowed by short name
          if (!allowed.has(shortName)) {
            includedEntityTypes.delete(typeFqn);
          }
        } else if (!allowed.has(setName) && !allowed.has(shortName)) {
          includedEntityTypes.delete(typeFqn);
        }
      }
    }

    // Bound operations: keep only those explicitly allowed if lists are provided
    if ((ONLY_BOUND_ACTIONS && ONLY_BOUND_ACTIONS.length > 0) ||
        (ONLY_BOUND_FUNCTIONS && ONLY_BOUND_FUNCTIONS.length > 0)) {
      const allowedActions = new Set(ONLY_BOUND_ACTIONS ?? []);
      const allowedFunctions = new Set(ONLY_BOUND_FUNCTIONS ?? []);

      for (const [bindingTypeFQN, ops] of Array.from(boundOperations.entries())) {
        ops.actions = ops.actions.filter(op => allowedActions.size === 0 || allowedActions.has(op.def['@_Name']));
        ops.functions = ops.functions.filter(op => allowedFunctions.size === 0 || allowedFunctions.has(op.def['@_Name']));

        if (ops.actions.length === 0 && ops.functions.length === 0) {
          boundOperations.delete(bindingTypeFQN);
        }
      }
    }

    // Unbound operations: keep only those explicitly allowed
    if (ONLY_UNBOUND_ACTIONS && ONLY_UNBOUND_ACTIONS.length > 0) {
      const allowed = new Set(ONLY_UNBOUND_ACTIONS);
      for (let i = unboundActions.length - 1; i >= 0; i--) {
        const op = unboundActions[i];
        if (!op) continue;
        if (!allowed.has(op.def['@_Name'])) {
          unboundActions.splice(i, 1);
        }
      }
    }
    if (ONLY_UNBOUND_FUNCTIONS && ONLY_UNBOUND_FUNCTIONS.length > 0) {
      const allowed = new Set(ONLY_UNBOUND_FUNCTIONS);
      for (let i = unboundFunctions.length - 1; i >= 0; i--) {
        const op = unboundFunctions[i];
        if (!op) continue;
        if (!allowed.has(op.def['@_Name'])) {
          unboundFunctions.splice(i, 1);
        }
      }
    }
  }

  function applyMaskRules() {
    const mask = MASK;

    const getEntityKeysForBinding = (typeFqn: string): string[] => {
      const shortName = getShortName(typeFqn);
      const setName = typeToSetMap.get(typeFqn);
      const keys = new Set<string>();
      keys.add(shortName);
      keys.add(typeFqn);
      if (setName) keys.add(setName);
      return Array.from(keys);
    };

    // Helper: entity mask
    const isEntityMasked = (setOrTypeName: string): boolean => {
      return mask.entities.some((r) => r.test(setOrTypeName));
    };

    // Helper: bound operation mask
    const isBoundOperationMasked = (op: ProcessedOperation): boolean => {
      if (!op.bindingTypeFQN) return false;
      const typeFqn = op.bindingTypeFQN;
      const shortName = getShortName(typeFqn);
      const setName = typeToSetMap.get(typeFqn);

      const candidateKeys = new Set<string>();
      candidateKeys.add(shortName);
      if (setName) candidateKeys.add(setName);
      candidateKeys.add(typeFqn);

      const rulesMaps =
        op.type === 'Action' ? mask.boundActionsByEntity : mask.boundFunctionsByEntity;

      for (const key of candidateKeys) {
        const rule = rulesMaps.get(key);
        if (!rule) continue;
        if (rule.all) return true;
        if (rule.patterns.some((r) => r.test(op.def['@_Name']))) {
          return true;
        }
      }

      return false;
    };

    // Helper: per-entity only-bound-actions whitelist
    const shouldKeepBoundActionByOnlyList = (op: ProcessedOperation): boolean => {
      if (!op.bindingTypeFQN) return true;
      if (mask.onlyBoundActionsByEntity.size === 0) return true;

      const keys = getEntityKeysForBinding(op.bindingTypeFQN);
      const name = op.def['@_Name'];

      let hasRule = false;
      for (const key of keys) {
        const patterns = mask.onlyBoundActionsByEntity.get(key);
        if (!patterns) continue;
        hasRule = true;
        if (patterns.some((r) => r.test(name))) {
          return true;
        }
      }

      if (hasRule) return false;
      return true;
    };

    // Helper: unbound operation mask
    const isUnboundOperationMasked = (op: ProcessedOperation): boolean => {
      const patterns =
        op.type === 'Action' ? mask.unboundActions : mask.unboundFunctions;
      return patterns.some((r) => r.test(op.def['@_Name']));
    };

    // Mask entities (entity sets and types)
    for (const setName of Array.from(includedEntitySets)) {
      if (isEntityMasked(setName)) {
        includedEntitySets.delete(setName);
        const typeFqn = setToTypeMap.get(setName);
        if (typeFqn) {
          includedEntityTypes.delete(typeFqn);
        }
      }
    }
    for (const typeFqn of Array.from(includedEntityTypes)) {
      const shortName = getShortName(typeFqn);
      if (isEntityMasked(shortName) || isEntityMasked(typeFqn)) {
        includedEntityTypes.delete(typeFqn);
        const setName = typeToSetMap.get(typeFqn);
        if (setName) {
          includedEntitySets.delete(setName);
        }
      }
    }

    // Mask bound operations
    for (const [bindingTypeFQN, ops] of Array.from(boundOperations.entries())) {
      // Apply per-entity only-bound-actions whitelist first
      ops.actions = ops.actions.filter((op) => shouldKeepBoundActionByOnlyList(op));

      // Then apply negative masks
      ops.actions = ops.actions.filter((op) => !isBoundOperationMasked(op));
      ops.functions = ops.functions.filter((op) => !isBoundOperationMasked(op));

      if (ops.actions.length === 0 && ops.functions.length === 0) {
        boundOperations.delete(bindingTypeFQN);
      }
    }

    // Mask unbound operations
    for (let i = unboundActions.length - 1; i >= 0; i--) {
      const op = unboundActions[i];
      if (!op) continue;
      if (isUnboundOperationMasked(op)) {
        unboundActions.splice(i, 1);
      }
    }
    for (let i = unboundFunctions.length - 1; i >= 0; i--) {
      const op = unboundFunctions[i];
      if (!op) continue;
      if (isUnboundOperationMasked(op)) {
        unboundFunctions.splice(i, 1);
      }
    }
  }

  function pruneOperationExpandedEntities() {
    if (WANTED_ENTITIES === 'ALL') {
      return;
    }
    const wantedSet = new Set(WANTED_ENTITIES);

    const isEntityTypeReferencedByOperations = (entityTypeFQN: string): boolean => {
      const direct = boundOperations.get(entityTypeFQN);
      if (direct && (direct.actions.length > 0 || direct.functions.length > 0)) {
        return true;
      }

      const checkOpTypes = (op: ProcessedOperation): boolean => {
        const def = op.def;
        if (def.Parameter) {
          for (const param of def.Parameter) {
            const { name: t } = resolveType(param['@_Type']);
            if (t === entityTypeFQN) return true;
          }
        }
        if (def.ReturnType) {
          const { name: t } = resolveType(def.ReturnType['@_Type']);
          if (t === entityTypeFQN) return true;
        }
        return false;
      };

      for (const [, ops] of boundOperations) {
        for (const op of ops.actions) {
          if (checkOpTypes(op)) return true;
        }
        for (const op of ops.functions) {
          if (checkOpTypes(op)) return true;
        }
      }
      for (const op of unboundActions) {
        if (checkOpTypes(op)) return true;
      }
      for (const op of unboundFunctions) {
        if (checkOpTypes(op)) return true;
      }
      return false;
    };

    for (const setName of Array.from(operationExpandedEntitySets)) {
      if (!includedEntitySets.has(setName)) continue;
      if (wantedSet.has(setName)) continue;
      const typeFqn = setToTypeMap.get(setName);
      if (!typeFqn) continue;
      if (isEntityTypeReferencedByOperations(typeFqn)) continue;

      includedEntitySets.delete(setName);
      includedEntityTypes.delete(typeFqn);
    }
  }

  // Helper to generate operation code
  function generateOperationCode(op: ProcessedOperation, isUnbound = false): string {
    const name = op.def['@_Name'];
    let out = `      "${name}": {\n`;

    if (isUnbound) {
      out += `        type: 'unbound',\n`;
    } else {
      const bindingTypeShortName = op.bindingTypeFQN ? getShortName(op.bindingTypeFQN) : '';
      out += `        type: 'bound',\n`;
      out += `        collection: ${op.isCollectionBound || false},\n`;
      out += `        target: '${bindingTypeShortName}',\n`;
    }

    out += `        parameters: {\n`;
    if (op.def.Parameter) {
      const startIndex = op.isBound ? 1 : 0;
      for (let i = startIndex; i < op.def.Parameter.length; i++) {
        const param = op.def.Parameter[i];
        if (!param) continue;
        const paramName = param['@_Name'];
        const paramTypeCode = generateTypeCode(param['@_Type']);
        out += `          "${paramName}": ${paramTypeCode},\n`;
      }
    }
    out += `        },\n`;

    if (op.def.ReturnType) {
      const returnTypeCode = generateTypeCode(op.def.ReturnType['@_Type']);
      out += `        returnType: ${returnTypeCode},\n`;
    }

    out += `      },\n`;
    return out;
  }

  // Generate schema output
  let out = `import { schema } from "o-data/schema";\n\n`;
  out += `export const ${namespace.replace(/\./g, '_').toLowerCase()}_schema = schema({\n`;
  out += `  namespace: "${namespace}",\n`;
  if (alias) {
    out += `  alias: "${alias}",\n`;
  }

  // Generate enumtypes
  if (includedEnumTypes.size > 0) {
    out += `  enumtypes: {\n`;
    for (const enumFqn of Array.from(includedEnumTypes).sort()) {
      const enumDef = enumTypes.get(enumFqn);
      if (!enumDef) continue;

      const name = getShortName(enumFqn);
      const isFlags = enumDef['@_IsFlags'] === 'true';

      out += `    "${name}": {\n`;
      out += `      isFlags: ${isFlags},\n`;
      out += `      members: {\n`;

      if (enumDef.Member) {
        for (const member of enumDef.Member) {
          const memberName = member['@_Name'];
          const memberValue = member['@_Value'];
          out += `        "${memberName}": ${memberValue},\n`;
        }
      }

      out += `      },\n`;
      out += `    },\n`;
    }
    out += `  },\n`;
  }

  // Generate complextypes
  if (includedComplexTypes.size > 0) {
    out += `  complextypes: {\n`;
    for (const ctFqn of Array.from(includedComplexTypes).sort()) {
      const ct = complexTypes.get(ctFqn);
      if (!ct) continue;

      const name = getShortName(ctFqn);
      out += `    "${name}": {\n`;
      if (ct.Property) {
        for (const prop of ct.Property) {
          if (isExcluded(prop['@_Name'], 'properties')) continue;
          // Properties are directly in complextype (not nested in properties object)
          // Adjust indentation: generatePropertyCode uses 8 spaces, we need 6
          const propCode = generatePropertyCode(prop);
          out += propCode.replace(/^        /, '      ');
        }
      }
      out += `    },\n`;
    }
    out += `  },\n`;
  }

  // Generate entitytypes
  out += `  entitytypes: {\n`;
  for (const entityTypeFQN of Array.from(includedEntityTypes).sort()) {
    const entityType = entityTypes.get(entityTypeFQN);
    if (!entityType) continue;

    const name = getShortName(entityTypeFQN);
    out += `    "${name}": {\n`;

    // Generate baseType if present
    if (entityType['@_BaseType']) {
      const { name: baseTypeFQN } = resolveType(entityType['@_BaseType']);
      const baseTypeShortName = getShortName(baseTypeFQN);
      out += `      baseType: "${baseTypeShortName}",\n`;
    }

    // Generate properties (including navigations)
    out += `      properties: {\n`;

    // Regular properties
    if (entityType.Property) {
      for (const prop of entityType.Property) {
        if (isExcluded(prop['@_Name'], 'properties')) continue;
        out += generatePropertyCode(prop, entityType.Key);
      }
    }

    // Navigation properties
    if (entityType.NavigationProperty) {
      for (const nav of entityType.NavigationProperty) {
        if (isExcluded(nav['@_Name'], 'navigations')) continue;
        out += generateNavigationCode(nav);
      }
    }

    out += `      },\n`;
    out += `    },\n`;
  }
  out += `  },\n`;

  // Generate entitysets
  out += `  entitysets: {\n`;
  for (const setName of Array.from(includedEntitySets).sort()) {
    const typeFqn = setToTypeMap.get(setName);
    if (!typeFqn) continue;

    const entityTypeShortName = getShortName(typeFqn);
    out += `    "${setName}": {\n`;
    out += `      entitytype: "${entityTypeShortName}",\n`;
    out += `    },\n`;
  }
  out += `  },\n`;

  // Generate actions (bound and unbound)
  const allActions: ProcessedOperation[] = [];
  for (const [entityTypeFQN, ops] of boundOperations) {
    allActions.push(...ops.actions);
  }
  allActions.push(...unboundActions);

  if (allActions.length > 0) {
    out += `  actions: {\n`;
    const seenActionNames = new Set<string>();
    for (const op of allActions) {
      const name = op.def['@_Name'];
      // TODO: OData supports operation overloading where the same operation name
      // can be bound to different entity types. Currently we only keep the first
      // occurrence to avoid duplicate keys in the generated schema object.
      // In the future, we should support overloading by changing how operations
      // are keyed (e.g., using a composite key like "${name}_${bindingType}" or
      // restructuring to support multiple operations with the same name).
      if (seenActionNames.has(name)) {
        continue; // Skip duplicate - keep only first occurrence
      }
      seenActionNames.add(name);
      out += generateOperationCode(op, !op.isBound);
    }
    out += `  },\n`;
  }

  // Generate functions (bound and unbound)
  const allFunctions: ProcessedOperation[] = [];
  for (const [entityTypeFQN, ops] of boundOperations) {
    allFunctions.push(...ops.functions);
  }
  allFunctions.push(...unboundFunctions);

  if (allFunctions.length > 0) {
    out += `  functions: {\n`;
    const seenFunctionNames = new Set<string>();
    for (const op of allFunctions) {
      const name = op.def['@_Name'];
      // TODO: OData supports operation overloading where the same operation name
      // can be bound to different entity types. Currently we only keep the first
      // occurrence to avoid duplicate keys in the generated schema object.
      // In the future, we should support overloading by changing how operations
      // are keyed (e.g., using a composite key like "${name}_${bindingType}" or
      // restructuring to support multiple operations with the same name).
      if (seenFunctionNames.has(name)) {
        continue; // Skip duplicate - keep only first occurrence
      }
      seenFunctionNames.add(name);
      out += generateOperationCode(op, !op.isBound);
    }
    out += `  },\n`;
  }

  // Generate actionImports
  if (actionImports.size > 0) {
    out += `  actionImports: {\n`;
    for (const [importName, actionFQN] of Array.from(actionImports.entries()).sort()) {
      const actionShortName = getShortName(actionFQN);
      // Check if action is excluded
      if (isExcluded(actionShortName, 'actions')) {
        continue; // Skip excluded actions
      }
      
      // Check if this action is actually included (bound or unbound)
      const isIncluded = allActions.some(op => op.def['@_Name'] === actionShortName);
      if (!isIncluded) {
        continue; // Skip if action not included
      }
      
      out += `    "${importName}": {\n`;
      out += `      action: "${actionShortName}",\n`;
      out += `    },\n`;
    }
    out += `  },\n`;
  }

  // Generate functionImports
  if (functionImports.size > 0) {
    out += `  functionImports: {\n`;
    for (const [importName, functionFQN] of Array.from(functionImports.entries()).sort()) {
      const functionShortName = getShortName(functionFQN);
      // Check if function is excluded
      if (isExcluded(functionShortName, 'functions')) {
        continue; // Skip excluded functions
      }
      
      // Check if this function is actually included (bound or unbound)
      const isIncluded = allFunctions.some(op => op.def['@_Name'] === functionShortName);
      if (!isIncluded) {
        continue; // Skip if function not included
      }
      
      out += `    "${importName}": {\n`;
      out += `      function: "${functionShortName}",\n`;
      out += `    },\n`;
    }
    out += `  },\n`;
  }

  out += `});\n`;

  const dir = dirname(OUTPUT_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(OUTPUT_FILE, out);
  console.log(`Filtered Schema generated at ${OUTPUT_FILE}`);
  console.log(`Included EntitySets: ${Array.from(includedEntitySets).sort().join(', ')}`);
  console.log(`Included EntityTypes: ${Array.from(includedEntityTypes).map(getShortName).sort().join(', ')}`);
  console.log(`Included ComplexTypes: ${Array.from(includedComplexTypes).map(getShortName).sort().join(', ')}`);
}
