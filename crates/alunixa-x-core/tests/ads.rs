use alunixa_x_core::ads::{
    fetch_ad_list, fetch_ad_list_from_urls, local_ad_list, normalize_ad_payload,
};
use serde_json::json;

#[test]
fn local_ad_list_returns_only_9527code() {
    let payload = local_ad_list();
    let ads = payload["ads"].as_array().unwrap();
    assert_eq!(ads.len(), 1);
    assert_eq!(ads[0]["title"], json!("9527Code"));
    assert_eq!(
        ads[0]["url"],
        json!("https://api.9527code.com/register?aff=YmeM")
    );
    assert!(
        ads[0]["image"]
            .as_str()
            .unwrap()
            .starts_with("data:image/png;base64,")
    );
    assert_eq!(
        ads[0]["highlights"],
        json!(["Codex 友好", "快速注册", "开发者服务"])
    );
    assert!(ads[0].get("expires_at").is_none());
}

#[test]
fn normalize_ad_payload_ignores_remote_payload_and_returns_local_item() {
    let payload = normalize_ad_payload(json!({
        "version": 9,
        "ads": [{
            "id": "remote",
            "type": "sponsor",
            "title": "Remote",
            "description": "Should be ignored",
            "url": "https://example.test"
        }]
    }));
    assert_eq!(payload["version"], json!(1));
    assert_eq!(payload["ads"].as_array().unwrap().len(), 1);
    assert_eq!(payload["ads"][0]["title"], json!("9527Code"));
}

#[tokio::test]
async fn fetch_ad_list_is_offline_and_local_only() {
    let payload = fetch_ad_list().await.unwrap();
    assert_eq!(payload["ads"][0]["title"], json!("9527Code"));

    let from_urls = fetch_ad_list_from_urls(&["https://example.invalid/ads.json"])
        .await
        .unwrap();
    assert_eq!(from_urls["ads"][0]["title"], json!("9527Code"));
}
