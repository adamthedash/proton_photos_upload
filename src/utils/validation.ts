/**
 * File Validation Utility
 * 
 * Validates file paths and extensions against supported types.
 */

import { existsSync, statSync } from "fs";
import { getMimeType, isSupportedExtension, getFileExtension } from "./mime.js";

/**
 * Validates that a file exists and is supported
 * @throws Error if file doesn't exist or is not supported
 */
export function validateFile(filePath: string): void {
  // Check if file exists
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  // Check if it's actually a file (not a directory)
  const stats = statSync(filePath);
  if (!stats.isFile()) {
    throw new Error(`Path is not a file: ${filePath}`);
  }

  // Check if file extension is supported
  const extension = getFileExtension(filePath);
  if (!extension) {
    throw new Error(`No file extension found: ${filePath}`);
  }

  if (!isSupportedExtension(extension)) {
    throw new Error(
      `Unsupported file type: .${extension}. Supported types: jpg, jpeg, png, mp4`,
    );
  }
}

/**
 * Validates a file and returns its MIME type
 * @throws Error if file is invalid or unsupported
 */
export function validateAndGetMimeType(filePath: string): string {
  validateFile(filePath);
  return getMimeType(filePath);
}
