/**
 * Thumbnail Generation Utility
 * 
 * Generates thumbnails for images and videos following Proton Drive specifications.
 * Based on Android Drive implementation.
 */

import sharp from "sharp";
import ffmpeg from "fluent-ffmpeg";
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import { readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { isImageType, isVideoType } from "./mime.js";
import {
  THUMBNAIL_CONFIGS,
  ThumbnailType,
  ThumbnailResult,
  JPEG_QUALITY_LEVELS,
} from "../types/thumbnail.js";

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Generates a thumbnail for an image file using sharp
 */
async function generateImageThumbnail(
  filePath: string,
  config: typeof THUMBNAIL_CONFIGS.DEFAULT,
): Promise<ThumbnailResult> {
  console.log(
    `Generating image thumbnail (max: ${config.maxWidth}x${config.maxHeight}, ${config.maxSizeBytes} bytes)...`,
  );

  // Get image metadata
  const metadata = await sharp(filePath).metadata();
  console.log(
    `Original image: ${metadata.width}x${metadata.height}, format: ${metadata.format}`,
  );

  // Resize image to fit within max dimensions (maintaining aspect ratio)
  let resizedImage = sharp(filePath).resize(config.maxWidth, config.maxHeight, {
    fit: "inside",
    withoutEnlargement: true,
  });

  // Account for encryption overhead (90% of max size as per Android implementation)
  const targetMaxSize = Math.floor(config.maxSizeBytes * 0.9);

  // Try different quality levels to meet size constraint
  for (const quality of JPEG_QUALITY_LEVELS) {
    const buffer = await resizedImage
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();

    if (buffer.length <= targetMaxSize) {
      // Get final dimensions
      const finalMetadata = await sharp(buffer).metadata();

      console.log(
        `✓ Thumbnail generated: ${finalMetadata.width}x${finalMetadata.height}, ${buffer.length} bytes (quality: ${quality})`,
      );

      return {
        blob: new Blob([buffer], { type: "image/jpeg" }),
        sizeBytes: buffer.length,
        width: finalMetadata.width || config.maxWidth,
        height: finalMetadata.height || config.maxHeight,
      };
    }
  }

  throw new Error(
    `Could not compress image to fit within ${targetMaxSize} bytes`,
  );
}

/**
 * Generates a thumbnail for a video file using ffmpeg
 */
async function generateVideoThumbnail(
  filePath: string,
  config: typeof THUMBNAIL_CONFIGS.DEFAULT,
  captureTimeSeconds: number = 1,
): Promise<ThumbnailResult> {
  console.log(
    `Generating video thumbnail at ${captureTimeSeconds}s (max: ${config.maxWidth}x${config.maxHeight}, ${config.maxSizeBytes} bytes)...`,
  );

  // Create temporary file for the extracted frame
  const tempFile = join(tmpdir(), `video_thumbnail_${Date.now()}.jpg`);

  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .screenshots({
        timestamps: [captureTimeSeconds],
        filename: tempFile.split("/").pop()!,
        folder: tmpdir(),
        size: `${config.maxWidth}x${config.maxHeight}`,
      })
      .on("end", async () => {
        try {
          // Read the generated screenshot
          const frameBuffer = readFileSync(tempFile);

          // Get frame metadata
          const metadata = await sharp(frameBuffer).metadata();
          console.log(
            `Extracted frame: ${metadata.width}x${metadata.height}, ${frameBuffer.length} bytes`,
          );

          // Account for encryption overhead (90% of max size)
          const targetMaxSize = Math.floor(config.maxSizeBytes * 0.9);

          // If frame is already small enough, use it
          if (frameBuffer.length <= targetMaxSize) {
            console.log(
              `✓ Video thumbnail generated: ${metadata.width}x${metadata.height}, ${frameBuffer.length} bytes`,
            );

            const result = {
              blob: new Blob([frameBuffer], { type: "image/jpeg" }),
              sizeBytes: frameBuffer.length,
              width: metadata.width || config.maxWidth,
              height: metadata.height || config.maxHeight,
            };

            // Clean up temp file
            unlinkSync(tempFile);
            resolve(result);
            return;
          }

          // Otherwise, compress it using adaptive quality
          for (const quality of JPEG_QUALITY_LEVELS) {
            const compressedBuffer = await sharp(frameBuffer)
              .jpeg({ quality, mozjpeg: true })
              .toBuffer();

            if (compressedBuffer.length <= targetMaxSize) {
              const finalMetadata = await sharp(compressedBuffer).metadata();

              console.log(
                `✓ Video thumbnail generated: ${finalMetadata.width}x${finalMetadata.height}, ${compressedBuffer.length} bytes (quality: ${quality})`,
              );

              const result = {
                blob: new Blob([compressedBuffer], { type: "image/jpeg" }),
                sizeBytes: compressedBuffer.length,
                width: finalMetadata.width || config.maxWidth,
                height: finalMetadata.height || config.maxHeight,
              };

              // Clean up temp file
              unlinkSync(tempFile);
              resolve(result);
              return;
            }
          }

          // Clean up temp file
          unlinkSync(tempFile);
          reject(
            new Error(
              `Could not compress video frame to fit within ${targetMaxSize} bytes`,
            ),
          );
        } catch (error) {
          // Clean up temp file on error
          try {
            unlinkSync(tempFile);
          } catch {
            // Ignore cleanup errors
          }
          reject(error);
        }
      })
      .on("error", (error) => {
        // Clean up temp file on error
        try {
          unlinkSync(tempFile);
        } catch {
          // Ignore cleanup errors
        }
        reject(new Error(`FFmpeg error: ${error.message}`));
      });
  });
}

/**
 * Generates a thumbnail for a file (image or video)
 * 
 * @param filePath - Path to the source file
 * @param mimeType - MIME type of the file
 * @param thumbnailType - Type of thumbnail to generate (DEFAULT or PHOTO)
 * @param videoTimestamp - For videos, timestamp in seconds to capture (default: 1)
 * @returns Promise<ThumbnailResult>
 * @throws Error if thumbnail generation fails or unsupported file type
 */
export async function generateThumbnail(
  filePath: string,
  mimeType: string,
  thumbnailType: ThumbnailType = "DEFAULT",
  videoTimestamp: number = 1,
): Promise<ThumbnailResult> {
  const config = THUMBNAIL_CONFIGS[thumbnailType];

  if (isImageType(mimeType)) {
    return generateImageThumbnail(filePath, config);
  } else if (isVideoType(mimeType)) {
    return generateVideoThumbnail(filePath, config, videoTimestamp);
  } else {
    throw new Error(`Unsupported MIME type for thumbnail generation: ${mimeType}`);
  }
}

/**
 * Converts a ThumbnailResult blob to a format suitable for Proton Drive upload
 */
export function thumbnailToUploadFormat(
  thumbnail: ThumbnailResult,
  originalFileName: string,
): Blob {
  // Create a File-like object for the thumbnail
  const thumbnailFileName = `${originalFileName}_thumbnail.jpg`;
  const blob = thumbnail.blob;
  
  // Add name property to the blob to make it File-like
  Object.defineProperty(blob, "name", { value: thumbnailFileName });
  
  return blob;
}
