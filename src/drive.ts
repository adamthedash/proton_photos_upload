/**
 * Minimal Example: Uploading Photos/Videos with ProtonDrivePhotosClient
 *
 * This example demonstrates how to upload photos and videos with automatic
 * thumbnail generation using concrete implementations.
 *
 * Supported file types: jpg, jpeg, png, mp4
 * 
 * Features:
 * - Automatic MIME type detection
 * - Thumbnail generation (512x512, JPEG)
 * - File type validation
 *
 * Usage:
 *   export PROTON_USERNAME="your-email@proton.me"
 *   export PROTON_PASSWORD="your-password"
 *   bun run src/drive.ts
 */

import { ProtonDrivePhotosClient } from "@protontech/drive-sdk/dist/protonDrivePhotosClient.js";
import { Telemetry, LogFilter, LogLevel } from "@protontech/drive-sdk/dist/telemetry.js";

import { MemoryCache} from "@protontech/drive-sdk";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import {
  ProtonAuth,
  createProtonHttpClient,
  createProtonAccount,
  createSrpModule,
  createOpenPGPCrypto,
  initCrypto,
} from "./auth.js";
import { validateAndGetMimeType } from "./utils/validation.js";
import { generateThumbnail, thumbnailToUploadFormat } from "./utils/thumbnail.js";
import { Thumbnail } from "./types/thumbnail.js";
import { isSupportedExtension, getFileExtension } from "./utils/mime.js";

// ============================================================================
// STEP 1: Authenticate and set up dependencies
// ============================================================================

async function initializePhotosClient() {
  // Get credentials from environment
  const username = process.env.PROTON_USERNAME;
  const password = process.env.PROTON_PASSWORD;

  if (!username || !password) {
    throw new Error(
      "PROTON_USERNAME and PROTON_PASSWORD environment variables required",
    );
  }

  console.log("Initializing crypto...");
  await initCrypto();

  console.log("Authenticating with Proton...");
  const auth = new ProtonAuth();
  await auth.login(username, password);

  const session = auth.getSession();
  if (!session) {
    throw new Error("Login failed: no session returned");
  }

  console.log("✓ Authenticated successfully\n");

  // Create token refresh callback
  const onTokenRefresh = async () => {
    await auth.refreshToken();
    console.log("Token refreshed");
  };

  // Create the photos client with concrete implementations
  const photosClient = new ProtonDrivePhotosClient({
    httpClient: createProtonHttpClient(session, onTokenRefresh),
    entitiesCache: new MemoryCache(),
    cryptoCache: new MemoryCache(),
    // @ts-expect-error - PrivateKey types differ between openpgp imports
    account: createProtonAccount(session, createOpenPGPCrypto()),
    // @ts-expect-error - PrivateKey types differ between openpgp imports
    openPGPCryptoModule: createOpenPGPCrypto(),
    srpModule: createSrpModule(),
    telemetry: new Telemetry({logFilter: new LogFilter({ level: LogLevel.DEBUG })})
  });

  return photosClient;
}

// ============================================================================
// STEP 2: Initialize the client (export for use in other modules)
// ============================================================================

let photosClient: ProtonDrivePhotosClient | null = null;

async function getPhotosClient() {
  if (!photosClient) {
    photosClient = await initializePhotosClient();
  }
  return photosClient;
}

// ============================================================================
// STEP 3: Upload a photo
// ============================================================================

