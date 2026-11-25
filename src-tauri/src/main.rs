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

/// Mise à jour : télécharge le nouvel Animotion.exe, puis le remplace et relance l'appli.
/// Fonctionne pour la version portable comme pour la version installée (on remplace l'exe en cours).
#[tauri::command]
async fn install_update(app: tauri::AppHandle, url: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        const NO_WINDOW: u32 = 0x0800_0000;

        if !url.starts_with("https://github.com/") {
            return Err("adresse de mise à jour invalide".into());
        }
        let current = std::env::current_exe().map_err(|e| e.to_string())?;
        let tmp = std::env::temp_dir().join("Animotion-maj.exe");
        let _ = std::fs::remove_file(&tmp);
        let q = |p: &std::path::Path| p.to_string_lossy().replace('\'', "''");

        // 1. Téléchargement (on attend la fin pour pouvoir signaler une erreur)
        let dl = format!(
            "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol='Tls12'; \
             Invoke-WebRequest -UseBasicParsing -Uri '{}' -OutFile '{}'",
            url.replace('\'', "''"),
            q(&tmp)
        );
        let status = Command::new("powershell")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &dl])
            .creation_flags(NO_WINDOW)
            .status()
            .map_err(|e| e.to_string())?;
        let size = std::fs::metadata(&tmp).map(|m| m.len()).unwrap_or(0);
        if !status.success() || size < 100_000 {
            return Err("le téléchargement a échoué".into());
        }

        // 2. Script détaché : attend la fermeture, remplace l'exe, relance
        let swap = format!(
            "Wait-Process -Id {pid} -ErrorAction SilentlyContinue; \
             for ($i = 0; $i -lt 40; $i++) {{ try {{ Copy-Item -Force '{src}' '{dst}' -ErrorAction Stop; break }} catch {{ Start-Sleep -Milliseconds 250 }} }}; \
             Remove-Item -Force '{src}' -ErrorAction SilentlyContinue; Start-Process '{dst}'",
            pid = std::process::id(),
            src = q(&tmp),
            dst = q(&current)
        );
        Command::new("powershell")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", &swap])
            .creation_flags(NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;

        // 3. On ferme l'appli pour libérer l'exe
        app.exit(0);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, url);
        Err("mise à jour automatique disponible uniquement sous Windows".into())
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![write_file, read_file, install_update])
        .run(tauri::generate_context!())
        .expect("erreur au lancement d'Animotion");
}
