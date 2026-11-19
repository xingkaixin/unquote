export const copyRecordLimit = 5000;

export const copyBytesLimit = 20_000_000;

export const isCopyRecordCountAboveThreshold = (recordCount: number) =>
  recordCount > copyRecordLimit;

export const normalizedByteLimit = (byteLimit: number) =>
  Number.isFinite(byteLimit)
    ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(byteLimit)))
    : 0;

export const utf8ByteLengthWithin = (value: string, byteLimit: number) => {
  let byteLength = 0;
  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);
    let width = first <= 0x7f ? 1 : first <= 0x7ff ? 2 : 3;
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = value.charCodeAt(index + 1);
      if (second >= 0xdc00 && second <= 0xdfff) {
        width = 4;
        index += 1;
      }
    }
    byteLength += width;
    if (byteLength > byteLimit) {
      return null;
    }
  }
  return byteLength;
};

export const isCopyTextAboveThreshold = (text: string, byteLimit = copyBytesLimit) =>
  utf8ByteLengthWithin(text, normalizedByteLimit(byteLimit)) === null;
