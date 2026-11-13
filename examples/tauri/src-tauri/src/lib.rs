use tauri::{LogicalSize, Manager, Theme};

#[tauri::command]
fn greet(name: &str) -> String {
    // The Rust side's output: facetshot puts it in the logs next to each screenshot of the real window.
    println!("greet called for {name}");
    format!("Hello, {name}! You have 3 things saved.")
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![greet])
        .setup(|app| {
            // facetshot's window engine can't resize or re-theme another app's window from outside, so it says
            // what it wants in the environment and the app does it itself. Without FACETSHOT set, nothing changes.
            if std::env::var("FACETSHOT").is_ok() {
                if let Some(window) = app.get_webview_window("main") {
                    let size = |name: &str| std::env::var(name).ok().and_then(|value| value.parse::<f64>().ok());
                    if let (Some(width), Some(height)) = (size("FACETSHOT_WIDTH"), size("FACETSHOT_HEIGHT")) {
                        window.set_size(LogicalSize::new(width, height))?;
                    }
                    let theme = match std::env::var("FACETSHOT_APPEARANCE").as_deref() {
                        Ok("dark") => Some(Theme::Dark),
                        Ok("light") => Some(Theme::Light),
                        _ => None,
                    };
                    window.set_theme(theme)?;
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Pebble app");
}
