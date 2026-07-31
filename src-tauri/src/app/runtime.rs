use std::{
    collections::{BTreeSet, HashMap},
    fs,
    sync::{Arc, Mutex},
};

use reqwest::Client;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    Manager, PhysicalPosition, PhysicalSize, WindowEvent,
};

use crate::{
    models::{GroupRate, StationSnapshot},
    services::gateway::{
        load_gateway_settings, load_or_create_gateway_token, restore_persisted_gateway_route,
        set_gateway_route, set_tray_routing_mode, GatewayController, RoutingMode,
    },
    station_store::StationStore,
    store::Store,
    AppState,
};

#[cfg(windows)]
use crate::app_ui::sync_caption_colors;

fn tray_balance_label(balance: Option<f64>) -> String {
    balance
        .map(|value| format!("余额 · {value:.2}"))
        .unwrap_or_else(|| "余额 · --".into())
}

fn tray_rate_label(rate: &GroupRate) -> String {
    match (rate.input_multiplier, rate.output_multiplier) {
        (Some(input), Some(output)) => format!(
            "{} · {} · ×{:.2}（输入 ×{input:.2} / 输出 ×{output:.2}）",
            rate.group, rate.model, rate.multiplier
        ),
        _ => format!("{} · {} · ×{:.2}", rate.group, rate.model, rate.multiplier),
    }
}

