//! Pilotage d'Animotion par Claude (protocole MCP).
//!
//! Claude Desktop lance `Animotion.exe --mcp` (le « pont », sans fenêtre) qui parle MCP sur stdin/stdout.
//! Le pont transmet chaque action à la fenêtre Animotion ouverte via un petit serveur HTTP local
//! (127.0.0.1 uniquement, protégé par un jeton secret écrit dans le dossier de données de l'appli).

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Mutex};
use std::time::Duration;
use tauri::{Emitter, Manager};

const TOOLS: &str = include_str!("mcp_tools.json");
const IDENTIFIER: &str = "com.animotion.app";
const INSTRUCTIONS: &str = "Animotion est un logiciel d'animation image par image (pixel art ou dessin vectoriel). \
Appelle get_state d'abord. Les frames et calques sont numérotés à partir de 0 (calque 0 = tout en bas). \
Pour créer une animation entière, open_animo est le plus rapide ; pour retoucher, utilise draw_pixels / draw_shapes / read_frame. \
Vérifie ton travail avec get_frame_image. Ne jette jamais le travail non enregistré de l'utilisateur sans son accord (discard_changes). \
Tout ce que tu fais est annulable par l'utilisateur avec Ctrl+Z.";

// ------------------------------------------------------------------ côté fenêtre : serveur local

#[derive(Default)]
pub struct McpState {
    pending: Mutex<HashMap<u64, mpsc::Sender<String>>>,
    next: AtomicU64,
}

/// Dossier de données de l'appli, calculé sans Tauri (le pont n'a pas de fenêtre)
fn data_dir() -> PathBuf {
    #[cfg(windows)]
    let base = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
    #[cfg(not(windows))]
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
        .unwrap_or_else(|| PathBuf::from("."));
    base.join(IDENTIFIER)
}

fn random_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let mut s = String::new();
    for i in 0..4u64 {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(i);
        h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos());
        h.write_u32(std::process::id());
        s.push_str(&format!("{:016x}", h.finish()));
    }
    s
}

pub fn start_server(app: tauri::AppHandle) {
    let token = random_token();
    for port in 47801..47830u16 {
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", port)) {
            let dir = data_dir();
            let _ = std::fs::create_dir_all(&dir);
            let info = json!({ "port": port, "token": token, "pid": std::process::id() });
            let _ = std::fs::write(dir.join("mcp.json"), info.to_string());
            std::thread::spawn(move || {
                for stream in listener.incoming().flatten() {
                    let app = app.clone();
                    let token = token.clone();
                    std::thread::spawn(move || {
                        let _ = handle_http(stream, &app, &token);
                    });
                }
            });
            return;
        }
    }
}

fn handle_http(stream: TcpStream, app: &tauri::AppHandle, token: &str) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let path_ok = line.starts_with("POST /call ");
    let mut len = 0usize;
    let mut auth = false;
    loop {
        let mut h = String::new();
        if reader.read_line(&mut h)? == 0 || h == "\r\n" || h == "\n" {
            break;
        }
        let lower = h.to_ascii_lowercase();
        if let Some(v) = lower.strip_prefix("content-length:") {
            len = v.trim().parse().unwrap_or(0);
        }
        if let Some(v) = h.split_once(':').filter(|(k, _)| k.trim().eq_ignore_ascii_case("x-animotion-token")) {
            auth = v.1.trim() == token;
        }
    }
    let mut body = vec![0u8; len.min(64 * 1024 * 1024)];
    reader.read_exact(&mut body)?;
    let mut out = stream;
    if !path_ok || !auth {
        return write_http(&mut out, 403, r#"{"error":"accès refusé"}"#);
    }
    let req: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);

    // on transmet l'action à la fenêtre (JavaScript) et on attend sa réponse
    let state = app.state::<McpState>();
    let id = state.next.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = mpsc::channel();
    state.pending.lock().unwrap().insert(id, tx);
    let _ = app.emit("mcp-call", json!({ "id": id, "tool": req["tool"], "args": req["args"] }));
    let answer = rx.recv_timeout(Duration::from_secs(600)).unwrap_or_else(|_| {
        json!({ "content": [{ "type": "text", "text": "Animotion n'a pas répondu à temps." }], "isError": true }).to_string()
    });
    state.pending.lock().unwrap().remove(&id);
    write_http(&mut out, 200, &answer)
}

