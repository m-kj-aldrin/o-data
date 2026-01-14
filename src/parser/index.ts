import { XMLParser } from 'fast-xml-parser';
import * as fs from 'fs';
import path, { dirname } from 'path';
import type { ParserConfig, ExcludeFilters } from './config';

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

async function loadConfig(): Promise<{
  inputFile: string;
  outputFile: string;
  wantedEntities: string[] | 'ALL';
  wantedUnboundActions: string[] | 'ALL' | undefined;
  wantedUnboundFunctions: string[] | 'ALL' | undefined;
  excludeFilters: NormalizedExcludeFilters;
}> {
  const configPathArg = process.argv[2];
  let configPath: string | null = null;

  // Check for config path in first CLI arg
  if (configPathArg) {
    const root = process.cwd();
    configPath = path.isAbsolute(configPathArg) ? configPathArg : path.join(root, configPathArg);
    if (!fs.existsSync(configPath)) {
      console.error(`Config file not found: ${configPath}`);
      process.exit(1);
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
    console.error('Usage: generate-schema [<path-to-config-file>]');
    console.error('  Config file not found. Either provide a path or create odata-parser.config.ts in the current directory');
    process.exit(1);
  }

  // Load config
  try {
    const configModule = await import(configPath);
    const config: ParserConfig = configModule.default || configModule;
    
    if (!config.inputPath || !config.outputPath) {
      console.error('Config must specify inputPath and outputPath');
      process.exit(1);
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
    };
  } catch (error) {
    console.error(`Error loading config file: ${error}`);
    process.exit(1);
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

async function main() {
  // Load configuration
  const config = await loadConfig();
  const INPUT_FILE = config.inputFile;
  const OUTPUT_FILE = config.outputFile;
  const WANTED_ENTITIES = config.wantedEntities;
  const WANTED_UNBOUND_ACTIONS = config.wantedUnboundActions;
  const WANTED_UNBOUND_FUNCTIONS = config.wantedUnboundFunctions;
  const EXCLUDE_FILTERS = config.excludeFilters;

  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`Input file not found: ${INPUT_FILE}`);
    process.exit(1);
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
    console.error('No schema found');
    process.exit(1);
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

  function extractTypeDependencies(typeFQN: string, isCollection: boolean) {
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
            extractTypeDependencies(prop['@_Type'], false);
          }
        }
      }
      return;
    }

    // Check if EntityType - if so, include it and its EntitySet
    if (entityTypes.has(resolvedType)) {
      const entitySetName = typeToSetMap.get(resolvedType);
      if (entitySetName && !isExcluded(entitySetName, 'entities')) {
        // Add EntitySet if not already included
        if (!includedEntitySets.has(entitySetName)) {
          includedEntitySets.add(entitySetName);
        }
        // Add EntityType and resolve baseType chain
        if (!includedEntityTypes.has(resolvedType)) {
          resolveBaseTypeChain(resolvedType);
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
        extractTypeDependencies(prop['@_Type'], false);
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
        extractTypeDependencies(param['@_Type'], false);
      }
    }
    if (op.ReturnType) {
      extractTypeDependencies(op.ReturnType['@_Type'], false);
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

          if (includedEntityTypes.has(bindingTypeFQN) && !isExcluded(op['@_Name'], 'actions')) {
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

          if (includedEntityTypes.has(bindingTypeFQN) && !isExcluded(op['@_Name'], 'functions')) {
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
    for (const op of allActions) {
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
    for (const op of allFunctions) {
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

main().catch(console.error);
