use std::{
    fs,
    path::{Path, PathBuf},
};

use uuid::Uuid;

use crate::support::now;

pub(crate) const RELAYHUB_DIRECTORY_NAME: &str = "relayhub";
pub(crate) const BACKUP_DIRECTORY_NAME: &str = "backups";
pub(crate) const LEGACY_BACKUP_DIRECTORY_NAME: &str = ".relayhub-backups";

pub(crate) fn relayhub_directory_for(client_directory: &Path) -> PathBuf {
    client_directory.join(RELAYHUB_DIRECTORY_NAME)
}

pub(crate) fn backup_directory_for(client_directory: &Path) -> PathBuf {
    relayhub_directory_for(client_directory).join(BACKUP_DIRECTORY_NAME)
}

pub(crate) fn client_directory(application: &str) -> Result<PathBuf, String> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .ok_or("Unable to find the user configuration directory".to_string())?;
    match application {
        "claude" => Ok(home.join(".claude")),
        "codex" => Ok(home.join(".codex")),
        "gemini" => Ok(home.join(".gemini")),
        _ => Err("Unsupported client application".into()),
    }
}

pub(crate) fn managed_file_names(application: &str) -> &'static [&'static str] {
    match application {
        "claude" => &["settings.json"],
        "codex" => &["auth.json", "config.toml"],
        "gemini" => &["settings.json", ".env"],
        _ => &[],
    }
}

pub(crate) fn backup_existing_file(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let parent = path.parent().ok_or_else(|| {
        format!(
            "Cannot determine the parent directory of {}",
            path.display()
        )
    })?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| format!("Cannot determine the file name of {}", path.display()))?;
    let backup_directory = backup_directory_for(parent);
    fs::create_dir_all(&backup_directory).map_err(|error| error.to_string())?;
    let backup_name = format!(
        "{file_name}.relayhub.{}.{}.bak",
        now(),
        Uuid::new_v4().simple()
    );
    let backup = backup_directory.join(backup_name);
    fs::copy(path, &backup).map_err(|error| error.to_string())?;
    Ok(Some(path_to_string(backup)))
}

fn path_to_string(path: PathBuf) -> String {
    path.display().to_string()
}

#[cfg(test)]
mod tests {
    use super::{backup_existing_file, BACKUP_DIRECTORY_NAME, RELAYHUB_DIRECTORY_NAME};

    #[test]
    fn creates_a_unique_timestamped_backup() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("settings.json");
        std::fs::write(&source, "{}").unwrap();

        let backup = backup_existing_file(&source).unwrap().expect("backup");
        assert!(std::path::Path::new(&backup).exists());
        assert_ne!(backup, source.display().to_string());
        let backup_path = std::path::Path::new(&backup);
        assert_eq!(
            backup_path
                .parent()
                .and_then(|path| path.file_name())
                .and_then(|value| value.to_str()),
            Some(BACKUP_DIRECTORY_NAME)
        );
        assert_eq!(
            backup_path
                .parent()
                .and_then(|path| path.parent())
                .and_then(|path| path.file_name())
                .and_then(|value| value.to_str()),
            Some(RELAYHUB_DIRECTORY_NAME)
        );
    }

    #[test]
    fn skips_missing_files() {
        let directory = tempfile::tempdir().unwrap();
        assert!(backup_existing_file(&directory.path().join("missing.json"))
            .unwrap()
            .is_none());
    }
}
