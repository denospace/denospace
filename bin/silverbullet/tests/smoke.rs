//! Boots the binary's server on a real ephemeral port and drives it over HTTP.
//! (The exhaustive endpoint matrix lands in a follow-up plan.)

mod common;
use common::free_port;

#[tokio::test]
async fn boots_and_serves_ping_config_and_bundle() {
    let dir = tempfile::tempdir().unwrap();
    let port = free_port();

    // Run the server in the background against a fresh temp space.
    let folder = dir.path().to_str().unwrap().to_string();
    std::env::set_var("SB_FOLDER", &folder);
    // Disable the headless-Chrome runtime so the test never launches a browser.
    std::env::set_var("SB_RUNTIME_API", "0");
    let handle = tokio::spawn(async move {
        // `run` blocks until shutdown; the test process exiting tears it down.
        let _ = silverbullet::server::run(Some("127.0.0.1".into()), Some(port), Some(folder), true)
            .await;
    });

    // Wait for the listener to come up.
    let base = format!("http://127.0.0.1:{port}");
    let client = reqwest::Client::new();
    let mut up = false;
    for _ in 0..50 {
        if client.get(format!("{base}/.ping")).send().await.is_ok() {
            up = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    assert!(up, "server did not start");

    // /.config returns the BootConfig JSON.
    let cfg: serde_json::Value = client
        .get(format!("{base}/.config"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(cfg["indexPage"], silverbullet_server::DEFAULT_INDEX_PAGE);

    // The SPA shell is served (templated, no leftover placeholders).
    let html = client
        .get(format!("{base}/"))
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(
        html.contains("<!doctype html"),
        "got: {}",
        &html[..html.len().min(200)]
    );
    assert!(!html.contains("{{"), "unresolved placeholder in shell");

    // An empty space is seeded with the shipped Org home page -- the file the
    // default index page names -- rather than a bare placeholder, and in the
    // language its own extension promises.
    let index = client
        .get(format!("{base}/.fs/{}", silverbullet_server::DEFAULT_INDEX_PAGE))
        .send()
        .await
        .unwrap();
    assert_eq!(index.status(), reqwest::StatusCode::OK);
    let index_body = index.text().await.unwrap();
    assert!(
        index_body.starts_with("#+title:      Home"),
        "seeded index must be the Org home, got: {index_body}"
    );
    assert!(
        index_body.contains("#+identifier: 00000000T000000"),
        "got: {index_body}"
    );

    handle.abort();
}
