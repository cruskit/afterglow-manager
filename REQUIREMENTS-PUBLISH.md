# Publishing Module -- Requirements Document

**Version:** 1.1.0
**Date:** 2026-02-11
**Status:** Implemented

---

## Context

AfterGlowManager allows users to manage gallery metadata locally. The Publishing Module syncs the local workspace to an S3 bucket, along with a Settings system for securely storing AWS credentials.

---

## 1. Settings System

### 1.1 Settings Dialog

**FR-SET-01: Opening the Settings Dialog**
- A gear icon button in the tree view sidebar footer opens a modal Settings dialog.
- The dialog is accessible from any view (welcome, galleries, gallery detail).

**FR-SET-02: AWS Configuration Fields**

| Field | Type | Notes |
|-------|------|-------|
| AWS Access Key ID | Password-style input | Masked after save; cannot be revealed or copied once saved |
| AWS Secret Access Key | Password-style input | Masked after save; cannot be revealed or copied once saved |
| S3 Bucket Name | Text input | e.g., `my-gallery-bucket` |
| AWS Region | Text input | e.g., `us-east-1`, `ap-southeast-2` |
| S3 Prefix | Text input | Default: `galleries/`. The target path prefix in the bucket |
| CloudFront Distribution ID | Text input | Optional. Distribution ID or full ARN (auto-extracted). Used for cache invalidation after publish |

**FR-SET-03: Credential Masking**
- When credentials have been previously saved, the Key ID and Secret fields display placeholder text (e.g., `••••••••••••ABCD` showing only the last 4 characters of the Key ID, and `••••••••••••` for the secret).
- The fields are NOT editable in-place. To change credentials, the user clicks a "Change Credentials" button which clears both fields for re-entry.
- There is no "show password" toggle. Once saved, the raw values cannot be retrieved from the UI.

**FR-SET-04: Non-Sensitive Settings Persistence**
- Bucket, Region, S3 Prefix, and the validated identity info (User, Account, ARN) are stored in a JSON config file at the Tauri app data directory.

**FR-SET-05: Sensitive Credential Storage**
- AWS Access Key ID and AWS Secret Access Key are stored in the OS keychain:
  - macOS: macOS Keychain via the `security` framework
  - Windows: Windows Credential Manager via the `wincred` API
- The Rust backend handles all keychain operations. Credentials never leave the backend except as masked indicators.

**FR-SET-06: Credential Validation**
- A "Validate" button performs:
  1. **Identity check**: Calls AWS STS `GetCallerIdentity` using the provided credentials.
  2. **Bucket access check**: Calls S3 `ListObjectsV2` with `max-keys=1` on the configured bucket.
- On success: Displays User, Account, ARN; persists to settings.json.
- On failure: Displays the specific error. Does NOT save credentials.

**FR-SET-07: Save Behavior**
- "Save" persists non-sensitive settings to `settings.json` and credentials to OS keychain.
- Credentials are only saved after successful validation.
- Non-credential settings can be saved without validation.

### 1.2 Tauri Backend -- Settings Commands

| Command | Input | Output | Description |
|---------|-------|--------|-------------|
| `load_settings` | none | `Settings` | Load non-sensitive settings from JSON config file |
| `save_settings` | `Settings` | `Result<()>` | Save non-sensitive settings to JSON config file |
| `save_credentials` | `key_id, secret` | `Result<()>` | Store credentials in OS keychain |
| `has_credentials` | none | `bool` | Check if credentials exist in keychain |
| `get_credential_hint` | none | `Option<String>` | Return last 4 chars of stored Key ID |
| `delete_credentials` | none | `Result<()>` | Remove credentials from keychain |
| `validate_credentials` | `key_id, secret, bucket, region` | `Result<ValidationResult>` | Call STS + S3 list |

---

## 2. Publishing (S3 Sync)

### 2.1 Publish Trigger

