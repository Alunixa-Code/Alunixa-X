use alunixa_x_core::ads::{
    fetch_ad_list, fetch_ad_list_from_urls, local_ad_list, normalize_ad_payload,
};
use serde_json::json;

#[test]
fn local_ad_list_is_an_empty_nonadvertising_envelope() {
    let payload = local_ad_list();
    let ads = payload["ads"].as_array().unwrap();
    assert!(ads.is_empty());
    assert_eq!(payload["version"], json!(1));
    assert!(payload.get("topAd").is_none());
    assert!(payload.get("topAds").is_none());
}

#[test]
fn normalize_ad_payload_rejects_remote_advertising_content() {
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
    assert!(payload["ads"].as_array().unwrap().is_empty());
    assert_eq!(payload, local_ad_list());
}

#[tokio::test]
async fn fetch_ad_list_is_offline_and_local_only() {
    let payload = fetch_ad_list().await.unwrap();
    assert_eq!(payload, local_ad_list());

    let from_urls = fetch_ad_list_from_urls(&["https://example.invalid/ads.json"])
        .await
        .unwrap();
    assert_eq!(from_urls, local_ad_list());
}

#[tokio::test]
async fn supplied_ad_catalog_urls_never_receive_a_network_request() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/ads.json", listener.local_addr().unwrap());
    let payload = tokio::time::timeout(
        std::time::Duration::from_millis(500),
        fetch_ad_list_from_urls(&[url]),
    )
    .await
    .expect("an offline advertisement envelope must not wait for an HTTP response")
    .unwrap();
    assert_eq!(payload, local_ad_list());
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(100), listener.accept())
            .await
            .is_err(),
        "advertisement catalogue retrieval must stay offline"
    );
}