async function uploadPhoto(filePath: string) {
  const client = await getPhotosClient();
  try {
    console.log("Starting photo upload...");
    console.log(`File: ${filePath}`);

    // Validate file and get MIME type
    console.log("Validating file and detecting MIME type...");
    const mimeType = validateAndGetMimeType(filePath);
    console.log(`✓ File validated. MIME type: ${mimeType}`);

    // Read the file
    const fileBuffer = readFileSync(filePath);
    const fileName = filePath.split("/").pop();
    const fileSize = fileBuffer.length;
    console.log(`File size: ${fileSize} bytes`);

    // Check for supplemental metadata file
    const metadataPath = `${filePath}.supplemental-metadata.json`;
    let captureTime: Date | undefined;
    let modificationTime: Date | undefined;
    
    if (existsSync(metadataPath)) {
      try {
        console.log("Reading supplemental metadata...");
        const metadataContent = readFileSync(metadataPath, "utf-8");
        const metadata = JSON.parse(metadataContent);
        
        if (metadata.photoTakenTime?.timestamp) {
          captureTime = new Date(parseInt(metadata.photoTakenTime.timestamp) * 1000);
          console.log(`✓ Capture time: ${captureTime.toISOString()}`);
        }
        
        if (metadata.creationTime?.timestamp) {
          modificationTime = new Date(parseInt(metadata.creationTime.timestamp) * 1000);
          console.log(`✓ Modification time: ${modificationTime.toISOString()}`);
        }
      } catch (metadataError) {
        console.warn("⚠ Failed to read supplemental metadata:", (metadataError as Error).message);
        console.warn("Using current time for timestamps...");
      }
    }
    
    // Fall back to current time if metadata not found
    if (!captureTime) {
      captureTime = new Date();
    }
    if (!modificationTime) {
      modificationTime = new Date();
    }

    // Generate thumbnail
    console.log("\nGenerating thumbnail...");
    let thumbnail: Thumbnail | null = null;
    try {
      const thumbnailResult = await generateThumbnail(
        filePath,
        mimeType,
        "DEFAULT", // Use DEFAULT thumbnail type (512x512, 64KB)
        1, // For videos, capture at 1 second
      );
      
      thumbnail = thumbnailToUploadFormat(thumbnailResult);
      console.log(`✓ Thumbnail generated successfully (${thumbnailResult.sizeBytes} bytes, ${thumbnailResult.width}x${thumbnailResult.height})`);
    } catch (thumbnailError) {
      console.warn("⚠ Thumbnail generation failed:", (thumbnailError as Error).message);
      console.warn("Continuing upload without thumbnail...");
    }

    // Create a File-like object (for Node.js)
    const file = new Blob([fileBuffer], { type: mimeType });
    Object.defineProperty(file, "name", { value: fileName });

    // Get file uploader with metadata
    console.log("\nCreating file uploader...");
    const uploader = await client.getFileUploader(fileName, {
      mediaType: mimeType,
      expectedSize: fileSize,
      modificationTime,
      captureTime,
      tags: [], // Optional: photo tags (0-9)
    });

    console.log("✓ Uploader created, starting upload...");

    // Upload the file with progress callback and thumbnail
    const thumbnails = thumbnail ? [thumbnail] : [];
    const controller = await uploader.uploadFromFile(
      file,
      thumbnails,
      (uploadedBytes) => {
        const progress = ((uploadedBytes / fileSize) * 100).toFixed(2);
        console.log(
          `Progress: ${uploadedBytes}/${fileSize} bytes (${progress}%)`,
        );
      },
    );

    // Wait for upload to complete
    console.log("Waiting for upload to complete...");
    const result = await controller.completion();

    console.log("\n✓ Upload complete!");
    console.log("Node UID:", result.nodeUid);
    console.log("Revision UID:", result.nodeRevisionUid);
    if (thumbnail) {
      console.log("Thumbnail: included");
    }

    return result;
  } catch (error) {
    console.error("\n✗ Upload failed:", error);
    throw error;
  }
}

// ============================================================================
// STEP 4: Upload from a stream (alternative method)
// ============================================================================

async function uploadPhotoFromStream(
  fileName: string,
  readableStream: ReadableStream,
  fileSize: number,
) {
  const client = await getPhotosClient();
  try {
    console.log("Starting photo upload from stream...");

    const uploader = await client.getFileUploader(fileName, {
      mediaType: "image/jpeg",
      expectedSize: fileSize,
      captureTime: new Date(),
    });

    const controller = await uploader.uploadFromStream(
      readableStream,
      [], // Thumbnails
      (uploadedBytes) => {
        console.log(`Uploaded: ${uploadedBytes} bytes`);
      },
    );

    const result = await controller.completion();
    console.log("Upload complete! Node UID:", result.nodeUid);

    return result;
  } catch (error) {
    console.error("Upload failed:", error);
    throw error;
  }
}

// ============================================================================
// STEP 5: Additional helper functions
// ============================================================================

/**
 * Check if a photo already exists (duplicate detection)
 */
async function checkDuplicate(fileName: string, fileBuffer: Buffer) {
  const client = await getPhotosClient();

  const sha1Hash = async () => {
    const crypto = await import("crypto");
    return crypto.createHash("sha1").update(fileBuffer).digest("hex");
  };

  const isDuplicate = await client.isDuplicatePhoto(fileName, sha1Hash);
  return isDuplicate;
}

/**
 * Get the photos root folder
 */
async function getPhotosFolder() {
  const client = await getPhotosClient();
  const rootFolder = await client.getMyPhotosRootFolder();
  console.log("Photos folder:", rootFolder);
  return rootFolder;
}

/**
 * List photos from timeline
 */
async function listPhotos() {
  const client = await getPhotosClient();
  console.log("Fetching photos from timeline...");

  const photos = [];
  for await (const photo of client.iterateTimeline()) {
    photos.push(photo);
    console.log(photo);
    console.log(`- (captured: ${photo.captureTime})`);
    break;
  }

  return photos;
}

// ============================================================================
// STEP 6: Recursive folder upload
// ============================================================================

/**
 * Recursively finds all image and video files in a folder
 */
