use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const KEYRING_SERVICE: &str = "com.afterglow.manager";
const KEYRING_KEY_ID: &str = "aws-access-key-id";
const KEYRING_SECRET: &str = "aws-secret-access-key";

/// Extract the distribution ID from a CloudFront ARN or return the input as-is.
/// Handles formats like:
///   "arn:aws:cloudfront::123456:distribution/E1ABC2DEF3GH" -> "E1ABC2DEF3GH"
///   "E1ABC2DEF3GH"                                         -> "E1ABC2DEF3GH"
pub fn extract_distribution_id(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.starts_with("arn:") {
        // ARN format: arn:aws:cloudfront::ACCOUNT:distribution/DIST_ID
        // Split on '/' and take the last segment
        if let Some(last) = trimmed.rsplit('/').next() {
            if !last.is_empty() {
                return last.to_string();
            }
        }
    }
    trimmed.to_string()
}

/// Extract the bucket name from an S3 ARN or return the input as-is.
/// Handles formats like:
///   "arn:aws:s3:::my-bucket"       -> "my-bucket"
///   "arn:aws:s3:::my-bucket/prefix" -> "my-bucket"
///   "my-bucket"                    -> "my-bucket"
pub fn extract_bucket_name(input: &str) -> String {
    let trimmed = input.trim();
    if let Some(rest) = trimmed.strip_prefix("arn:") {
        // ARN format: arn:partition:s3:::bucket-name[/key-prefix]
        // Split on ':' -> ["arn", partition, "s3", region, account, "bucket/..."]
        // The bucket is in the 6th segment (index 5)
        let parts: Vec<&str> = rest.splitn(5, ':').collect();
        if let Some(resource) = parts.last() {
            // resource might be "bucket-name" or "bucket-name/some/prefix"
            let bucket = resource.split('/').next().unwrap_or(resource);
            if !bucket.is_empty() {
                return bucket.to_string();
            }
        }
    }
    trimmed.to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub bucket: String,
    pub region: String,
    pub s3_prefix: String,
    pub last_validated_user: String,
    pub last_validated_account: String,
    pub last_validated_arn: String,
    #[serde(default)]
    pub cloud_front_distribution_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ValidationResult {
    pub user: String,
    pub account: String,
    pub arn: String,
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot determine app data directory: {}", e))?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    Ok(data_dir.join("settings.json"))
}

#[tauri::command]
pub async fn load_settings(app: tauri::AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(AppSettings {
            region: "ap-southeast-2".to_string(),
            s3_prefix: "galleries/".to_string(),
            ..Default::default()
        });
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let settings: AppSettings = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(settings)
}

#[tauri::command]
pub async fn save_settings(app: tauri::AppHandle, settings: AppSettings) -> Result<(), String> {
    let path = settings_path(&app)?;
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn save_credentials(key_id: String, secret: String) -> Result<(), String> {
    let entry_id = keyring::Entry::new(KEYRING_SERVICE, KEYRING_KEY_ID)
        .map_err(|e| format!("Unable to access system keychain: {}", e))?;
    entry_id
        .set_password(&key_id)
        .map_err(|e| format!("Unable to access system keychain. Credentials cannot be saved: {}", e))?;

    let entry_secret = keyring::Entry::new(KEYRING_SERVICE, KEYRING_SECRET)
        .map_err(|e| format!("Unable to access system keychain: {}", e))?;
    entry_secret
        .set_password(&secret)
        .map_err(|e| format!("Unable to access system keychain. Credentials cannot be saved: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn has_credentials() -> bool {
    let entry = match keyring::Entry::new(KEYRING_SERVICE, KEYRING_KEY_ID) {
        Ok(e) => e,
        Err(_) => return false,
    };
    entry.get_password().is_ok()
}

#[tauri::command]
pub async fn get_credential_hint() -> Option<String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_KEY_ID).ok()?;
    let key_id = entry.get_password().ok()?;
    if key_id.len() >= 4 {
        Some(key_id[key_id.len() - 4..].to_string())
    } else {
        Some(key_id)
    }
}

#[tauri::command]
pub async fn delete_credentials() -> Result<(), String> {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_KEY_ID) {
        let _ = entry.delete_credential();
    }
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_SECRET) {
        let _ = entry.delete_credential();
    }
    Ok(())
}

pub fn get_credentials_from_keychain() -> Result<(String, String), String> {
    let entry_id = keyring::Entry::new(KEYRING_SERVICE, KEYRING_KEY_ID)
        .map_err(|e| format!("Keychain error: {}", e))?;
    let key_id = entry_id
        .get_password()
        .map_err(|_| "No credentials found. Configure AWS credentials in Settings.".to_string())?;

    let entry_secret = keyring::Entry::new(KEYRING_SERVICE, KEYRING_SECRET)
        .map_err(|e| format!("Keychain error: {}", e))?;
    let secret = entry_secret
        .get_password()
        .map_err(|_| "No credentials found. Configure AWS credentials in Settings.".to_string())?;

    Ok((key_id, secret))
}

