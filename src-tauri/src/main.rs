// Pas de console noire derrière la fenêtre en version finale
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::ipc::{InvokeBody, Request, Response};

mod mcp;

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
        InvokeBody::Raw(bytes) => {
            if let Some(parent) = std::path::Path::new(&path).parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            std::fs::write(&path, bytes).map_err(|e| e.to_string())
        }
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
             for ($i = 0; $i -lt 40; $i++) {{ try {{ Remove-Item -Force '{dst}.old' -ErrorAction SilentlyContinue; Move-Item -Force '{dst}' '{dst}.old' -ErrorAction Stop; Copy-Item -Force '{src}' '{dst}' -ErrorAction Stop; break }} catch {{ Start-Sleep -Milliseconds 250 }} }}; \
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

// ------------------------------------------------------------------ Copie de secours
// Le projet en cours est recopié régulièrement dans le dossier de données de l'appli,
// pour pouvoir le récupérer après un plantage de l'appli ou du PC.

fn recovery_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("secours");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Écriture "atomique" : fichier temporaire + vidage sur disque + renommage.
/// Une coupure de courant en plein milieu ne peut pas abîmer l'ancienne copie.
fn write_atomic(path: &std::path::Path, data: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let tmp = path.with_extension("tmp");
    let mut f = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    f.write_all(data).map_err(|e| e.to_string())?;
    f.sync_all().map_err(|e| e.to_string())?;
    drop(f);
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[tauri::command]
fn recovery_write(app: tauri::AppHandle, request: Request<'_>) -> Result<(), String> {
    let meta = request
        .headers()
        .get("x-meta")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .unwrap_or_else(|| "{}".into());
    let dir = recovery_dir(&app)?;
    match request.body() {
        InvokeBody::Raw(bytes) => {
            write_atomic(&dir.join("projet.animo"), bytes)?;
            write_atomic(&dir.join("infos.json"), meta.as_bytes())
        }
        _ => Err("contenu invalide".into()),
    }
}

#[tauri::command]
fn recovery_meta(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let dir = recovery_dir(&app)?;
    if !dir.join("projet.animo").exists() {
        return Ok(None);
    }
    Ok(std::fs::read_to_string(dir.join("infos.json")).ok())
}

#[tauri::command]
fn recovery_read(app: tauri::AppHandle) -> Result<Response, String> {
    let dir = recovery_dir(&app)?;
    std::fs::read(dir.join("projet.animo")).map(Response::new).map_err(|e| e.to_string())
}

#[tauri::command]
fn recovery_clear(app: tauri::AppHandle) -> Result<(), String> {
    let dir = recovery_dir(&app)?;
    let _ = std::fs::remove_file(dir.join("projet.animo"));
    let _ = std::fs::remove_file(dir.join("infos.json"));
    Ok(())
}

// ------------------------------------------------------------------ Discord Rich Presence
// Affiche « Joue à Animotion » sur le profil Discord. Si Discord n'est pas lancé, on ignore
// simplement l'erreur et on réessaiera à la prochaine mise à jour du statut.
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::Mutex;

#[derive(Default)]
struct Discord(Mutex<Option<(String, DiscordIpcClient)>>);

#[tauri::command]
async fn discord_set(
    discord: tauri::State<'_, Discord>,
    client_id: String,
    details: String,
    state: String,
    start: i64,
    image: String,
    button_label: String,
    button_url: String,
) -> Result<(), String> {
    let mut guard = discord.0.lock().map_err(|e| e.to_string())?;
    // (re)connexion si besoin, ou si l'identifiant d'application a changé
    if guard.as_ref().map(|(id, _)| id != &client_id).unwrap_or(true) {
        if let Some((_, mut old)) = guard.take() {
            let _ = old.close();
        }
        let mut client = DiscordIpcClient::new(&client_id);
        client.connect().map_err(|e| format!("Discord introuvable : {e}"))?;
        *guard = Some((client_id.clone(), client));
    }
    let (_, client) = guard.as_mut().unwrap();
    let mut act = activity::Activity::new()
        .details(details.as_str())
        .state(state.as_str())
        .timestamps(activity::Timestamps::new().start(start))
        .assets(activity::Assets::new().large_image(image.as_str()).large_text("Animotion"));
    if !button_url.is_empty() {
        act = act.buttons(vec![activity::Button::new(button_label.as_str(), button_url.as_str())]);
    }
    if let Err(e) = client.set_activity(act) {
        // connexion perdue (Discord fermé) : on repartira de zéro la prochaine fois
        if let Some((_, mut c)) = guard.take() {
            let _ = c.close();
        }
        return Err(format!("Discord déconnecté : {e}"));
    }
    Ok(())
}

#[tauri::command]
async fn discord_clear(discord: tauri::State<'_, Discord>) -> Result<(), String> {
    let mut guard = discord.0.lock().map_err(|e| e.to_string())?;
    if let Some((_, mut c)) = guard.take() {
        let _ = c.clear_activity();
        let _ = c.close();
    }
    Ok(())
}

fn main() {
    // Lancé par Claude Desktop : pont MCP sans fenêtre
    if std::env::args().any(|a| a == "--mcp") {
        mcp::run_bridge();
        return;
    }
    // Connexion à Claude Desktop en ligne de commande (même chose que le bouton de l'appli)
    if std::env::args().any(|a| a == "--mcp-install") {
        match mcp::mcp_install() {
            Ok(files) => println!("Animotion ajouté dans : {}", files.join(", ")),
            Err(e) => eprintln!("Erreur : {e}"),
        }
        return;
    }
    // ménage après une mise à jour : l'ancien exe renommé
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::fs::remove_file(exe.with_extension("exe.old"));
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Discord::default())
        .manage(mcp::McpState::default())
        .setup(|app| {
            mcp::start_server(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            write_file,
            read_file,
            install_update,
            recovery_write,
            recovery_meta,
            recovery_read,
            recovery_clear,
            discord_set,
            discord_clear,
            mcp::mcp_reply,
            mcp::mcp_install,
            mcp::mcp_exe_path
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement d'Animotion");
}
