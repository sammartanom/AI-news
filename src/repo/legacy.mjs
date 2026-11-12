import { collectionName } from '../lib/taxonomy.mjs';

// resources.audience and resources.collection_name come from the first schema. They hold the
// primary value for human readability only; every read uses the JSON array columns.
export function legacyColumns(audiences, collections) {
  return {
    audience: audiences[0] ?? 'Everyone',
    collection_name: collections[0] ? collectionName(collections[0]) : 'Other'
  };
}
