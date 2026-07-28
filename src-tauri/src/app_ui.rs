use tauri::WebviewWindow;

pub(crate) fn sync_caption_colors(window: &WebviewWindow) {
    use std::{ffi::c_void, mem::size_of};
    use windows_sys::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR,
    };

    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let (caption, text) = match window.theme() {
        Ok(tauri::Theme::Dark) => (0x001c1c1c_u32, 0x00f5f5f5_u32),
        _ => (0x00f8f7fb_u32, 0x002a170f_u32),
    };
    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd.0,
            DWMWA_CAPTION_COLOR as u32,
            &caption as *const _ as *const c_void,
            size_of::<u32>() as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd.0,
            DWMWA_TEXT_COLOR as u32,
            &text as *const _ as *const c_void,
            size_of::<u32>() as u32,
        );
    }
}
