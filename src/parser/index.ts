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
  wantedEntities: string[];
  wantedActions: string[];
  wantedFunctions: string[];
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
      wantedActions: config.wantedActions || [],
      wantedFunctions: config.wantedFunctions || [],
      excludeFilters: normalizeExcludeFilters(config.excludeFilters),
    };
  } catch (error) {
    console.error(`Error loading config file: ${error}`);
    process.exit(1);
  }
}

// Load config at module level
let INPUT_FILE: string;
let OUTPUT_FILE: string;
let WANTED_ENTITIES: string[];
let WANTED_ACTIONS: string[];
let WANTED_FUNCTIONS: string[];
let EXCLUDE_FILTERS: NormalizedExcludeFilters;

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
  bindingType?: string;
  isCollectionBound?: boolean;
}

// ----------------------------------------------------------------------------
// Main Conversion Logic
// ----------------------------------------------------------------------------

async function main() {
  // Load configuration
  const config = await loadConfig();
  INPUT_FILE = config.inputFile;
  OUTPUT_FILE = config.outputFile;
  WANTED_ENTITIES = config.wantedEntities;
  WANTED_ACTIONS = config.wantedActions;
  WANTED_FUNCTIONS = config.wantedFunctions;
  EXCLUDE_FILTERS = config.excludeFilters;

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
  const alias = mainSchema['@_Alias'];

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
  // Step 1: Indexing Everything
  // --------------------------------------------------------------------------
  const typeToSetMap = new Map<string, string>(); // EntityType FQN -> EntitySet Name
  const setBaseTypeMap = new Map<string, string>(); // SetName -> ParentSetName
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
    }

    for (const set of entityContainer.EntitySet) {
      const setName = set['@_Name'];
      const typeFqn = set['@_EntityType'];
      const entity = entityTypes.get(typeFqn);
      if (entity && entity['@_BaseType']) {
        // FIX: Resolve Alias for BaseType before lookup
        const { name: baseTypeName } = resolveType(entity['@_BaseType']);
        const parentSet = typeToSetMap.get(baseTypeName);
        if (parentSet) setBaseTypeMap.set(setName, parentSet);
      }
    }
  }

  // Parse FunctionImport and ActionImport to determine which operations can use unqualified names
  const functionImports = new Set<string>(); // Stores FQN of functions that are imports
  const actionImports = new Set<string>(); // Stores FQN of actions that are imports

  if (entityContainer) {
    // Parse FunctionImports
    if (entityContainer.FunctionImport) {
      for (const fi of entityContainer.FunctionImport) {
        const functionFqn = fi['@_Function'];
        // Resolve alias if present
        const { name: resolvedFqn } = resolveType(functionFqn);
        functionImports.add(resolvedFqn);
      }
    }

    // Parse ActionImports
    if (entityContainer.ActionImport) {
      for (const ai of entityContainer.ActionImport) {
        const actionFqn = ai['@_Action'];
        // Resolve alias if present
        const { name: resolvedFqn } = resolveType(actionFqn);
        actionImports.add(resolvedFqn);
      }
    }
  }

  // --------------------------------------------------------------------------
  // GLOBAL LISTS
  // --------------------------------------------------------------------------
  const includedSets = new Set<string>(WANTED_ENTITIES);
  const includedComplexTypes = new Set<string>();
  const includedEnumTypes = new Set<string>();

  // Helpers for logic
  const isPrimitive = (type: string) => {
    if (type.startsWith('Edm.')) return true;
    // Check if it's an enum type
    const { name: resolvedType } = resolveType(type);
    return enumTypes.has(resolvedType) || enumTypes.has(type);
  };
  const isKnownSet = (type: string) => {
    const setName = typeToSetMap.get(type);
    return setName && includedSets.has(setName);
  };
  const isComplex = (type: string) =>
    complexTypes.has(type) || (entityTypes.has(type) && !typeToSetMap.has(type));

  // --------------------------------------------------------------------------
  // PHASE 1: LOCK DOWN CORE SCHEMA (WANTED Entities & Actions)
  // --------------------------------------------------------------------------
  const allOperations = [...(mainSchema.Action || []), ...(mainSchema.Function || [])];

  // 1a. Hard dependencies from WANTED_ACTIONS and WANTED_FUNCTIONS
  if (WANTED_ACTIONS.length > 0 || WANTED_FUNCTIONS.length > 0) {
    for (const op of allOperations) {
      if (WANTED_ACTIONS.includes(op['@_Name']) || WANTED_FUNCTIONS.includes(op['@_Name'])) {
        const params = op.Parameter || [];
        if (op.ReturnType) params.push({ '@_Name': 'Return', '@_Type': op.ReturnType['@_Type'] });

        for (const p of params) {
          const { name: clean } = resolveType(p['@_Type']);
          if (isPrimitive(clean)) continue;

          const setName = typeToSetMap.get(clean);
          if (setName) {
            if (!isExcluded(setName, 'entities')) {
              includedSets.add(setName);
            }
          } else if (isComplex(clean)) {
            if (!isExcluded(clean, 'complexTypes')) {
              includedComplexTypes.add(clean);
            }
          }
        }
      }
    }
  }

  // 1b. Resolve Inheritance for Included Sets
  let setChanged = true;
  while (setChanged) {
    setChanged = false;
    for (const setName of includedSets) {
      const parent = setBaseTypeMap.get(setName);
      if (parent && !includedSets.has(parent) && !isExcluded(parent, 'entities')) {
        includedSets.add(parent);
        setChanged = true;
      }
    }
  }

  // 1c. Resolve ComplexType dependencies (initial pass)
  resolveComplexDependencies();

  // --------------------------------------------------------------------------
  // PHASE 2: DISCOVER COMPATIBLE ACTIONS
  // --------------------------------------------------------------------------
  const boundOperations = new Map<
    string,
    { actions: ProcessedOperation[]; functions: ProcessedOperation[] }
  >();
  const rootActions: ProcessedOperation[] = [];
  const rootFunctions: ProcessedOperation[] = [];

  const processList = (list: CsdlActionOrFunction[], type: 'Action' | 'Function') => {
    for (const op of list) {
      const name = op['@_Name'];
      const isExplicitlyWanted =
        (type === 'Action' && WANTED_ACTIONS.includes(name)) ||
        (type === 'Function' && WANTED_FUNCTIONS.includes(name));
      const isBound = op['@_IsBound'] === 'true';
      const category = type === 'Action' ? 'actions' : 'functions';

      let keep = false;
      let bindTypeClean = '';
      let isCollectionBound = false;

      // Check 1: Explicitly Wanted (Overrides exclusion)
      if (isExplicitlyWanted) {
        keep = true;
      } else if (isExcluded(name, category)) {
        continue;
      }

      // Check 2: Pure Primitive (Unbound)
      if (!keep && !isBound) {
        if (checkAllPrimitives(op)) keep = true;
      }

      // Check 3: Bound & Safe
      if (!keep && isBound && op.Parameter && op.Parameter.length > 0) {
        const bindingParam = op.Parameter[0];
        if (bindingParam) {
          const resolvedBind = resolveType(bindingParam['@_Type']);
          bindTypeClean = resolvedBind.name;
          isCollectionBound = resolvedBind.isCollection;
        }

        if (bindTypeClean && isKnownSet(bindTypeClean)) {
          if (checkCompatibility(op)) {
            keep = true;
          }
        }
      }

      if (keep) {
        registerComplexDependencies(op);

        const processed: ProcessedOperation = { def: op, type, isBound };
        if (isBound && bindTypeClean) {
          processed.bindingType = bindTypeClean;
          processed.isCollectionBound = isCollectionBound;

          if (!boundOperations.has(bindTypeClean)) {
            boundOperations.set(bindTypeClean, { actions: [], functions: [] });
          }
          const group = boundOperations.get(bindTypeClean)!;
          if (type === 'Action') group.actions.push(processed);
          else group.functions.push(processed);
        } else {
          if (type === 'Action') rootActions.push(processed);
          else rootFunctions.push(processed);
        }
      }
    }
  };

  processList(mainSchema.Action || [], 'Action');
  processList(mainSchema.Function || [], 'Function');

  resolveComplexDependencies();

  // --------------------------------------------------------------------------
  // LOGIC HELPERS
  // --------------------------------------------------------------------------

  function checkAllPrimitives(op: CsdlActionOrFunction): boolean {
    if (op.Parameter) {
      for (const p of op.Parameter) {
        const { name } = resolveType(p['@_Type']);
        if (!isPrimitive(name)) return false;
      }
    }
    if (op.ReturnType) {
      const { name } = resolveType(op.ReturnType['@_Type']);
      if (!isPrimitive(name)) return false;
    }
    return true;
  }

  function checkCompatibility(op: CsdlActionOrFunction): boolean {
    const startIndex = op['@_IsBound'] === 'true' ? 1 : 0;
    if (op.Parameter) {
      for (let i = startIndex; i < op.Parameter.length; i++) {
        const param = op.Parameter[i];
        if (!param) continue;
        const { name } = resolveType(param['@_Type']);
        if (isPrimitive(name)) continue;
        if (isKnownSet(name)) continue;
        if (isComplex(name) && !isExcluded(name, 'complexTypes')) continue;
        return false;
      }
    }
    if (op.ReturnType) {
      const { name } = resolveType(op.ReturnType['@_Type']);
      if (
        !isPrimitive(name) &&
        !isKnownSet(name) &&
        !(isComplex(name) && !isExcluded(name, 'complexTypes'))
      ) {
        return false;
      }
    }
    return true;
  }

  function registerComplexDependencies(op: CsdlActionOrFunction) {
    const scan = (rawType: string) => {
      const { name } = resolveType(rawType);
      if (isPrimitive(name)) return;
      if (isKnownSet(name)) return;
      if (isComplex(name) && !isExcluded(name, 'complexTypes')) includedComplexTypes.add(name);
    };

    if (op.Parameter) {
      for (const p of op.Parameter) scan(p['@_Type']);
    }
    if (op.ReturnType) {
      scan(op.ReturnType['@_Type']);
    }
  }

  function resolveComplexDependencies() {
    let changed = true;
    while (changed) {
      changed = false;
      for (const ctFqn of includedComplexTypes) {
        let props: CsdlProperty[] = [];
        if (complexTypes.has(ctFqn)) props = complexTypes.get(ctFqn)!.Property || [];
        else if (entityTypes.has(ctFqn)) props = entityTypes.get(ctFqn)!.Property || [];

        for (const p of props) {
          const { name: clean } = resolveType(p['@_Type']);
          if (!isPrimitive(clean)) {
            if (
              isComplex(clean) &&
              !includedComplexTypes.has(clean) &&
              !isExcluded(clean, 'complexTypes')
            ) {
              includedComplexTypes.add(clean);
              changed = true;
            }
          }
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // Step 3: Index Bindings for Included Sets
  // --------------------------------------------------------------------------
  const setToBindingsMap = new Map<string, Map<string, string>>();
  if (entityContainer && entityContainer.EntitySet) {
    for (const set of entityContainer.EntitySet) {
      if (!includedSets.has(set['@_Name'])) continue;
      const bindings = new Map<string, string>();
      if (set.NavigationPropertyBinding) {
        for (const binding of set.NavigationPropertyBinding) {
          bindings.set(binding['@_Path'], binding['@_Target']);
        }
      }
      setToBindingsMap.set(set['@_Name'], bindings);
    }
  }

  // --------------------------------------------------------------------------
  // Step 4: Generate Output
  // --------------------------------------------------------------------------
  let out = `import { schema, property } from "o-data/schema";\n\n`;
  out += `export const ${namespace.replace(/\./g, '_').toLowerCase()}_schema = schema({\n`;
  out += `  namespace: "${namespace}",\n`;

  // --- Complex Types ---
  out += `  complexTypes: {\n`;
  for (const ctFqn of includedComplexTypes) {
    const name = ctFqn.split('.').pop()!;
    let props: CsdlProperty[] = [];

    if (complexTypes.has(ctFqn)) props = complexTypes.get(ctFqn)!.Property || [];
    else if (entityTypes.has(ctFqn)) props = entityTypes.get(ctFqn)!.Property || [];

    out += `    "${name}": {\n`;
    out += `      properties: {\n`;
    for (const prop of props) {
      if (isExcluded(prop['@_Name'], 'properties')) continue;
      out += generatePropertyLine(prop, typeToSetMap, includedSets, includedComplexTypes, enumTypes, includedEnumTypes, resolveType);
    }
    out += `      },\n`;
    out += `    },\n`;
  }
  out += `  },\n`;

  // --- Enum Types ---
  out += `  enumTypes: {\n`;
  for (const enumFqn of includedEnumTypes) {
    const enumDef = enumTypes.get(enumFqn);
    if (!enumDef) continue;
    
    const name = enumFqn.split('.').pop()!;
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

  // --- Entity Sets ---
  out += `  entitysets: {\n`;
  if (entityContainer && entityContainer.EntitySet) {
    for (const set of entityContainer.EntitySet) {
      const setName = set['@_Name'];
      if (!includedSets.has(setName)) continue;

      const typeFqn = set['@_EntityType'];
      const entity = entityTypes.get(typeFqn);
      if (!entity) continue;

      out += `    "${setName}": {\n`;

      if (entity['@_BaseType']) {
        // FIX: Resolve Alias for BaseType in generation
        const { name: baseTypeName } = resolveType(entity['@_BaseType']);
        const parentSet = typeToSetMap.get(baseTypeName);
        if (parentSet) out += `      baseType: "${parentSet}",\n`;
      }

      out += `      properties: {\n`;
      if (entity.Property) {
        for (const prop of entity.Property) {
          if (isExcluded(prop['@_Name'], 'properties')) continue;
          out += generatePropertyLine(
            prop,
            typeToSetMap,
            includedSets,
            includedComplexTypes,
            enumTypes,
            includedEnumTypes,
            resolveType,
            entity.Key
          );
        }
      }
      out += `      },\n`;

      out += `      navigations: {\n`;
      if (entity.NavigationProperty) {
        const bindings = setToBindingsMap.get(setName) || new Map();
        for (const nav of entity.NavigationProperty) {
          const navName = nav['@_Name'];
          if (isExcluded(navName, 'navigations')) continue;

          const targetSet = bindings.get(navName);
          if (targetSet && includedSets.has(targetSet)) {
            const { isCollection } = resolveType(nav['@_Type']);
            out += `        "${navName}": { target: "${targetSet}", collection: ${isCollection} },\n`;
          }
        }
      }
      out += `      },\n`;

      const ops = boundOperations.get(typeFqn);

      out += `      actions: {\n`;
      if (ops && ops.actions.length > 0) {
        for (const op of ops.actions)
          out += generateOperationCode(op, typeToSetMap, includedSets, includedComplexTypes, enumTypes, includedEnumTypes, resolveType);
      }
      out += `      },\n`;

      out += `      functions: {\n`;
      if (ops && ops.functions.length > 0) {
        for (const op of ops.functions)
          out += generateOperationCode(op, typeToSetMap, includedSets, includedComplexTypes, enumTypes, includedEnumTypes, resolveType);
      }
      out += `      },\n`;

      out += `    },\n`;
    }
  }
  out += `  },\n`;

  // Root Actions
  out += `  actions: {\n`;
  for (const op of rootActions) {
    const opFqn = `${namespace}.${op.def['@_Name']}`;
    const isImport = actionImports.has(opFqn);
    out += generateOperationCode(op, typeToSetMap, includedSets, includedComplexTypes, enumTypes, includedEnumTypes, resolveType, true, isImport);
  }
  out += `  },\n`;

  // Root Functions
  out += `  functions: {\n`;
  for (const op of rootFunctions) {
    const opFqn = `${namespace}.${op.def['@_Name']}`;
    const isImport = functionImports.has(opFqn);
    out += generateOperationCode(op, typeToSetMap, includedSets, includedComplexTypes, enumTypes, includedEnumTypes, resolveType, true, isImport);
  }
  out += `  },\n`;

  out += `});\n`;

  const dir = dirname(OUTPUT_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(OUTPUT_FILE, out);
  console.log(`Filtered Schema generated at ${OUTPUT_FILE}`);
  console.log(`Included Entities: ${Array.from(includedSets).sort().join(', ')}`);
  console.log(`Included ComplexTypes: ${Array.from(includedComplexTypes).sort().join(', ')}`);
}

// ----------------------------------------------------------------------------
// Code Generation Helpers
// ----------------------------------------------------------------------------

function generateOperationCode(
  op: ProcessedOperation,
  typeMap: Map<string, string>,
  validSets: Set<string>,
  includedComplexTypes: Set<string>,
  enumTypesMap: Map<string, CsdlEnumType>,
  includedEnumTypes: Set<string>,
  resolveTypeFn: (rawType: string) => { name: string; isCollection: boolean; original: string },
  isRoot = false,
  isImport = false
): string {
  const name = op.def['@_Name'];
  let out = `        "${name}": {\n`;

  if (isRoot) {
    // If it's an import, useSchemaFQN: false (can use unqualified name)
    // If it's NOT an import, useSchemaFQN: true (must use FQN)
    out += `          useSchemaFQN: ${!isImport},\n`;
  } else {
    out += `          scope: "${op.isCollectionBound ? 'collection' : 'entity'}",\n`;
  }

  out += `          parameters: {\n`;
  if (op.def.Parameter) {
    const startIndex = op.isBound ? 1 : 0;
    for (let i = startIndex; i < op.def.Parameter.length; i++) {
      const p = op.def.Parameter[i];
      out += generateParameterLine(p, typeMap, validSets, includedComplexTypes, enumTypesMap, includedEnumTypes, resolveTypeFn);
    }
  }
  out += `          },\n`;

  if (op.def.ReturnType) {
    out += `          returnType: ${generateReturnTypeCode(
      op.def.ReturnType['@_Type'],
      typeMap,
      validSets,
      includedComplexTypes,
      enumTypesMap,
      includedEnumTypes,
      resolveTypeFn
    )},\n`;
  }
  out += `        },\n`;
  return out;
}

function generatePropertyLine(
  prop: CsdlProperty,
  typeMap: Map<string, string>,
  validSets: Set<string>,
  includedComplexTypes: Set<string>,
  enumTypesMap: Map<string, CsdlEnumType>,
  includedEnumTypes: Set<string>,
  resolveTypeFn: (rawType: string) => { name: string; isCollection: boolean; original: string },
  key?: CsdlKey
): string {
  const propName = prop['@_Name'];
  if (propName.startsWith('_')) return '';

  const isKey =
    key &&
    (Array.isArray(key.PropertyRef)
      ? key.PropertyRef.some((r) => r['@_Name'] === propName)
      : key.PropertyRef['@_Name'] === propName);

  if (isKey) {
    return `        "${propName}": property("key", { readonly: true }),\n`;
  } else {
    return generateParameterLine(prop, typeMap, validSets, includedComplexTypes, enumTypesMap, includedEnumTypes, resolveTypeFn);
  }
}

function generateParameterLine(
  p: any,
  typeMap: Map<string, string>,
  validSets: Set<string>,
  includedComplexTypes: Set<string>,
  enumTypesMap: Map<string, CsdlEnumType>,
  includedEnumTypes: Set<string>,
  resolveTypeFn: (rawType: string) => { name: string; isCollection: boolean; original: string }
): string {
  const pName = p['@_Name'];
  const pType = p['@_Type'];

  let isCollection = false;
  let clean = pType;
  if (clean.startsWith('Collection(')) {
    isCollection = true;
    clean = clean.match(/Collection\((.*?)\)/)?.[1] || clean;
  }

  // Resolve alias and check for enum
  const { name: resolvedType } = resolveTypeFn(clean);
  const isEnum = enumTypesMap.has(resolvedType) || enumTypesMap.has(clean);
  
  if (isEnum) {
    const shortName = clean.split('.').pop()!;
    // Track this enum type
    includedEnumTypes.add(resolvedType);
    
    const options: string[] = [];
    if (isCollection) options.push('collection: true');
    if (p['@_Nullable'] === 'false') options.push('nullable: false');
    
    if (options.length > 0) {
      return `        "${pName}": property("enum", { enum: "${shortName}", ${options.join(', ')} }),\n`;
    } else {
      return `        "${pName}": property("enum", { enum: "${shortName}" }),\n`;
    }
  }

  const typeStr = mapType(pType, enumTypesMap, resolveTypeFn);
  const options: string[] = [];
  if (isCollection) options.push('collection: true');
  if (p['@_Nullable'] === 'false') options.push('nullable: false');

  if (typeStr === 'complex') {
    const shortName = clean.split('.').pop()!;
    let targetSet = '';
    for (const [fqn, setName] of typeMap.entries()) {
      if (fqn.endsWith(`.${shortName}`)) {
        targetSet = setName;
        break;
      }
    }

    if (targetSet && validSets.has(targetSet)) {
      return `        "${pName}": { target: "${targetSet}", collection: ${isCollection} },\n`;
    }
    
    // CHECK FOR COMPLEX TYPE
    for (const ctFqn of includedComplexTypes) {
      if (ctFqn.endsWith(`.${shortName}`) || ctFqn === resolvedType) {
        if (isCollection) {
          return `        "${pName}": property("complex", { target: "${shortName}", collection: true }),\n`;
        }
        return `        "${pName}": property("complex", { target: "${shortName}" }),\n`;
      }
    }
    
    return `        "${pName}": property("any" as any, { ${options.join(
      ', '
    )} }), // ${shortName}\n`;
  }

  if (options.length > 0) {
    return `        "${pName}": property("${typeStr}", { ${options.join(', ')} }),\n`;
  } else {
    return `        "${pName}": property("${typeStr}"),\n`;
  }
}

function generateReturnTypeCode(
  type: string,
  typeMap: Map<string, string>,
  validSets: Set<string>,
  includedComplexTypes: Set<string>,
  enumTypesMap: Map<string, CsdlEnumType>,
  includedEnumTypes: Set<string>,
  resolveTypeFn: (rawType: string) => { name: string; isCollection: boolean; original: string }
): string {
  let isCollection = false;
  let clean = type;

  if (clean.startsWith('Collection(')) {
    isCollection = true;
    clean = clean.match(/Collection\((.*?)\)/)?.[1] || clean;
  }

  // Check for enum type
  const { name: resolvedType } = resolveTypeFn(clean);
  const isEnum = enumTypesMap.has(resolvedType) || enumTypesMap.has(clean);
  
  if (isEnum) {
    const shortName = clean.split('.').pop()!;
    includedEnumTypes.add(resolvedType);
    
    if (isCollection) {
      return `property("enum", { enum: "${shortName}", collection: true })`;
    }
    return `property("enum", { enum: "${shortName}" })`;
  }

  if (clean.startsWith('Edm.')) {
    const typeStr = mapType(clean, enumTypesMap, resolveTypeFn);
    const options: string[] = [];
    if (isCollection) options.push('collection: true');

    if (options.length > 0) {
      return `property("${typeStr}", { ${options.join(', ')} })`;
    }
    return `property("${typeStr}")`;
  }

  const shortName = clean.split('.').pop()!;
  let targetSet = '';
  for (const [fqn, setName] of typeMap.entries()) {
    if (fqn.endsWith(`.${shortName}`)) {
      targetSet = setName;
      break;
    }
  }

  if (targetSet && validSets.has(targetSet)) {
    return `{ target: "${targetSet}", collection: ${isCollection} }`;
  }

  // CHECK FOR COMPLEX TYPE
  for (const ctFqn of includedComplexTypes) {
    if (ctFqn.endsWith(`.${shortName}`) || ctFqn === clean) {
      if (isCollection) {
        return `property("complex", { target: "${shortName}", collection: true })`;
      }
      return `property("complex", { target: "${shortName}" })`;
    }
  }

  return `property("any" as any, { collection: ${isCollection} }) /* ${shortName} */`;
}

function mapType(edmType: string, enumTypesMap?: Map<string, CsdlEnumType>, resolveTypeFn?: (rawType: string) => { name: string; isCollection: boolean; original: string }): string {
  let type = edmType;
  if (type.startsWith('Collection(')) {
    type = type.match(/Collection\((.*?)\)/)?.[1] || type;
  }
  if (type.startsWith('Edm.')) type = type.substring(4);

  // Check if it's an enum type
  if (enumTypesMap && resolveTypeFn) {
    const { name: resolvedType } = resolveTypeFn(type);
    if (enumTypesMap.has(resolvedType) || enumTypesMap.has(type)) {
      return 'enum';
    }
  }

  switch (type) {
    case 'String':
      return 'string';
    case 'Int32':
    case 'Int16':
    case 'Int64':
    case 'Decimal':
    case 'Double':
    case 'Single':
      return 'number';
    case 'Boolean':
      return 'boolean';
    case 'DateTimeOffset':
      return 'datetimeoffset';
    case 'Date':
      return 'date';
    case 'TimeOfDay':
      return 'time';
    case 'Guid':
      return 'guid';
    case 'Binary':
      return 'binary';
    default:
      return 'complex';
  }
}

main().catch(console.error);
