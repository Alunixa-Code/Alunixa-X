use serde_json::{Map, Value, json};

const LOCAL_RECOMMENDATION_IMAGE: &[u8] = include_bytes!("../../../assets/images/9527code.png");

pub fn local_ad_list() -> Value {
    json!({
        "version": 1,
        "ads": [local_recommendation_ad()]
    })
}

pub fn normalize_ad_payload(_payload: Value) -> Value {
    local_ad_list()
}

pub async fn fetch_ad_list() -> anyhow::Result<Value> {
    Ok(local_ad_list())
}

pub async fn fetch_ad_list_from_urls<S>(_urls: &[S]) -> anyhow::Result<Value>
where
    S: AsRef<str>,
{
    Ok(local_ad_list())
}

fn local_recommendation_ad() -> Value {
    let mut ad = Map::new();
    ad.insert("id".to_string(), json!("9527code"));
    ad.insert("type".to_string(), json!("normal"));
    ad.insert("title".to_string(), json!("9527Code"));
    ad.insert(
        "description".to_string(),
        json!(
            "面向 Codex 与 AI 编程工作流的模型服务入口，注册流程简洁，适合希望快速接入开发工具的用户。"
        ),
    );
    ad.insert(
        "url".to_string(),
        json!("https://api.9527code.com/register?aff=YmeM"),
    );
    ad.insert(
        "image".to_string(),
        json!(data_uri("image/png", LOCAL_RECOMMENDATION_IMAGE)),
    );
    ad.insert(
        "highlights".to_string(),
        json!(["Codex 友好", "快速注册", "开发者服务"]),
    );
    Value::Object(ad)
}

fn data_uri(mime: &str, bytes: &[u8]) -> String {
    format!("data:{mime};base64,{}", base64_encode(bytes))
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        let second = *chunk.get(1).unwrap_or(&0);
        let third = *chunk.get(2).unwrap_or(&0);
        encoded.push(TABLE[(first >> 2) as usize] as char);
        encoded.push(TABLE[(((first & 0b0000_0011) << 4) | (second >> 4)) as usize] as char);
        if chunk.len() > 1 {
            encoded.push(TABLE[(((second & 0b0000_1111) << 2) | (third >> 6)) as usize] as char);
        } else {
            encoded.push('=');
        }
        if chunk.len() > 2 {
            encoded.push(TABLE[(third & 0b0011_1111) as usize] as char);
        } else {
            encoded.push('=');
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_recommendation_is_single_9527code_item() {
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
        assert!(ads[0].get("expires_at").is_none());
    }
}
