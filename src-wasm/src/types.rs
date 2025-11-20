use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseResult {
    pub headers: Vec<String>,
    pub rows: Vec<HashMap<String, String>>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffResult {
    pub added: Vec<AddedRow>,
    pub removed: Vec<RemovedRow>,
    pub modified: Vec<ModifiedRow>,
    pub unchanged: Vec<UnchangedRow>,
    pub source: DatasetMetadata,
    pub target: DatasetMetadata,
    pub key_columns: Vec<String>,
    pub excluded_columns: Vec<String>,
    pub mode: String,
}

#[derive(Serialize, Deserialize)]
pub struct DatasetMetadata {
    pub headers: Vec<String>,
    pub rows: Vec<HashMap<String, String>>, 
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AddedRow {
    pub key: String,
    pub target_row: HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RemovedRow {
    pub key: String,
    pub source_row: HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct UnchangedRow {
    pub key: String,
    pub row: HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModifiedRow {
    pub key: String,
    pub source_row: HashMap<String, String>,
    pub target_row: HashMap<String, String>,
    pub differences: Vec<Difference>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Difference {
    pub column: String,
    pub old_value: String,
    pub new_value: String,
    pub diff: Vec<DiffChange>, // Word-level diff for highlighting
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiffChange {
    pub added: bool,
    pub removed: bool,
    pub value: String,
}
