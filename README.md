# Proton Drive Upload

Minimal example demonstrating authentication and file listing with the Proton Drive SDK.

## Setup

1. Install dependencies:
```bash
bun install
```

2. Set your Proton credentials as environment variables:
```bash
export PROTON_USERNAME="your-email@proton.me"
export PROTON_PASSWORD="your-password"
```

## Usage

Run the script to authenticate and list files in your Proton Drive:

```bash
bun run src/index.ts
```

## What it does

1. Authenticates with Proton using SRP (Secure Remote Password) protocol
2. Creates a ProtonDriveClient instance with all required components:
   - HTTP client with automatic token refresh
   - Account interface with decrypted keys
   - OpenPGP crypto module
   - SRP module for authentication
   - Memory caches for entities and crypto
3. Gets the root "My Files" folder (returns Result type with ok/value/error)
4. Lists all files and folders with proper error handling

## Files

- `src/auth.ts` - Complete authentication implementation (copied from proton-drive-sync)
- `src/logger.ts` - Simple logger
- `src/index.ts` - Main script demonstrating authentication and file listing

## Notes

- Only supports simple username/password authentication
- No 2FA or two-password mode support in this minimal example
- Code adapted from [proton-drive-sync](https://github.com/damianb-bitflipper/proton-drive-sync)

## Understanding SDK Return Types

The Proton Drive SDK uses a `Result<T, E>` pattern for error handling:

```typescript
type Result<T, E> = 
  | { ok: true; value: T }
  | { ok: false; error: E }
```

Examples:
- `getMyFilesRootFolder()` returns `MaybeNode` = `Result<NodeEntity, DegradedNode>`
- `iterateFolderChildren()` yields `MaybeNode` for each child

Always check `result.ok` before accessing `result.value`:

```typescript
const rootResult = await client.getMyFilesRootFolder();
if (rootResult.ok) {
  const root = rootResult.value;  // NodeEntity
  console.log(root.uid, root.name);
}
```
