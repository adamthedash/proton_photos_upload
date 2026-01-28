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
import { readFileSync } from "fs";
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

    // Generate thumbnail
    console.log("\nGenerating thumbnail...");
    let thumbnailBlob: Blob | null = null;
    try {
      const thumbnail = await generateThumbnail(
        filePath,
        mimeType,
        "DEFAULT", // Use DEFAULT thumbnail type (512x512, 64KB)
        1, // For videos, capture at 1 second
      );
      
      thumbnailBlob = thumbnailToUploadFormat(thumbnail, fileName || "file");
      console.log(`✓ Thumbnail generated successfully (${thumbnail.sizeBytes} bytes, ${thumbnail.width}x${thumbnail.height})`);
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
      // modificationTime: new Date(),
      // captureTime: new Date(), // When the photo was taken
      tags: [], // Optional: photo tags (0-9)
    });

    console.log("✓ Uploader created, starting upload...");

    // Upload the file with progress callback and thumbnail
    const thumbnails = thumbnailBlob ? [thumbnailBlob] : [];
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
    if (thumbnailBlob) {
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
    await uploadPhoto("/home/adam/Downloads/image-removebg-preview.png");
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
};
