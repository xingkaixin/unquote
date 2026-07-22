const fileSizeUnits = ["B", "KB", "MB", "GB"] as const;

export const formatFileSize = (bytes: number) => {
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < fileSizeUnits.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const formatted = unitIndex === 0 || value >= 10 ? String(Math.round(value)) : value.toFixed(1);
  return `${formatted} ${fileSizeUnits[unitIndex]}`;
};
