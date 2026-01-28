/**
 * Thumbnail Type Definitions
 * 
 * Types for thumbnail generation based on Proton Drive specifications.
 */

import type { Thumbnail } from "@protontech/drive-sdk";
import { ThumbnailType as ProtonThumbnailType } from "@protontech/drive-sdk";

// Re-export Proton SDK types for use in other files
export type { Thumbnail } from "@protontech/drive-sdk";
export { ThumbnailType as ProtonThumbnailType } from "@protontech/drive-sdk";

/**
 * Thumbnail configuration matching Proton Drive specs
 * 
 * Based on Android Drive implementation:
 * - DEFAULT: 512x512px, max 64 KiB (maps to ProtonThumbnailType.Type1)
 * - PHOTO: 1920x1920px, max 1 MiB (maps to ProtonThumbnailType.Type2)
 */
export interface ThumbnailConfig {
  maxWidth: number;
  maxHeight: number;
  maxSizeBytes: number;
  protonType: ProtonThumbnailType;
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
    protonType: ProtonThumbnailType.Type1,
  },
  PHOTO: {
    maxWidth: 1920,
    maxHeight: 1920,
    maxSizeBytes: 1024 * 1024, // 1 MiB
    protonType: ProtonThumbnailType.Type2,
  },
};

/**
 * Result of thumbnail generation
 */
export interface ThumbnailResult {
  data: Uint8Array;
  sizeBytes: number;
  width: number;
  height: number;
  protonType: ProtonThumbnailType;
}

/**
 * JPEG quality levels used for adaptive compression
 * Matching Android implementation
 */
export const JPEG_QUALITY_LEVELS = [
  95, 90, 85, 80, 70, 60, 50, 40, 30, 20, 15, 10, 5, 0,
] as const;
