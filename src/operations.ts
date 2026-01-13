// ============================================================================
// Operation Types
// ============================================================================

import type { QueryableEntity } from './types';
import type { Schema, ODataType } from './schema';

// Create object - all properties optional except required ones
export type CreateObject<QE extends QueryableEntity> = {
  [K in keyof QE['properties']]?: any;
};

// Update object - all properties optional
export type UpdateObject<QE extends QueryableEntity> = {
  [K in keyof QE['properties']]?: any;
};

// Create operation options
export type CreateOperationOptions<QE extends QueryableEntity> = {
  prefer?: {
    return_representation?: boolean;
  };
  select?: readonly (keyof QE['properties'])[];
  headers?: Record<string, string>;
};

// Update operation options
export type UpdateOperationOptions<QE extends QueryableEntity> = {
  prefer?: {
    return_representation?: boolean;
  };
  select?: readonly (keyof QE['properties'])[];
  headers?: Record<string, string>;
};

// Operation parameters - convert ODataType to TypeScript types
export type OperationParameters<S extends Schema<S>, P extends Record<string, ODataType<any>>> = {
  [K in keyof P]: any; // Will be properly typed later based on ODataType
};
