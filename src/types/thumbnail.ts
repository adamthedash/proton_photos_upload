/**
 * Thumbnail Type Definitions
 * 
 * Types for thumbnail generation based on Proton Drive specifications.
 */

/**
 * Thumbnail configuration matching Proton Drive specs
 * 
 * Based on Android Drive implementation:
 * - DEFAULT: 512x512px, max 64 KiB
 * - PHOTO: 1920x1920px, max 1 MiB
 */
export interface ThumbnailConfig {
  maxWidth: number;
  maxHeight: number;
  maxSizeBytes: number;
}

/**
 * Thumbnail type
 * - DEFAULT: Standard thumbnails for files (512x512, 64 KiB)
 * - PHOTO: Photo-specific thumbnails (1920x1920, 1 MiB)
 */
export type ThumbnailType = "DEFAULT" | "PHOTO";

/**
 * Thumbnail configurations
 */
export const THUMBNAIL_CONFIGS: Record<ThumbnailType, ThumbnailConfig> = {
  DEFAULT: {
    maxWidth: 512,
    maxHeight: 512,
    maxSizeBytes: 64 * 1024, // 64 KiB
  },
  PHOTO: {
    maxWidth: 1920,
    maxHeight: 1920,
    maxSizeBytes: 1024 * 1024, // 1 MiB
  },
};

/**
 * Result of thumbnail generation
 */
export interface ThumbnailResult {
  blob: Blob;
  sizeBytes: number;
  width: number;
  height: number;
}

/**
 * JPEG quality levels used for adaptive compression
 * Matching Android implementation
 */
export const JPEG_QUALITY_LEVELS = [
  95, 90, 85, 80, 70, 60, 50, 40, 30, 20, 15, 10, 5, 0,
] as const;
