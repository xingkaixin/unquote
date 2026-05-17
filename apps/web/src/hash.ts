import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";

export const HASH_PREFIX = "#data=";
export const HASH_LIMIT = 4 * 1024;
export const HASH_RAW_INPUT_LIMIT = HASH_LIMIT * 16;

export const getInitialInputFromHash = (
  hash: string,
  decompress = decompressFromEncodedURIComponent,
) => {
  if (!hash.startsWith(HASH_PREFIX)) {
    return "";
  }

  const encoded = hash.slice(HASH_PREFIX.length);
  return decompress(encoded) ?? "";
};

export const createSourceHash = (value: string, compress = compressToEncodedURIComponent) => {
  if (!value.trim() || value.length > HASH_RAW_INPUT_LIMIT) {
    return null;
  }

  const compressed = compress(value);
  return compressed && compressed.length <= HASH_LIMIT ? `${HASH_PREFIX}${compressed}` : null;
};
