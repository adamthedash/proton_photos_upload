/**
 * MIME Type Detection Utility
 * 
 * Detects MIME types for supported file formats based on file extension.
 */

export const SUPPORTED_EXTENSIONS = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  mp4: "video/mp4",
} as const;

export type SupportedExtension = keyof typeof SUPPORTED_EXTENSIONS;
export type MimeType = typeof SUPPORTED_EXTENSIONS[SupportedExtension];

/**
 * Extracts the file extension from a file path
 */
export function getFileExtension(filePath: string): string {
  const parts = filePath.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

/**
 * Checks if a file extension is supported
 */
export function isSupportedExtension(
  extension: string,
): extension is SupportedExtension {
  return extension.toLowerCase() in SUPPORTED_EXTENSIONS;
}

/**
 * Gets the MIME type for a file path
 * @throws Error if the file type is not supported
 */
export function getMimeType(filePath: string): MimeType {
  const extension = getFileExtension(filePath);

  if (!extension) {
    throw new Error(
      `No file extension found in path: ${filePath}. Supported types: ${Object.keys(SUPPORTED_EXTENSIONS).join(", ")}`,
    );
  }

  if (!isSupportedExtension(extension)) {
    throw new Error(
      `Unsupported file type: .${extension}. Supported types: ${Object.keys(SUPPORTED_EXTENSIONS).join(", ")}`,
    );
  }

  return SUPPORTED_EXTENSIONS[extension];
}

/**
 * Checks if a file is an image type
 */
export function isImageType(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

/**
 * Checks if a file is a video type
 */
export function isVideoType(mimeType: string): boolean {
  return mimeType.startsWith("video/");
}
