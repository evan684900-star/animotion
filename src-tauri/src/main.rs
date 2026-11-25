// Pas de console noire derrière la fenêtre en version finale
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::ipc::{InvokeBody, Request, Response};

/// Décode un chemin encodé avec encodeURIComponent côté JS (les en-têtes HTTP doivent rester en ASCII).
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Écrit des octets bruts (projet, PNG, GIF, vidéo…) à l'emplacement choisi dans la boîte de dialogue.
#[tauri::command]
fn write_file(request: Request<'_>) -> Result<(), String> {
    let path = request
        .headers()
        .get("x-path")
        .ok_or("chemin manquant")?
        .to_str()
        .map_err(|e| e.to_string())?;
    let path = percent_decode(path);
    match request.body() {
        InvokeBody::Raw(bytes) => std::fs::write(&path, bytes).map_err(|e| e.to_string()),
        _ => Err("contenu invalide".into()),
    }
}

/// Lit un fichier choisi par l'utilisateur et le renvoie en binaire.
#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    std::fs::read(&path).map(Response::new).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![write_file, read_file])
        .run(tauri::generate_context!())
        .expect("erreur au lancement d'Animotion");
}
