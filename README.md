# Proton Drive Upload Tool

A CLI tool for uploading photos and videos to Proton Drive (Photos section).

**WARNING: This project is almost entirely vibe coded. I make no guarantees about code quality, safety, etc. Use this at your own risk.**

## Features

- Upload photos and videos to Proton Drive
- Automatic thumbnail generation (512x512, JPEG)
- Support for JPG, JPEG, PNG, and MP4 files
- Parallel uploads with configurable concurrency
- Duplicate detection to avoid re-uploading files
- Supplemental metadata support for capture and modification times
- Comprehensive logging and progress tracking

## Requirements

- Node.js 18+ or Bun runtime
- Proton Drive account with API access
- Environment variables for authentication:
  - `PROTON_USERNAME`: Your Proton email address
  - `PROTON_PASSWORD`: Your Proton account password

## Installation

```bash
bun install
```

## Usage

```bash
# Basic usage - upload from current directory
bun run src/index.ts

# Upload from specific folder
bun run src/index.ts /path/to/photos

# Parallel uploads (5 files at once)
bun run src/index.ts /path/to/photos --parallel 5

# Short form
bun run src/index.ts -f=/path/to/photos -p=3
```

## Command Line Options

- `--parallel, -p N`: Upload N files in parallel (default: 1)
- `--folder, -f PATH`: Specify folder path to upload
- `--help, -h`: Show help message

## Authentication

The tool uses Proton's SRP (Secure Remote Password) authentication with:
- bcrypt password hashing
- 2FA/TOTP support
- Session persistence with token refresh
- Key decryption using key password derived from bcrypt

## File Processing

1. **Validation**: Files are validated for supported MIME types
2. **Metadata**: Optional supplemental metadata files (`.supplemental-metadata.json`) can provide capture and modification times
3. **Thumbnails**: Automatic generation of 512x512 JPEG thumbnails
4. **Upload**: Files are uploaded with progress tracking
5. **Logging**: Results are logged to `success.txt`, `errors.txt`, and `skipped.txt`

## Log Files

- `success.txt`: List of successfully uploaded files
- `errors.txt`: List of files that failed to upload
- `skipped.txt`: List of duplicate files that were skipped

## Dependencies

- `@protontech/drive-sdk`: Proton Drive SDK for API interactions
- `bcryptjs`: Password hashing
- `fluent-ffmpeg`: Video thumbnail generation
- `openpgp`: PGP encryption/decryption
- `sharp`: Image processing for thumbnails


Auth code adapted from [proton-drive-sync](https://github.com/damianb-bitflipper/proton-drive-sync)  