function findMediaFiles(folderPath: string): string[] {
  const mediaFiles: string[] = [];
  
  if (!existsSync(folderPath)) {
    throw new Error(`Folder not found: ${folderPath}`);
  }
  
  const stats = statSync(folderPath);
  if (!stats.isDirectory()) {
    throw new Error(`Path is not a directory: ${folderPath}`);
  }
  
  function scanDirectory(dirPath: string) {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        scanDirectory(fullPath);
      } else if (entry.isFile()) {
        // Check if file has a supported extension
        const extension = getFileExtension(entry.name);
        if (extension && isSupportedExtension(extension)) {
          mediaFiles.push(fullPath);
        }
      }
    }
  }
  
  scanDirectory(folderPath);
  return mediaFiles;
}

/**
 * Recursively uploads all image and video files from a folder
 * @param folderPath - Path to the folder to search
 * @param options - Upload options
 * @returns Summary of upload results
 */
async function uploadPhotoFolder(
  folderPath: string,
  options?: {
    skipDuplicates?: boolean;
    onProgress?: (current: number, total: number, fileName: string) => void;
  }
) {
  console.log(`\nScanning folder: ${folderPath}`);
  console.log("Looking for image and video files...\n");
  
  // Find all media files
  const mediaFiles = findMediaFiles(folderPath);
  
  if (mediaFiles.length === 0) {
    console.log("No image or video files found.");
    return {
      total: 0,
      uploaded: 0,
      skipped: 0,
      failed: 0,
      results: [],
    };
  }
  
  console.log(`Found ${mediaFiles.length} media file(s) to upload\n`);
  
  const results = {
    total: mediaFiles.length,
    uploaded: 0,
    skipped: 0,
    failed: 0,
    results: [] as Array<{
      filePath: string;
      status: "uploaded" | "skipped" | "failed";
      error?: string;
      nodeUid?: string;
    }>,
  };
  
  // Upload each file
  for (let i = 0; i < mediaFiles.length; i++) {
    const filePath = mediaFiles[i];
    const fileName = filePath.split("/").pop() || filePath;
    
    console.log(`\n[${i + 1}/${mediaFiles.length}] Processing: ${fileName}`);
    console.log("─".repeat(60));
    
    if (options?.onProgress) {
      options.onProgress(i + 1, mediaFiles.length, fileName);
    }
    
    try {
      // Check for duplicates if requested
      if (options?.skipDuplicates) {
        const fileBuffer = readFileSync(filePath);
        const isDupe = await checkDuplicate(fileName, fileBuffer);
        
        if (isDupe) {
          console.log(`⊘ Skipping (duplicate): ${fileName}`);
          results.skipped++;
          results.results.push({
            filePath,
            status: "skipped",
          });
          continue;
        }
      }
      
      // Upload the file
      const result = await uploadPhoto(filePath);
      results.uploaded++;
      results.results.push({
        filePath,
        status: "uploaded",
        nodeUid: result.nodeUid,
      });
      
      console.log(`✓ Successfully uploaded: ${fileName}`);
      
    } catch (error) {
      console.error(`✗ Failed to upload ${fileName}:`, (error as Error).message);
      results.failed++;
      results.results.push({
        filePath,
        status: "failed",
        error: (error as Error).message,
      });
    }
  }
  
  // Print summary
  console.log("\n" + "═".repeat(60));
  console.log("UPLOAD SUMMARY");
  console.log("═".repeat(60));
  console.log(`Total files found:     ${results.total}`);
  console.log(`Successfully uploaded: ${results.uploaded}`);
  console.log(`Skipped (duplicates):  ${results.skipped}`);
  console.log(`Failed:                ${results.failed}`);
  console.log("═".repeat(60) + "\n");
  
  return results;
}

// ============================================================================
// Usage Examples
// ============================================================================

// Example 1: Upload a single photo
// await uploadPhoto('./my-photo.jpg');

// Example 2: Check for duplicates before uploading
// const fileBuffer = readFileSync('./my-photo.jpg');
// const isDupe = await checkDuplicate('my-photo.jpg', fileBuffer);
// if (!isDupe) {
//   await uploadPhoto('./my-photo.jpg');
// } else {
//   console.log('Photo already exists!');
// }

// Example 3: List all photos
// await listPhotos();

// Example 4: Get photos folder info
// await getPhotosFolder();

// ============================================================================
// STEP 6: Main function to run the example
// ============================================================================

async function main() {
  try {
    // Initialize the photos client
    await getPhotosClient();
    console.log("Photos client initialized successfully!");
    console.log(
      "You can now use the exported functions to upload and manage photos.",
    );

    // Example: List photos
    // await listPhotos();

    // Example: Upload a photo
    await uploadPhoto("/home/adam/Downloads/takeout_3/Takeout/Google Photos/Photos from 2003/DCA05_(9) (1).jpg");
  } catch (error) {
    console.error("Error:", (error as Error).message);
    process.exit(1);
  }
}

// Run main if this file is executed directly
if (import.meta.main) {
  main();
}

export {
  getPhotosClient,
  uploadPhoto,
  uploadPhotoFromStream,
  checkDuplicate,
  getPhotosFolder,
  listPhotos,
  uploadPhotoFolder,
};
