use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use serde::Serialize;

use crate::{
    services::client_backup::{backup_existing_file, client_directory, managed_file_names},
    support::now,
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfigBackupSummary {
    pub(crate) id: String,
    pub(crate) application: String,
    pub(crate) file_name: String,
    pub(crate) backup_path: String,
    pub(crate) target_path: String,
    pub(crate) created_at: i64,
    pub(crate) byte_size: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfigBackupPreview {
    pub(crate) backup: ConfigBackupSummary,
    pub(crate) target_exists: bool,
    pub(crate) target_size: u64,
    pub(crate) can_restore: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfigBackupRestoreResult {
    pub(crate) backup: ConfigBackupSummary,
    pub(crate) safety_backup_path: Option<String>,
}

const APPLICATIONS: &[&str] = &["claude", "codex", "gemini"];

pub(crate) fn list() -> Result<Vec<ConfigBackupSummary>, String> {
    let mut backups = Vec::new();
    for application in APPLICATIONS {
        let directory = client_directory(application)?;
        if !directory.exists() {
            continue;
        }
        for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            if !entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_file()
            {
                continue;
            }
            let Some((file_name, created_at)) = parse_backup_name(
                &entry.file_name().to_string_lossy(),
                managed_file_names(application),
                &path,
            ) else {
                continue;
            };
            let metadata = entry.metadata().map_err(|error| error.to_string())?;
            let target_path = directory.join(&file_name);
            let backup_path = path_to_string(&path);
            backups.push(ConfigBackupSummary {
                id: backup_path.clone(),
                application: (*application).to_string(),
                file_name,
                backup_path,
                target_path: path_to_string(&target_path),
                created_at,
                byte_size: metadata.len(),
            });
        }
    }
    backups.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(backups)
}

pub(crate) fn preview(id: &str) -> Result<ConfigBackupPreview, String> {
    let backup = find(id)?;
    let target = PathBuf::from(&backup.target_path);
    let metadata = target.metadata().ok();
    let can_restore = Path::new(&backup.backup_path).is_file();
    Ok(ConfigBackupPreview {
        backup,
        target_exists: metadata.is_some(),
        target_size: metadata.map(|value| value.len()).unwrap_or_default(),
        can_restore,
    })
}

pub(crate) fn restore(id: &str) -> Result<ConfigBackupRestoreResult, String> {
    let backup = find(id)?;
    let backup_path = PathBuf::from(&backup.backup_path);
    let target_path = PathBuf::from(&backup.target_path);
    if !backup_path.is_file() {
        return Err("The selected backup no longer exists".into());
    }
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let safety_backup_path = backup_existing_file(&target_path)?;
    fs::copy(&backup_path, &target_path).map_err(|error| error.to_string())?;
    Ok(ConfigBackupRestoreResult {
        backup,
        safety_backup_path,
    })
}

fn find(id: &str) -> Result<ConfigBackupSummary, String> {
    list()?
        .into_iter()
        .find(|backup| backup.id == id)
        .ok_or_else(|| "The selected backup was not found".into())
}

fn parse_backup_name(name: &str, managed_files: &[&str], path: &Path) -> Option<(String, i64)> {
    for file_name in managed_files {
        if name == format!("{file_name}.relayhub.bak") {
            return Some(((*file_name).to_string(), modified_at(path)));
        }
        let prefix = format!("{file_name}.relayhub.");
        let Some(suffix) = name.strip_prefix(&prefix) else {
            continue;
        };
        if !suffix.ends_with(".bak") {
            continue;
        }
        let created_at = suffix
            .strip_suffix(".bak")
            .and_then(|value| value.split('.').next())
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or_else(|| modified_at(path));
        return Some(((*file_name).to_string(), created_at));
    }
    None
}

fn modified_at(path: &Path) -> i64 {
    path.metadata()
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_secs() as i64)
        .unwrap_or_else(now)
}

fn path_to_string(path: &Path) -> String {
    path.display().to_string()
}

#[cfg(test)]
mod tests {
    use super::parse_backup_name;

    #[test]
    fn recognizes_timestamped_and_legacy_backup_names() {
        let path = std::path::Path::new("settings.json.relayhub.123.abc.bak");
        assert_eq!(
            parse_backup_name(
                "settings.json.relayhub.123.abc.bak",
                &["settings.json"],
                path
            ),
            Some(("settings.json".into(), 123))
        );
        assert_eq!(
            parse_backup_name("settings.json.relayhub.bak", &["settings.json"], path)
                .map(|(name, _)| name),
            Some("settings.json".into())
        );
    }

    #[test]
    fn ignores_unmanaged_or_malformed_files() {
        let path = std::path::Path::new("settings.json.relayhub.nope.txt");
        assert!(
            parse_backup_name("other.json.relayhub.123.abc.bak", &["settings.json"], path)
                .is_none()
        );
        assert!(
            parse_backup_name("settings.json.relayhub.nope.txt", &["settings.json"], path)
                .is_none()
        );
    }
}
