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
 * - Parallel uploads with configurable concurrency
 *
 * Usage:
 *   export PROTON_USERNAME="your-email@proton.me"
 *   export PROTON_PASSWORD="your-password"
 *   bun run src/drive.ts [folder-path] [--parallel N]
 *
 * Examples:
 *   bun run src/drive.ts
 *   bun run src/drive.ts --parallel 5
 *   bun run src/drive.ts -p 3
 *   bun run src/drive.ts /path/to/photos --parallel 4
 *   bun run src/drive.ts -f=/path/to/photos -p=2
 */

import { ProtonDrivePhotosClient } from "@protontech/drive-sdk/dist/protonDrivePhotosClient.js";
import { Telemetry, LogFilter, LogLevel } from "@protontech/drive-sdk/dist/telemetry.js";

import { MemoryCache} from "@protontech/drive-sdk";
import { readFileSync, existsSync, readdirSync, statSync, appendFileSync, writeFileSync } from "fs";
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
import { logger } from "./logger.js";

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

  logger.info("Initializing crypto...");
  await initCrypto();

  logger.info("Authenticating with Proton...");
  const auth = new ProtonAuth();
  await auth.login(username, password);

  const session = auth.getSession();
  if (!session) {
    throw new Error("Login failed: no session returned");
  }

  logger.info("✓ Authenticated successfully");

  // Create token refresh callback
  const onTokenRefresh = async () => {
    await auth.refreshToken();
    logger.debug("Token refreshed");
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
    telemetry: new Telemetry({logHandlers: [], metricHandlers: []})
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
    logger.debug(`Starting photo upload: ${filePath}`);

    // Validate file and get MIME type
    const mimeType = validateAndGetMimeType(filePath);
    logger.debug(`File validated. MIME type: ${mimeType}`);

    // Read the file
    const fileBuffer = readFileSync(filePath);
    const fileName = filePath.split("/").pop();
    const fileSize = fileBuffer.length;
    logger.debug(`File size: ${fileSize} bytes`);

    // Check for supplemental metadata file
    const metadataPath = `${filePath}.supplemental-metadata.json`;
    let captureTime: Date | undefined;
    let modificationTime: Date | undefined;
    
    if (existsSync(metadataPath)) {
      try {
        logger.debug("Reading supplemental metadata...");
        const metadataContent = readFileSync(metadataPath, "utf-8");
        const metadata = JSON.parse(metadataContent);
        
        if (metadata.photoTakenTime?.timestamp) {
          captureTime = new Date(parseInt(metadata.photoTakenTime.timestamp) * 1000);
          logger.debug(`Capture time: ${captureTime.toISOString()}`);
        }
        
        if (metadata.creationTime?.timestamp) {
          modificationTime = new Date(parseInt(metadata.creationTime.timestamp) * 1000);
          logger.debug(`Modification time: ${modificationTime.toISOString()}`);
        }
      } catch (metadataError) {
        logger.warn("Failed to read supplemental metadata:", (metadataError as Error).message);
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
    logger.debug("Generating thumbnail...");
    let thumbnail: Thumbnail | null = null;
    try {
      const thumbnailResult = await generateThumbnail(
        filePath,
        mimeType,
        "DEFAULT", // Use DEFAULT thumbnail type (512x512, 64KB)
        1, // For videos, capture at 1 second
      );
      
      thumbnail = thumbnailToUploadFormat(thumbnailResult);
      logger.debug(`Thumbnail generated (${thumbnailResult.sizeBytes} bytes, ${thumbnailResult.width}x${thumbnailResult.height})`);
    } catch (thumbnailError) {
      logger.warn("Thumbnail generation failed, continuing without thumbnail:", (thumbnailError as Error).message);
    }

    // Create a File-like object (for Node.js)
    const file = new Blob([fileBuffer], { type: mimeType });
    Object.defineProperty(file, "name", { value: fileName });

    // Get file uploader with metadata
    const uploader = await client.getFileUploader(fileName, {
      mediaType: mimeType,
      expectedSize: fileSize,
      modificationTime,
      captureTime,
      tags: [], // Optional: photo tags (0-9)
    });

    // Upload the file with progress callback and thumbnail
    const thumbnails = thumbnail ? [thumbnail] : [];
    const controller = await uploader.uploadFromFile(
      file,
      thumbnails,
      (uploadedBytes) => {
        const progress = ((uploadedBytes / fileSize) * 100).toFixed(2);
        logger.debug(`Upload progress: ${progress}%`);
      },
    );

    // Wait for upload to complete
    const result = await controller.completion();

    // logger.info(`✓ Upload complete! Node: ${result.nodeUid}`);

    return result;
  } catch (error) {
    logger.error("Upload failed:", error);
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
    // logger.info(`Starting stream upload: ${fileName}`);

    const uploader = await client.getFileUploader(fileName, {
      mediaType: "image/jpeg",
      expectedSize: fileSize,
      captureTime: new Date(),
    });

    const controller = await uploader.uploadFromStream(
      readableStream,
      [], // Thumbnails
      (uploadedBytes) => {
        const progress = ((uploadedBytes / fileSize) * 100).toFixed(2);
        logger.debug(`Upload progress: ${progress}%`);
      },
    );

    const result = await controller.completion();
    logger.info(`✓ Upload complete! Node: ${result.nodeUid}`);

    return result;
  } catch (error) {
    logger.error("Upload failed:", error);
    throw error;
  }
}

// ============================================================================
// STEP 4.5: File logging helper functions
// ============================================================================

/**
 * Write file paths to log files
 */
function writeFilePathsToLog(filePaths: string[], logFile: string) {
  try {
    // Append to file, create if doesn't exist
    const content = filePaths.join('\n') + '\n';
    appendFileSync(logFile, content);
  } catch (error) {
    logger.error(`Failed to write to ${logFile}:`, (error as Error).message);
  }
}

/**
 * Clear log files at the start
 */
function clearLogFiles() {
  try {
    writeFileSync('./success.txt', '', { flag: 'w' });
    writeFileSync('./errors.txt', '', { flag: 'w' });
    writeFileSync('./skipped.txt', '', { flag: 'w' });
  } catch (error) {
    logger.warn(`Failed to clear log files:`, (error as Error).message);
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
  logger.debug("Photos folder:", rootFolder);
  return rootFolder;
}

/**
 * List photos from timeline
 */
async function listPhotos() {
  const client = await getPhotosClient();
  logger.info("Fetching photos from timeline...");

  const photos = [];
  for await (const photo of client.iterateTimeline()) {
    photos.push(photo);
    logger.info(`Photo: ${photo.name} (captured: ${photo.captureTime})`);
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
    parallelism?: number;
  }
) {
  logger.info(`Scanning folder: ${folderPath}`);
  
  // Find all media files
  const mediaFiles = findMediaFiles(folderPath);
  
  if (mediaFiles.length === 0) {
    logger.info("No image or video files found.");
    return {
      total: 0,
      uploaded: 0,
      skipped: 0,
      failed: 0,
      results: [],
    };
  }
  
  logger.info(`Found ${mediaFiles.length} media file(s) to upload`);

  // Clear log files at the start
  clearLogFiles();

  // Determine parallelism level (default to 1 for sequential processing)
  const parallelism = Math.max(1, options?.parallelism || 1);
  
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

  // Process files in batches for parallel uploads
  logger.info(`Starting upload with ${parallelism} parallel worker(s)`);
  
  for (let i = 0; i < mediaFiles.length; i += parallelism) {
    const batch = mediaFiles.slice(i, i + parallelism);
    const batchStart = i + 1;
    const batchEnd = Math.min(i + parallelism, mediaFiles.length);
    
    logger.info(`Processing batch ${Math.ceil(batchStart / parallelism)}/${Math.ceil(mediaFiles.length / parallelism)} (files ${batchStart}-${batchEnd})`);
    
    // Process all files in the current batch concurrently
    const batchPromises = batch.map(async (filePath, batchIndex) => {
      const fileName = filePath.split("/").pop() || filePath;
      const globalIndex = i + batchIndex;
      
      logger.info(`[${globalIndex + 1}/${mediaFiles.length}] Processing: ${fileName}`);
      
      if (options?.onProgress) {
        options.onProgress(globalIndex + 1, mediaFiles.length, fileName);
      }
      
      try {
        // Check for duplicates if requested
        if (options?.skipDuplicates) {
          const fileBuffer = readFileSync(filePath);
          const isDupe = await checkDuplicate(fileName, fileBuffer);
          
          if (isDupe) {
            logger.info(`⊘ Skipping duplicate: ${fileName}`);
            return {
              filePath,
              status: "skipped" as const,
            };
          }
        }
        
        // Upload the file
        const result = await uploadPhoto(filePath);
        logger.info(`✓ Uploaded: ${fileName}`);
        return {
          filePath,
          status: "uploaded" as const,
          nodeUid: result.nodeUid,
        };
        
      } catch (error) {
        logger.error(`✗ Failed to upload ${fileName}:`, (error as Error).message);
        return {
          filePath,
          status: "failed" as const,
          error: (error as Error).message,
        };
      }
    });
    
    // Wait for all files in the current batch to complete
    const batchResults = await Promise.all(batchPromises);
    
    // Update overall results
    batchResults.forEach(result => {
      results.results.push(result);
      if (result.status === "uploaded") results.uploaded++;
      else if (result.status === "skipped") results.skipped++;
      else if (result.status === "failed") results.failed++;
    });
    
    // Write logs for this batch
    const successfulPaths = batchResults
      .filter(result => result.status === "uploaded")
      .map(result => result.filePath);
    
    const failedPaths = batchResults
      .filter(result => result.status === "failed")
      .map(result => result.filePath);
    
    const skippedPaths = batchResults
      .filter(result => result.status === "skipped")
      .map(result => result.filePath);
    
    if (successfulPaths.length > 0) {
      writeFilePathsToLog(successfulPaths, './success.txt');
    }
    
    if (failedPaths.length > 0) {
      writeFilePathsToLog(failedPaths, './errors.txt');
    }
    
    if (skippedPaths.length > 0) {
      writeFilePathsToLog(skippedPaths, './skipped.txt');
    }
    
    logger.info(`Completed batch ${Math.ceil(batchStart / parallelism)}/${Math.ceil(mediaFiles.length / parallelism)}`);
  }
  
  // Print summary
  logger.info("═".repeat(60));
  logger.info("UPLOAD SUMMARY");
  logger.info("═".repeat(60));
  logger.info(`Total files found:     ${results.total}`);
  logger.info(`Successfully uploaded: ${results.uploaded}`);
  logger.info(`Skipped (duplicates):  ${results.skipped}`);
  logger.info(`Failed:                ${results.failed}`);
  logger.info("═".repeat(60));
  
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

function parseCommandLineArgs() {
  const args = process.argv.slice(2);
  let folderPath: string | null = null;
  let parallelism = 1;
  let showHelp = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === "--help" || arg === "-h") {
      showHelp = true;
      break;
    } else if (arg === "--parallel" || arg === "-p") {
      const value = args[i + 1];
      if (value && !isNaN(parseInt(value))) {
        parallelism = Math.max(1, parseInt(value));
        i++; // Skip next argument
      } else {
        logger.warn(`Invalid parallelism value: ${value}. Using default (1).`);
      }
    } else if (arg.startsWith("--parallel=") || arg.startsWith("-p=")) {
      const value = arg.split("=")[1];
      if (!isNaN(parseInt(value))) {
        parallelism = Math.max(1, parseInt(value));
      } else {
        logger.warn(`Invalid parallelism value: ${value}. Using default (1).`);
      }
    } else if (arg.startsWith("--folder=")) {
      folderPath = arg.split("=")[1];
    } else if (arg.startsWith("-f=")) {
      folderPath = arg.split("=")[1];
    } else if (!arg.startsWith("--") && !arg.startsWith("-")) {
      // Positional argument - folder path
      if (folderPath === null) {
        folderPath = arg;
      } else {
        logger.warn(`Unexpected argument: ${arg}. Ignoring.`);
      }
    }
  }

  if (showHelp) {
    console.log(`
Usage: bun run src/drive.ts <folder-path> [options]

Options:
  --parallel, -p N    Upload N files in parallel (default: 1)
  --folder, -f PATH  Specify folder path to upload (alternative to positional arg)
  --help, -h         Show this help message

Examples:
  bun run src/drive.ts /path/to/photos
  bun run src/drive.ts /path/to/photos --parallel 5
  bun run src/drive.ts /path/to/photos -p 3
  bun run src/drive.ts -f=/path/to/photos --parallel 4
  bun run src/drive.ts -f=/path/to/photos -p=2
`);
    process.exit(0);
  }

  // Validate that folder path is provided
  if (folderPath === null) {
    console.error("Error: Folder path is required.");
    console.log(`
Usage: bun run src/drive.ts <folder-path> [options]
Use --help for more information.
`);
    process.exit(1);
  }

  return { folderPath, parallelism };
}

async function main() {
  try {
    // Parse command line arguments
    const { folderPath, parallelism } = parseCommandLineArgs();
    
    logger.info(`Using parallelism: ${parallelism}`);
    logger.info(`Target folder: ${folderPath}`);

    // Initialize the photos client
    await getPhotosClient();
    logger.info("Photos client initialized successfully!");

    // Upload the folder
    await uploadPhotoFolder(folderPath, { parallelism });

  } catch (error) {
    logger.error("Error:", (error as Error).message);
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