fn write_http(out: &mut TcpStream, code: u16, body: &str) -> std::io::Result<()> {
    let status = if code == 200 { "OK" } else { "Forbidden" };
    write!(
        out,
        "HTTP/1.1 {code} {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

/// Réponse de la fenêtre à une action de Claude
#[tauri::command]
pub fn mcp_reply(state: tauri::State<'_, McpState>, id: u64, payload: String) {
    if let Some(tx) = state.pending.lock().unwrap().remove(&id) {
        let _ = tx.send(payload);
    }
}

// ------------------------------------------------------------------ installation dans Claude Desktop

fn claude_config_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    #[cfg(windows)]
    {
        if let Some(a) = std::env::var_os("APPDATA") {
            dirs.push(PathBuf::from(a).join("Claude"));
        }
        // version Microsoft Store de Claude
        if let Some(l) = std::env::var_os("LOCALAPPDATA") {
            if let Ok(entries) = std::fs::read_dir(PathBuf::from(l).join("Packages")) {
                for e in entries.flatten() {
                    if e.file_name().to_string_lossy().to_lowercase().starts_with("claude") {
                        let d = e.path().join("LocalCache").join("Roaming").join("Claude");
                        if d.exists() {
                            dirs.push(d);
                        }
                    }
                }
            }
        }
    }
    #[cfg(target_os = "macos")]
    if let Some(h) = std::env::var_os("HOME") {
        dirs.push(PathBuf::from(h).join("Library/Application Support/Claude"));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    if let Some(h) = std::env::var_os("HOME") {
        dirs.push(PathBuf::from(h).join(".config/Claude"));
    }
    dirs
}

#[tauri::command]
pub fn mcp_exe_path() -> Result<String, String> {
    std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).map_err(|e| e.to_string())
}

/// Ajoute Animotion dans claude_desktop_config.json (sans toucher aux autres serveurs). Renvoie les fichiers modifiés.
#[tauri::command]
pub fn mcp_install() -> Result<Vec<String>, String> {
    let exe = mcp_exe_path()?;
    let mut done = Vec::new();
    let dirs = claude_config_dirs();
    // si Claude Desktop n'a jamais été lancé, on crée quand même le dossier classique
    let targets: Vec<PathBuf> = {
        let existing: Vec<PathBuf> = dirs.iter().filter(|d| d.exists()).cloned().collect();
        if existing.is_empty() { dirs.into_iter().take(1).collect() } else { existing }
    };
    for dir in targets {
        let file = dir.join("claude_desktop_config.json");
        let mut cfg: Value = match std::fs::read_to_string(&file) {
            Ok(txt) if !txt.trim().is_empty() => serde_json::from_str(&txt)
                .map_err(|e| format!("{} est illisible ({e}) : je n'y touche pas", file.display()))?,
            _ => json!({}),
        };
        if !cfg.is_object() {
            return Err(format!("{} n'a pas le format attendu", file.display()));
        }
        if file.exists() {
            let _ = std::fs::copy(&file, dir.join("claude_desktop_config.backup-animotion.json"));
        }
        let servers = cfg
            .as_object_mut()
            .unwrap()
            .entry("mcpServers")
            .or_insert_with(|| json!({}));
        if !servers.is_object() {
            *servers = json!({});
        }
        servers["animotion"] = json!({ "command": exe, "args": ["--mcp"] });
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::write(&file, serde_json::to_string_pretty(&cfg).unwrap()).map_err(|e| e.to_string())?;
        done.push(file.to_string_lossy().into_owned());
    }
    if done.is_empty() {
        return Err("dossier de configuration de Claude Desktop introuvable".into());
    }
    Ok(done)
}

// ------------------------------------------------------------------ côté Claude : le pont MCP (stdin/stdout)

pub fn run_bridge() {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
        let Some(id) = msg.get("id").cloned() else { continue }; // notification : pas de réponse
        let method = msg["method"].as_str().unwrap_or("");
        let reply = match method {
            "initialize" => json!({ "jsonrpc": "2.0", "id": id, "result": {
                "protocolVersion": msg["params"]["protocolVersion"].as_str().unwrap_or("2025-06-18"),
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "animotion", "version": env!("CARGO_PKG_VERSION") },
                "instructions": INSTRUCTIONS,
            }}),
            "ping" => json!({ "jsonrpc": "2.0", "id": id, "result": {} }),
            "tools/list" => json!({ "jsonrpc": "2.0", "id": id, "result": {
                "tools": serde_json::from_str::<Value>(TOOLS).unwrap_or(json!([]))
            }}),
            "tools/call" => json!({ "jsonrpc": "2.0", "id": id, "result": call_tool(&msg["params"]) }),
            _ => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": format!("méthode inconnue : {method}") } }),
        };
        let _ = writeln!(stdout, "{reply}");
        let _ = stdout.flush();
    }
}