/// Starts the desktop shell after the command handler has been assembled in `lib.rs`.
///
/// Keeping lifecycle concerns here means command registration stays an explicit,
/// auditable boundary in the crate root while setup, tray, and window behaviour are
/// owned by the application shell.
pub(crate) fn run() {
    crate::application_builder()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            let directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
            fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
            let store = Store::open(directory.join("api-assistant.sqlite"))?;
            let client = Client::builder()
                .user_agent(format!(
                    "RelayHub/{} ({}; {})",
                    env!("CARGO_PKG_VERSION"),
                    std::env::consts::OS,
                    std::env::consts::ARCH
                ))
                .build()
                .map_err(|e| e.to_string())?;
            let (mode, port) = load_gateway_settings(&store)?;
            let token = load_or_create_gateway_token()?;
            let gateway = GatewayController::new(client.clone(), token, port);
            app.manage(AppState {
                store: Mutex::new(store),
                client,
                gateway,
                auth_backoff: Mutex::new(HashMap::new()),
                remote_operations: Arc::new(Mutex::new(HashMap::new())),
                sync_operations: Arc::new(Mutex::new(HashMap::new())),
                sync_progress: Mutex::new(HashMap::new()),
            });
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                sync_caption_colors(&window);
            }
            if let (Some(main), Some(market)) = (
                app.get_webview_window("main"),
                app.get_webview_window("merchant-market"),
            ) {
                let main_size = main.outer_size()?;
                let main_position = main.outer_position()?;
                let market_size = market.outer_size()?;
                let mut x = main_position.x + main_size.width as i32;
                if let Some(monitor) = main.current_monitor()? {
                    let work_area = monitor.work_area();
                    if x + market_size.width as i32 > work_area.position.x + work_area.size.width as i32 {
                        x = main_position.x - market_size.width as i32;
                    }
                }
                market.set_size(PhysicalSize::new(market_size.width, main_size.height))?;
                market.set_position(PhysicalPosition::new(x, main_position.y))?;
                market.show()?;
            }
            if mode == RoutingMode::LocalGateway {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let state = app_handle.state::<AppState>();
                    let _ = restore_persisted_gateway_route(&state).await;
                    let _ = state.gateway.start().await;
                });
            }
            let is_local_gateway = mode == RoutingMode::LocalGateway;
            let gateway_running = app.state::<AppState>().gateway.is_running();
            let (tray_stations, active_station_id, active_key_id) = {
                let state = app.state::<AppState>();
                let store = state
                    .store
                    .lock()
                    .map_err(|_| "本地数据库不可用".to_string())?;
                let stations = store
                    .list_stations()?
                    .into_iter()
                    .take(12)
                    .map(|station| (station, None::<StationSnapshot>))
                    .collect::<Vec<_>>();
                (stations, None::<String>, None::<String>)
            };
            let dashboard = MenuItem::with_id(app, "show", "仪表板", true, None::<&str>)?;
            let stations_menu = Submenu::new(app, "站点", true)?;
            if tray_stations.is_empty() {
                let empty_stations = MenuItem::new(app, "还没有已同步的站点", false, None::<&str>)?;
                stations_menu.append(&empty_stations)?;
            } else {
                for (station, snapshot) in tray_stations {
                    let station_menu =
                        Submenu::new(app, format!("{} · {}", station.name, station.status), true)?;
                    let balance = MenuItem::new(
                        app,
                        snapshot
                            .as_ref()
                            .map(|snapshot| tray_balance_label(snapshot.station_balance))
                            .unwrap_or_else(|| "余额 · --".into()),
                        false,
                        None::<&str>,
                    )?;
                    station_menu.append(&balance)?;
                    let separator = PredefinedMenuItem::separator(app)?;
                    station_menu.append(&separator)?;
                    let groups_menu = Submenu::new(app, "分组与倍率", true)?;
                    match snapshot {
                        Some(snapshot) => {
                            let mut groups = BTreeSet::new();
                            for rate in &snapshot.rates {
                                groups.insert(rate.group.clone());
                            }
                            for key in &snapshot.api_keys {
                                groups
                                    .insert(key.group.clone().unwrap_or_else(|| "默认分组".into()));
                            }
                            if groups.is_empty() {
                                let empty_groups =
                                    MenuItem::new(app, "暂无分组或倍率数据", false, None::<&str>)?;
                                groups_menu.append(&empty_groups)?;
                            }
                            for group in groups {
                                let group_menu = Submenu::new(app, &group, true)?;
                                let group_keys = snapshot
                                    .api_keys
                                    .iter()
                                    .filter(|key| {
                                        key.group.as_deref().unwrap_or("默认分组") == group
                                    })
                                    .collect::<Vec<_>>();
                                if group_keys.is_empty() {
                                    let no_keys =
                                        MenuItem::new(app, "暂无可选密钥", false, None::<&str>)?;
                                    group_menu.append(&no_keys)?;
                                } else {
                                    for key in group_keys {
                                        let is_active = active_station_id.as_deref()
                                            == Some(station.id.as_str())
                                            && active_key_id.as_deref() == Some(key.id.as_str());
                                        let key_label = format!(
                                            "{}{} · {}",
                                            if is_active { "● " } else { "" },
                                            key.name,
                                            key.masked_key
                                        );
                                        let key_item = MenuItem::with_id(
                                            app,
                                            format!("gateway-route:{}:{}", station.id, key.id),
                                            key_label,
                                            is_local_gateway,
                                            None::<&str>,
                                        )?;
                                        group_menu.append(&key_item)?;
                                    }
                                }
                                let group_rates = snapshot
                                    .rates
                                    .iter()
                                    .filter(|rate| rate.group == group)
                                    .take(20)
                                    .collect::<Vec<_>>();
                                if !group_rates.is_empty() {
                                    let separator = PredefinedMenuItem::separator(app)?;
                                    group_menu.append(&separator)?;
                                    for rate in group_rates {
                                        let rate_item = MenuItem::new(
                                            app,
                                            tray_rate_label(rate),
                                            false,
                                            None::<&str>,
                                        )?;
                                        group_menu.append(&rate_item)?;
                                    }
                                }
                                groups_menu.append(&group_menu)?;
                            }
                        }
                        None => {
                            let stale = MenuItem::new(
                                app,
                                "站点详情请在 RelayHub 中查看",
                                false,
                                None::<&str>,
                            )?;
                            groups_menu.append(&stale)?;
                        }
                    }
                    station_menu.append(&groups_menu)?;
                    stations_menu.append(&station_menu)?;
                }
            }
            let separator_primary = PredefinedMenuItem::separator(app)?;
            let cc_switch = CheckMenuItem::with_id(
                app,
                "mode-cc-switch",
                "CC Switch",
                true,
                !is_local_gateway,
                None::<&str>,
            )?;
            let local_gateway = CheckMenuItem::with_id(
                app,
                "mode-local-gateway",
                "本地稳定入口",
                true,
                is_local_gateway,
                None::<&str>,
            )?;
            let routing_mode =
                Submenu::with_items(app, "中转模式", true, &[&cc_switch, &local_gateway])?;
            let gateway_status = MenuItem::with_id(
                app,
                "gateway-status",
                if is_local_gateway {
                    if gateway_running {
                        format!("本地网关 · 运行中 · 127.0.0.1:{port}")
                    } else {
                        format!("本地网关 · 未运行 · 127.0.0.1:{port}")
                    }
                } else {
                    "本地网关 · 已暂停（CC Switch 模式）".into()
                },
                false,
                None::<&str>,
            )?;
            let separator_gateway = PredefinedMenuItem::separator(app)?;
            let start_gateway = MenuItem::with_id(
                app,
                "gateway-start",
                "启动本地网关",
                is_local_gateway && !gateway_running,
                None::<&str>,
            )?;
            let stop_gateway = MenuItem::with_id(
                app,
                "gateway-stop",
                "停止本地网关",
                is_local_gateway && gateway_running,
                None::<&str>,
            )?;
            let gateway_menu = Submenu::with_items(
                app,
                "本地网关",
                true,
                &[
                    &gateway_status,
                    &separator_gateway,
                    &start_gateway,
                    &stop_gateway,
                ],
            )?;
            let separator_quit = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "退出 RelayHub", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &dashboard,
                    &stations_menu,
                    &separator_primary,
                    &routing_mode,
                    &gateway_menu,
                    &separator_quit,
                    &quit,
                ],
            )?;
            let mut tray = TrayIconBuilder::with_id("main")
                .menu(&menu)
                .tooltip("RelayHub");
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.on_menu_event(move |app, event| match event.id.as_ref() {
                id if id.starts_with("gateway-route:") => {
                    let mut ids = id.trim_start_matches("gateway-route:").splitn(2, ':');
                    let station_id = ids.next().unwrap_or_default().to_string();
                    let key_id = ids.next().unwrap_or_default().to_string();
                    if !station_id.is_empty() && !key_id.is_empty() {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let state = app.state::<AppState>();
                            let _ = set_gateway_route(&state, station_id, key_id).await;
                        });
                    }
                }
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                    if let Some(window) = app.get_webview_window("merchant-market") {
                        let _ = window.show();
                    }
                }
                "mode-cc-switch" => {
                    let _ = cc_switch.set_checked(true);
                    let _ = local_gateway.set_checked(false);
                    let _ = gateway_status.set_text("本地网关 · 已暂停（CC Switch 模式）");
                    let _ = start_gateway.set_enabled(false);
                    let _ = stop_gateway.set_enabled(false);
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = set_tray_routing_mode(app, RoutingMode::CcSwitch).await;
                    });
                }
                "mode-local-gateway" => {
                    let _ = cc_switch.set_checked(false);
                    let _ = local_gateway.set_checked(true);
                    let _ =
                        gateway_status.set_text(format!("本地网关 · 正在启动 · 127.0.0.1:{port}"));
                    let _ = start_gateway.set_enabled(false);
                    let _ = stop_gateway.set_enabled(true);
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = set_tray_routing_mode(app, RoutingMode::LocalGateway).await;
                    });
                }
                "gateway-start" => {
                    let _ =
                        gateway_status.set_text(format!("本地网关 · 正在启动 · 127.0.0.1:{port}"));
                    let _ = start_gateway.set_enabled(false);
                    let _ = stop_gateway.set_enabled(true);
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let state = app.state::<AppState>();
                        if state.gateway.runtime_snapshot().await.route.is_none() {
                            let _ = restore_persisted_gateway_route(&state).await;
                        }
                        let _ = state.gateway.start().await;
                    });
                }
                "gateway-stop" => {
                    let state = app.state::<AppState>();
                    state.gateway.stop();
                    let _ =
                        gateway_status.set_text(format!("本地网关 · 未运行 · 127.0.0.1:{port}"));
                    let _ = start_gateway.set_enabled(true);
                    let _ = stop_gateway.set_enabled(false);
                }
                "quit" => app.exit(0),
                _ => {}
            })
            .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    if let Some(market) = window.app_handle().get_webview_window("merchant-market") {
                        let _ = market.hide();
                    }
                }
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running RelayHub");
}