**FR-PUB-01: Publish Button**
- A "Publish" button in the sidebar footer, enabled when workspace is active and credentials are validated.

### 2.2 Publish Preview

**FR-PUB-03: Pre-Publish Preview Dialog**
- Shows files to upload, delete, and unchanged count before confirming.
- Uses MD5/ETag comparison for change detection.

### 2.3 Sync Behavior

**FR-PUB-04: Sync Scope**
- Only files reachable from the root `galleries.json` are synced:
  - `galleries.json` itself.
  - Each gallery's `gallery-details.json` (resolved via the gallery entry's `slug` field).
  - All images referenced by `cover` fields in `galleries.json`.
  - All images referenced by `thumbnail` and `full` fields in each `gallery-details.json`.
- Files and folders not referenced through this chain (e.g., untracked galleries, stray images) are excluded from sync.
- S3 objects under the prefix that do not correspond to referenced files are marked for deletion.
- Other file types (`.DS_Store`, `.txt`, dotfiles) remain excluded.
- S3 key format: `{s3Prefix}/{relative path from workspace root}`.

**FR-PUB-05: Upload Logic**
- Sequential uploads with Content-Type detection from file extension.

**FR-PUB-06: Delete Logic**
- S3 objects under the prefix without corresponding local files are deleted.
- Safety: only deletes objects whose key starts with the configured prefix.

**FR-PUB-07: Change Detection**
- MD5 hash compared against S3 ETag. Multipart ETags (containing hyphen) treated as changed.

### 2.4 Progress Indicator

**FR-PUB-08: Progress Dialog**
- Progress bar, current file name, elapsed time.
- Cancel button stops sync after current file completes.

**FR-PUB-09: Completion State**
- Summary: uploaded, deleted, unchanged counts.
- Error display with retry option.

**FR-PUB-10: CloudFront Cache Invalidation**
- After all uploads and deletes complete, if a CloudFront Distribution ID is configured, a wildcard invalidation is created for the S3 prefix path (`/{prefix}*`).
- The distribution ID can be entered as a plain ID (e.g., `E1ABC2DEF3GH`) or a full CloudFront ARN (`arn:aws:cloudfront::ACCOUNT:distribution/E1ABC2DEF3GH`); the ID is extracted automatically.
- A progress event with action `"invalidate"` is emitted so the UI shows "Invalidating CloudFront cache..." during the operation.
- The invalidation call has a 30-second timeout. Errors (wrong ID, access denied, timeout) emit `publish-error` and abort.
- CloudFront is NOT validated during the Settings validation step (the IAM policy only grants `cloudfront:CreateInvalidation`).

### 2.5 Tauri Backend -- Publish Commands

| Command | Input | Output | Description |
|---------|-------|--------|-------------|
| `publish_preview` | `folder_path, bucket, region, prefix` | `PublishPlan` | Dry-run comparison |
| `publish_execute` | `plan_id` | streamed events | Execute sync with progress events |
| `publish_cancel` | `plan_id` | `Result<()>` | Cancel in-progress publish |

Progress events: `publish-progress`, `publish-complete`, `publish-error`.

---

## 3. Security Considerations

- **SEC-01**: Credentials never reach the frontend after initial save.
- **SEC-02**: Only S3 and STS endpoints are contacted.
- **SEC-03**: All S3 operations scoped to configured prefix.
- **SEC-04**: No command to read raw credentials from keychain.

---

## 4. Rust Crate Dependencies

| Crate | Purpose |
|-------|---------|
| `aws-config` | AWS SDK credential/config loading |
| `aws-sdk-s3` | S3 operations |
| `aws-sdk-sts` | STS GetCallerIdentity |
| `aws-credential-types` | Hardcoded credential provider |
| `md-5` | MD5 hash computation |
| `keyring` | Cross-platform keychain access |
| `tokio` | Async runtime |
| `uuid` | Plan ID generation |
| `aws-sdk-cloudfront` | CloudFront cache invalidation |