fn call_tool(params: &Value) -> Value {
    let body = json!({ "tool": params["name"], "args": params.get("arguments").cloned().unwrap_or(json!({})) });
    match forward(&body) {
        Ok(v) if v.get("content").is_some() => v,
        Ok(v) => json!({ "content": [{ "type": "text", "text": v.to_string() }] }),
        Err(e) => json!({ "content": [{ "type": "text", "text": e }], "isError": true }),
    }
}

fn read_info() -> Option<(u16, String)> {
    let txt = std::fs::read_to_string(data_dir().join("mcp.json")).ok()?;
    let v: Value = serde_json::from_str(&txt).ok()?;
    Some((v["port"].as_u64()? as u16, v["token"].as_str()?.to_string()))
}

fn forward(body: &Value) -> Result<Value, String> {
    if let Some((port, token)) = read_info() {
        if let Ok(v) = http_post(port, &token, body) {
            return Ok(v);
        }
    }
    // Animotion n'est pas ouvert : on le lance et on attend qu'il soit prêt
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(data_dir().join("mcp.json"));
    let mut cmd = std::process::Command::new(exe);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0000_0008); // DETACHED_PROCESS
    }
    cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    cmd.spawn().map_err(|e| format!("impossible de lancer Animotion : {e}"))?;
    for _ in 0..100 {
        std::thread::sleep(Duration::from_millis(300));
        if let Some((port, token)) = read_info() {
            // on laisse à l'interface le temps de se charger
            std::thread::sleep(Duration::from_millis(1200));
            return http_post(port, &token, body);
        }
    }
    Err("Animotion ne répond pas. Ouvre l'application puis réessaie.".into())
}

fn http_post(port: u16, token: &str, body: &Value) -> Result<Value, String> {
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_secs(2)).map_err(|e| e.to_string())?;
    s.set_read_timeout(Some(Duration::from_secs(620))).ok();
    let data = body.to_string();
    write!(
        s,
        "POST /call HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nX-Animotion-Token: {token}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{data}",
        data.len()
    )
    .map_err(|e| e.to_string())?;
    let mut resp = Vec::new();
    s.read_to_end(&mut resp).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&resp);
    let (head, body) = text.split_once("\r\n\r\n").ok_or("réponse invalide")?;
    let status_ok = head.lines().next().map(|l| l.split_whitespace().nth(1) == Some("200")).unwrap_or(false);
    if !status_ok {
        return Err(format!("Animotion a refusé l'action ({})", head.lines().next().unwrap_or("")));
    }
    serde_json::from_str(body).map_err(|e| e.to_string())
}
