#!/usr/bin/env bun

/**
 * Minimal Proton Drive example - authenticate and list files
 * 
 * Usage:
 *   export PROTON_USERNAME="your-email@proton.me"
 *   export PROTON_PASSWORD="your-password"
 *   bun run src/index.ts
 */

import {
  ProtonAuth, createProtonHttpClient, createProtonAccount,
  createSrpModule, createOpenPGPCrypto, initCrypto
} from './auth.js';
import { ProtonDriveClient, MemoryCache } from '@protontech/drive-sdk';

async function main() {
  // Get credentials from environment
  const username = process.env.PROTON_USERNAME;
  const password = process.env.PROTON_PASSWORD;

  if (!username || !password) {
    console.error('Error: PROTON_USERNAME and PROTON_PASSWORD environment variables required');
    process.exit(1);
  }

  console.log('Initializing crypto...');
  await initCrypto();

  console.log('Authenticating with Proton...');
  const auth = new ProtonAuth();
  await auth.login(username, password);

  const session = auth.getSession();
  if (!session) {
    console.error('Login failed: no session returned');
    process.exit(1);
  }

  console.log('✓ Authenticated successfully\n');

  // Create token refresh callback
  const onTokenRefresh = async () => {
    await auth.refreshToken();
    console.log('Token refreshed');
  };

  // Create the SDK client
  const client = new ProtonDriveClient({
    httpClient: createProtonHttpClient(session, onTokenRefresh),
    entitiesCache: new MemoryCache(),
    cryptoCache: new MemoryCache(),
    // @ts-expect-error - PrivateKey types differ between openpgp imports
    account: createProtonAccount(session, createOpenPGPCrypto()),
    // @ts-expect-error - PrivateKey types differ between openpgp imports
    openPGPCryptoModule: createOpenPGPCrypto(),
    srpModule: createSrpModule(),
  });

  console.log('Getting root folder...');
  const rootResult = await client.getMyFilesRootFolder();

  if (!rootResult.ok) {
    console.error('Failed to get root folder:', rootResult.error);
    process.exit(1);
  }

  const root = rootResult.value;
  console.log('Root folder UID:', root.uid);
  console.log('\nListing files and folders:\n');
  console.log('─'.repeat(60));

  // List all children in root folder
  for await (const nodeResult of client.iterateFolderChildren(root.uid)) {
    if (!nodeResult.ok) {
      console.warn('Skipping degraded node:', nodeResult.error);
      continue;
    }
    
    const node = nodeResult.value;
    const icon = node.type === 'folder' ? '📁' : '📄';
    const size = node.activeRevision?.size ? ` (${formatBytes(node.activeRevision.size)})` : '';
    console.log(`${icon} ${node.name}${size}`);
  }

  console.log('─'.repeat(60));
  console.log('\n✓ Done!');
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let size = bytes;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