#[tauri::command]
pub async fn validate_credentials(
    key_id: String,
    secret: String,
    bucket: String,
    region: String,
) -> Result<ValidationResult, String> {
    use aws_credential_types::Credentials;
    use aws_sdk_sts::config::Region;
    use tokio::time::{timeout, Duration};

    if key_id.is_empty() || secret.is_empty() {
        return Err("AWS Access Key ID and Secret Access Key are required.".to_string());
    }

    eprintln!("[validate] Starting validation, region={}, bucket={}", region, bucket);

    let creds = Credentials::new(&key_id, &secret, None, None, "afterglow-manager");
    let region = Region::new(region);
    let bucket_name = extract_bucket_name(&bucket);

    eprintln!("[validate] Extracted bucket name: {}", bucket_name);

    // STS GetCallerIdentity
    let sts_config = aws_sdk_sts::Config::builder()
        .credentials_provider(creds.clone())
        .region(region.clone())
        .behavior_version_latest()
        .build();
    let sts_client = aws_sdk_sts::Client::from_conf(sts_config);

    eprintln!("[validate] Calling STS GetCallerIdentity...");
    let identity = timeout(
        Duration::from_secs(15),
        sts_client.get_caller_identity().send(),
    )
    .await
    .map_err(|_| "STS request timed out. Check your region and network connection.".to_string())?
    .map_err(|e| format!("STS error: {}", e))?;

    let user = identity.user_id().unwrap_or("").to_string();
    let account = identity.account().unwrap_or("").to_string();
    let arn = identity.arn().unwrap_or("").to_string();

    eprintln!("[validate] STS success: user={}, account={}", user, account);

    // S3 ListObjectsV2 with max-keys=1 to check bucket access
    let s3_config = aws_sdk_s3::Config::builder()
        .credentials_provider(creds)
        .region(region)
        .behavior_version_latest()
        .build();
    let s3_client = aws_sdk_s3::Client::from_conf(s3_config);

    eprintln!("[validate] Calling S3 ListObjectsV2 on bucket '{}'...", bucket_name);
    timeout(
        Duration::from_secs(15),
        s3_client
            .list_objects_v2()
            .bucket(&bucket_name)
            .max_keys(1)
            .send(),
    )
    .await
    .map_err(|_| "S3 request timed out. Check your bucket name, region, and network connection.".to_string())?
    .map_err(|e| format!("S3 error: {}", e))?;

    eprintln!("[validate] S3 success. Validation complete.");
    Ok(ValidationResult { user, account, arn })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_settings_serialization() {
        let settings = AppSettings {
            bucket: "my-bucket".to_string(),
            region: "us-east-1".to_string(),
            s3_prefix: "galleries/".to_string(),
            last_validated_user: "AIDA123".to_string(),
            last_validated_account: "123456789012".to_string(),
            last_validated_arn: "arn:aws:iam::123456789012:user/test".to_string(),
            cloud_front_distribution_id: "".to_string(),
        };
        let json = serde_json::to_string(&settings).unwrap();
        let parsed: AppSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.bucket, "my-bucket");
        assert_eq!(parsed.region, "us-east-1");
        assert_eq!(parsed.s3_prefix, "galleries/");
        assert_eq!(parsed.last_validated_user, "AIDA123");
    }

    #[test]
    fn test_settings_deserialization_camel_case() {
        let json = r#"{
            "bucket": "test-bucket",
            "region": "ap-southeast-2",
            "s3Prefix": "photos/",
            "lastValidatedUser": "USER",
            "lastValidatedAccount": "111",
            "lastValidatedArn": "arn"
        }"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.bucket, "test-bucket");
        assert_eq!(settings.s3_prefix, "photos/");
        assert_eq!(settings.last_validated_user, "USER");
    }

    #[test]
    fn test_default_settings() {
        let settings = AppSettings::default();
        assert_eq!(settings.bucket, "");
        assert_eq!(settings.region, "");
        assert_eq!(settings.s3_prefix, "");
    }

    #[test]
    fn test_extract_bucket_name_plain() {
        assert_eq!(extract_bucket_name("my-bucket"), "my-bucket");
        assert_eq!(extract_bucket_name("  my-bucket  "), "my-bucket");
    }

    #[test]
    fn test_extract_bucket_name_from_arn() {
        assert_eq!(
            extract_bucket_name("arn:aws:s3:::my-bucket"),
            "my-bucket"
        );
        assert_eq!(
            extract_bucket_name("arn:aws:s3:::thirdhalfphotosinfrastack-websitebucket75c24d94-8nxyz"),
            "thirdhalfphotosinfrastack-websitebucket75c24d94-8nxyz"
        );
    }

    #[test]
    fn test_extract_bucket_name_from_arn_with_key_prefix() {
        assert_eq!(
            extract_bucket_name("arn:aws:s3:::my-bucket/some/prefix"),
            "my-bucket"
        );
    }

    #[test]
    fn test_extract_bucket_name_govcloud_arn() {
        assert_eq!(
            extract_bucket_name("arn:aws-us-gov:s3:::gov-bucket"),
            "gov-bucket"
        );
    }

    #[test]
    fn test_extract_distribution_id_plain() {
        assert_eq!(extract_distribution_id("E1ABC2DEF3GH"), "E1ABC2DEF3GH");
        assert_eq!(extract_distribution_id("  E1ABC2DEF3GH  "), "E1ABC2DEF3GH");
    }

    #[test]
    fn test_extract_distribution_id_from_arn() {
        assert_eq!(
            extract_distribution_id("arn:aws:cloudfront::123456789012:distribution/E1ABC2DEF3GH"),
            "E1ABC2DEF3GH"
        );
    }

    #[test]
    fn test_extract_distribution_id_from_arn_with_extra_path() {
        assert_eq!(
            extract_distribution_id("arn:aws:cloudfront::123456789012:distribution/E1ABC2DEF3GH/extra"),
            "extra"
        );
    }

    #[test]
    fn test_validation_result_serialization() {
        let result = ValidationResult {
            user: "AIDA123".to_string(),
            account: "123456789012".to_string(),
            arn: "arn:aws:iam::123456789012:user/test".to_string(),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("AIDA123"));
        let parsed: ValidationResult = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.user, "AIDA123");
    }
}
