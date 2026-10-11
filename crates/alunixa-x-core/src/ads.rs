use serde_json::{Value, json};

// Empty legacy envelope; no advertisement catalogue or network fetch is shipped.
pub fn local_ad_list() -> Value { json!({"version":1,"ads":[]}) }
pub fn normalize_ad_payload(_payload: Value) -> Value { local_ad_list() }
pub async fn fetch_ad_list() -> anyhow::Result<Value> { Ok(local_ad_list()) }
pub async fn fetch_ad_list_from_urls<S>(_urls: &[S]) -> anyhow::Result<Value>
where S: AsRef<str> { Ok(local_ad_list()) }

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn advertising_is_disabled_even_for_supplied_catalogs() {
        assert_eq!(normalize_ad_payload(json!({"ads":[{"id":"fixture"}]})), local_ad_list());
        assert!(fetch_ad_list_from_urls(&["https://fixture.invalid/ads"]).await.unwrap()["ads"].as_array().unwrap().is_empty());
    }
}
