
/// List invocable skills from `grok inspect --json` plus project-disk scan.
///
/// - Global / user / plugin / bundled: from inspect when available.
/// - Project: also scans `{project}/.grok/skills/*/SKILL.md` on disk.
/// - Name collision: **project wins** (case-insensitive).
///
/// Always returns Ok; on CLI missing / timeout, `skills` may still include
/// project-scanned rows and `error` is set for the inspect failure.
/// Each skill includes `enabled` from App Extensions prefs (default true).
///
/// When `ssh_alias` is set, inspect and the project skill scan run on the
/// remote host. Do not treat the remote path as a local `std::fs` cwd.
#[tauri::command]
pub async fn skills_list(
    project_path: Option<String>,
    ssh_alias: Option<String>,
) -> Result<serde_json::Value, String> {
    let alias = ssh_alias
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let (parsed, error, project_skills, skill_roots) = if let Some(alias) = alias {
        let fetch = crate::ssh_remote::ssh_fetch_skills(&alias, project_path.as_deref()).await;
        let project_skills: Vec<SkillDto> = fetch
            .project_skills
            .into_iter()
            .map(|s| SkillDto {
                name: s.name,
                description: s.description,
                source: s.source,
                path: s.path,
                user_invocable: s.user_invocable,
                plugin_name: None,
            })
            .collect();
        (
            fetch.inspect,
            fetch.error,
            project_skills,
            Vec::<String>::new(),
        )
    } else {
        let path = project_path.clone();
        let path_for_scan = project_path.clone();
        let (parsed, error, project_skills) = tauri::async_runtime::spawn_blocking(move || {
            let (parsed, error) = run_grok_inspect(path.as_deref());
            let project_skills = scan_project_skills(path_for_scan.as_deref());
            (parsed, error, project_skills)
        })
        .await
        .map_err(|e| e.to_string())?;
        let skill_roots = crate::skill_edit::skill_roots_list(project_path.as_deref());
        (parsed, error, project_skills, skill_roots)
    };

    let inspect_skills = parsed.as_ref().map(parse_skills).unwrap_or_default();
    let skills = merge_skills_prefer_project(inspect_skills, project_skills);
    let flags = crate::skill_compat::load_discover_flags();
    let hidden_count = skills
        .iter()
        .filter(|s| {
            !crate::skill_compat::should_keep_skill(&s.source, s.path.as_deref(), &flags)
        })
        .count() as u32;
    let skills: Vec<SkillDto> = skills
        .into_iter()
        .filter(|s| crate::skill_compat::should_keep_skill(&s.source, s.path.as_deref(), &flags))
        .collect();
    let discover = crate::skill_compat::snapshot_from(&flags, hidden_count);
    let skills = attach_skill_enabled(skills);
    let mut out = serde_json::json!({
        "skills": skills,
        "skillRoots": skill_roots,
        "discoverExternal": discover,
    });
    if let Some(err) = error {
        out["error"] = serde_json::Value::String(err);
    }
    Ok(out)
}

/// Toggle Claude/Cursor skill discovery (App overlay; independent also writes config.toml).
#[tauri::command]
pub async fn skills_compat_set(enabled: bool) -> Result<crate::skill_compat::SkillsCompatSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let flags = crate::skill_compat::set_discover_external(enabled)?;
        Ok(crate::skill_compat::snapshot_from(&flags, 0))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Read a user-editable SKILL.md (allowlisted skills roots only).
#[tauri::command]
pub async fn skill_read(
    path: String,
    project_path: Option<String>,
) -> Result<crate::skill_edit::SkillReadResult, String> {
    let path = path.clone();
    let project_path = project_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::skill_edit::skill_read(&path, project_path.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Write a user-editable SKILL.md (allowlisted skills roots only).
#[tauri::command]
pub async fn skill_write(
    path: String,
    content: String,
    expected_mtime_ms: Option<u64>,
    project_path: Option<String>,
) -> Result<crate::skill_edit::SkillWriteResult, String> {
    let path = path.clone();
    let content = content.clone();
    let project_path = project_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::skill_edit::skill_write(
            &path,
            &content,
            expected_mtime_ms,
            project_path.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Absolute paths of allowlisted skill roots (for UI edit affordances).
#[tauri::command]
pub async fn skill_roots(project_path: Option<String>) -> Result<Vec<String>, String> {
    Ok(crate::skill_edit::skill_roots_list(project_path.as_deref()))
}

/// Scaffold a new skill directory + SKILL.md under user (path-scoped GROK_HOME)
/// or project skills root. Does not overwrite an existing SKILL.md.
#[tauri::command]
pub async fn skill_create(
    name: String,
    description: Option<String>,
    project_path: Option<String>,
    scope: Option<String>,
) -> Result<crate::skill_edit::SkillCreateResult, String> {
    let name = name.clone();
    let description = description.unwrap_or_default();
    let project_path = project_path.clone();
    let scope = scope.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::skill_edit::skill_create(
            &name,
            &description,
            project_path.as_deref(),
            scope.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// List MCP servers from `grok inspect --json`.
/// Always returns Ok; on CLI missing / timeout, `servers` is empty and `error` is set.
/// Each server includes `enabled` from App Extensions prefs (default true).
#[tauri::command]
pub async fn inspect_mcp(project_path: Option<String>) -> Result<serde_json::Value, String> {
    let path = project_path.clone();
    let (parsed, error) = tauri::async_runtime::spawn_blocking(move || {
        run_grok_inspect(path.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?;

    let mut servers = parsed.as_ref().map(parse_mcp_servers).unwrap_or_default();
    let prefs = crate::extensions::load_prefs();
    let plugin_defs = crate::plugin_mcp::discover_plugin_mcp_servers();
    let plugin_names: std::collections::HashSet<String> =
        plugin_defs.iter().map(|d| d.name.clone()).collect();
    // Enrich with enable state for UI toggles.
    let mut server_json = Vec::with_capacity(servers.len() + plugin_defs.len());
    let mut listed: std::collections::HashSet<String> = std::collections::HashSet::new();
    for s in servers.drain(..) {
        let enabled = crate::extensions::is_enabled(&prefs.mcp, &s.name);
        let from_plugin = plugin_names.contains(&s.name);
        listed.insert(s.name.clone());
        let plugin_name = from_plugin.then(|| s.name.clone());
        let auth_kind = plugin_defs
            .iter()
            .find(|d| d.name == s.name)
            .and_then(crate::plugin_mcp::plugin_auth_kind_for_def);
        server_json.push(serde_json::json!({
            "name": s.name,
            "transport": s.transport,
            "target": s.target,
            "vendor": if from_plugin {
                Some("plugin".to_string())
            } else {
                s.vendor
            },
            "compatibilityStatus": s.compatibility_status,
            "fromPlugin": from_plugin,
            "pluginName": plugin_name,
            "authKind": auth_kind,
            "enabled": enabled,
        }));
    }
    for def in plugin_defs {
        if listed.contains(&def.name) {
            continue;
        }
        let enabled = crate::extensions::is_enabled(&prefs.mcp, &def.name);
        listed.insert(def.name.clone());
        server_json.push(crate::plugin_mcp::mcp_def_to_inspect_json(&def, enabled));
    }
    let mut out = serde_json::json!({ "servers": server_json });
    if let Some(err) = error {
        out["error"] = serde_json::Value::String(err);
    }
    Ok(out)
}

// ── Project inspect summary (Settings → Runtime) ─────────────────────────────

const PROJECT_INSPECT_SKILL_SAMPLE: usize = 12;

/// Detect `<project>/.grok` when the path is a real directory.
fn project_grok_dir(project_path: Option<&str>) -> (bool, Option<String>) {
    let Some(raw) = project_path.map(str::trim).filter(|s| !s.is_empty()) else {
        return (false, None);
    };
    let p = std::path::Path::new(raw).join(".grok");
    if p.is_dir() {
        (true, Some(p.to_string_lossy().to_string()))
    } else {
        (false, Some(p.to_string_lossy().to_string()))
    }
}

fn json_str(v: Option<&serde_json::Value>) -> Option<String> {
    v.and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

fn skill_source_label(source: &serde_json::Value) -> String {
    if let Some(s) = source.as_str() {
        return s.trim().to_lowercase();
    }
    if let Some(obj) = source.as_object() {
        if let Some(t) = obj.get("type").and_then(|x| x.as_str()) {
            return t.trim().to_lowercase();
        }
    }
    "unknown".into()
}

/// Build a secret-safe summary DTO from `grok inspect --json`.
/// Only known safe fields are copied — never forward raw env/headers/secrets.
fn build_project_inspect_summary(
    parsed: Option<&serde_json::Value>,
    project_path: Option<&str>,
    error: Option<String>,
    models_hints: Vec<String>,
) -> serde_json::Value {
    let (has_grok, grok_path) = project_grok_dir(project_path);
    let path_trim = project_path
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let mut models_hints = models_hints;
    let mut seen_models: std::collections::HashSet<String> =
        models_hints.iter().cloned().collect();
    let mut push_model = |s: String| {
        let t = s.trim().to_string();
        if t.is_empty() || seen_models.contains(&t) {
            return;
        }
        seen_models.insert(t.clone());
        models_hints.push(t);
    };

    let Some(v) = parsed else {
        return serde_json::json!({
            "projectPath": path_trim,
            "projectRoot": null,
            "projectTrusted": null,
            "cwd": null,
            "grokVersion": null,
            "channel": null,
            "hasProjectGrokDir": has_grok,
            "projectGrokPath": if has_grok { grok_path } else { None::<String> },
            "rules": [],
            "plugins": [],
            "skills": {
                "total": 0,
                "userInvocable": 0,
                "bySource": {},
                "sample": [],
                "names": [],
            },
            "mcp": [],
            "agents": [],
            "hooks": [],
            "hooksCount": 0,
            "configLayers": [],
            "modelsHints": models_hints,
            "permissions": {
                "loaded": 0,
                "sourcesCount": 0,
                "managedSettingsActive": false,
                "managedSettingsExists": null,
                "managedSettingsPath": null,
            },
            "error": error,
        });
    };

    let project_root = json_str(v.get("projectRoot"));
    let project_path_out = path_trim
        .clone()
        .or_else(|| project_root.clone());

    // Rules / project instructions — paths only.
    let mut rules = Vec::new();
    let instr = v
        .get("projectInstructions")
        .or_else(|| v.get("rules"))
        .and_then(|x| x.as_array());
    if let Some(arr) = instr {
        for item in arr {
            let path = json_str(item.get("path"));
            let Some(path) = path else { continue };
            rules.push(serde_json::json!({
                "path": path,
                "scope": json_str(item.get("scope")),
                "fileType": json_str(item.get("fileType"))
                    .or_else(|| json_str(item.get("file_type"))),
                "sizeBytes": item.get("sizeBytes").and_then(|x| x.as_u64())
                    .or_else(|| item.get("size_bytes").and_then(|x| x.as_u64())),
            }));
        }
    }

    // Plugins — no free-form blobs.
    let mut plugins = Vec::new();
    if let Some(arr) = v.get("plugins").and_then(|x| x.as_array()) {
        for item in arr {
            let name = json_str(item.get("name"));
            let Some(name) = name else { continue };
            let provides = item.get("provides").map(|p| {
                serde_json::json!({
                    "skills": p.get("skills").and_then(|x| x.as_u64()).unwrap_or(0),
                    "agents": p.get("agents").and_then(|x| x.as_u64()).unwrap_or(0),
                    "hooks": p.get("hooks").and_then(|x| x.as_bool()).unwrap_or(false),
                    "mcpServers": p.get("mcpServers")
                        .or_else(|| p.get("mcp_servers"))
                        .and_then(|x| x.as_u64())
                        .unwrap_or(0),
                })
            });
            plugins.push(serde_json::json!({
                "name": name,
                "scope": json_str(item.get("scope")),
                "enabled": item.get("enabled").and_then(|x| x.as_bool()),
                "path": json_str(item.get("path")),
                "provides": provides,
            }));
        }
    }

    // Skills — counts + all names + short invocable sample (no descriptions).
    let mut by_source: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();
    let mut user_invocable: u64 = 0;
    let mut sample_names: Vec<String> = Vec::new();
    let mut all_skill_names: Vec<String> = Vec::new();
    let skill_arr = v.get("skills").and_then(|x| x.as_array());
    let skill_total = skill_arr.map(|a| a.len()).unwrap_or(0);
    if let Some(arr) = skill_arr {
        for item in arr {
            let name = json_str(item.get("name"));
            let Some(name) = name else { continue };
            all_skill_names.push(name.clone());
            let src = skill_source_label(
                item.get("source").unwrap_or(&serde_json::Value::Null),
            );
            let count = by_source
                .get(&src)
                .and_then(|x| x.as_u64())
                .unwrap_or(0);
            by_source.insert(src, serde_json::json!(count + 1));
            let inv = item
                .get("userInvocable")
                .or_else(|| item.get("user_invocable"))
                .and_then(|x| x.as_bool())
                .unwrap_or(false);
            if inv {
                user_invocable += 1;
                sample_names.push(name);
            }
        }
    }
    sample_names.sort();
    sample_names.truncate(PROJECT_INSPECT_SKILL_SAMPLE);
    all_skill_names.sort();

    // MCP — name/transport/target/source type only (never env/headers).
    let mut mcp = Vec::new();
    let mcp_arr = v
        .get("mcpServers")
        .or_else(|| v.get("mcp"))
        .and_then(|x| x.as_array());
    if let Some(arr) = mcp_arr {
        for item in arr {
            let name = json_str(item.get("name"));
            let Some(name) = name else { continue };
            let source = item
                .get("source")
                .map(skill_source_label)
                .filter(|s| s != "unknown");
            mcp.push(serde_json::json!({
                "name": name,
                "transport": json_str(item.get("transport")),
                "target": json_str(item.get("target")),
                "source": source,
            }));
        }
    }

    // Agents
    let mut agents = Vec::new();
    if let Some(arr) = v.get("agents").and_then(|x| x.as_array()) {
        for item in arr {
            let name = json_str(item.get("name"));
            let Some(name) = name else { continue };
            let source = skill_source_label(
                item.get("source").unwrap_or(&serde_json::Value::Null),
            );
            agents.push(serde_json::json!({
                "name": name,
                "source": source,
            }));
        }
    }

    // Hooks — event / type / target / source type only (no env / command bodies).
    let mut hooks = Vec::new();
    if let Some(arr) = v.get("hooks").and_then(|x| x.as_array()) {
        for item in arr {
            if let Some(s) = item.as_str().map(str::trim).filter(|s| !s.is_empty()) {
                hooks.push(serde_json::json!({ "event": s }));
                continue;
            }
            let Some(obj) = item.as_object() else { continue };
            let event = json_str(obj.get("event")).or_else(|| json_str(obj.get("name")));
            let hook_type = json_str(obj.get("hookType"))
                .or_else(|| json_str(obj.get("hook_type")))
                .or_else(|| json_str(obj.get("type")));
            let target = json_str(obj.get("target")).or_else(|| json_str(obj.get("path")));
            let source = obj
                .get("source")
                .map(skill_source_label)
                .or_else(|| json_str(obj.get("plugin")));
            let matcher = json_str(obj.get("matcher"));
            if event.is_none() && hook_type.is_none() && target.is_none() {
                continue;
            }
            hooks.push(serde_json::json!({
                "event": event,
                "hookType": hook_type,
                "target": target,
                "source": source,
                "matcher": matcher,
            }));
        }
    }

    // Config layers — paths only.
    let mut config_layers = Vec::new();
    if let Some(layers) = v
        .get("configSources")
        .and_then(|x| x.get("layers"))
        .and_then(|x| x.as_array())
    {
        for item in layers {
            config_layers.push(serde_json::json!({
                "role": json_str(item.get("role")),
                "path": json_str(item.get("path")),
            }));
        }
    }

    // Permissions — counts/flags only (no allowlist bodies that might embed tokens).
    let perm = v.get("permissions");
    let sources_count = perm
        .and_then(|p| p.get("sources"))
        .and_then(|x| x.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    let loaded = perm
        .and_then(|p| p.get("loaded"))
        .and_then(|x| x.as_u64())
        .unwrap_or(0);
    let managed_active = perm
        .and_then(|p| p.get("managedSettingsActive"))
        .and_then(|x| x.as_bool())
        .unwrap_or(false);
    let managed_exists = perm
        .and_then(|p| p.get("managedSettingsExists"))
        .and_then(|x| x.as_bool());
    let managed_path = perm
        .and_then(|p| p.get("managedSettingsPath"))
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| store::redact_text(s).trim().chars().take(400).collect::<String>());

    // Models hints from inspect when present.
    if let Some(arr) = v.get("models").and_then(|x| x.as_array()) {
        for m in arr {
            if let Some(s) = m.as_str() {
                push_model(s.to_string());
            } else if let Some(id) = json_str(m.get("id"))
                .or_else(|| json_str(m.get("name")))
                .or_else(|| json_str(m.get("model")))
            {
                push_model(id);
            }
        }
    }
    if let Some(ch) = json_str(v.get("channel")) {
        if ch != "unknown" {
            push_model(format!("channel:{ch}"));
        }
    }
    if let Some(dm) = json_str(v.get("defaultModel"))
        .or_else(|| json_str(v.get("default_model")))
    {
        push_model(dm);
    }

    let hooks_count = if !hooks.is_empty() {
        hooks.len()
    } else {
        v.get("hooks")
            .and_then(|x| x.as_array())
            .map(|a| a.len())
            .unwrap_or(0)
    };

    let mut out = serde_json::json!({
        "projectPath": project_path_out,
        "projectRoot": project_root,
        "projectTrusted": v.get("projectTrusted").and_then(|x| x.as_bool()),
        "cwd": json_str(v.get("cwd")),
        "grokVersion": json_str(v.get("grokVersion"))
            .or_else(|| json_str(v.get("grok_version"))),
        "channel": json_str(v.get("channel")),
        "hasProjectGrokDir": has_grok,
        "projectGrokPath": if has_grok { grok_path } else { None::<String> },
        "rules": rules,
        "plugins": plugins,
        "skills": {
            "total": skill_total,
            "userInvocable": user_invocable,
            "bySource": by_source,
            "sample": sample_names,
            "names": all_skill_names,
        },
        "mcp": mcp,
        "agents": agents,
        "hooks": hooks,
        "hooksCount": hooks_count,
        "configLayers": config_layers,
        "modelsHints": models_hints,
        "permissions": {
            "loaded": loaded,
            "sourcesCount": sources_count,
            "managedSettingsActive": managed_active,
            "managedSettingsExists": managed_exists,
            "managedSettingsPath": managed_path,
        },
    });
    if let Some(err) = error {
        // Scrub any token-shaped substrings in error text.
        out["error"] = serde_json::Value::String(crate::store::redact_text(&err));
    } else {
        out["error"] = serde_json::Value::Null;
    }
    out
}

/// Full project inspect summary for Settings → Runtime.
/// Runs `grok inspect --json` with optional project cwd; returns a sanitized DTO
/// (plugins / skills counts / MCP / rules paths / model hints). Never includes secrets.
#[tauri::command]
pub async fn project_inspect(project_path: Option<String>) -> Result<serde_json::Value, String> {
    let path = project_path.clone();
    let (parsed, error) = tauri::async_runtime::spawn_blocking(move || {
        run_grok_inspect(path.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?;

    // Model ids from local cache (hints only — not secrets).
    let models_hints: Vec<String> = {
        let catalog = crate::models_catalog::list_available_models();
        let mut hints = Vec::new();
        if !catalog.default_model_id.trim().is_empty() {
            hints.push(catalog.default_model_id.clone());
        }
        for m in catalog.models.iter().take(8) {
            if !hints.iter().any(|h| h == &m.id) {
                hints.push(m.id.clone());
            }
        }
        hints
    };

    Ok(build_project_inspect_summary(
        parsed.as_ref(),
        project_path.as_deref(),
        error,
        models_hints,
    ))
}

/// List skills from `grok inspect --json`, each with App `enabled` (default true).
/// (skills_list already exists; this keeps enable flags on the existing shape.)
fn attach_skill_enabled(skills: Vec<SkillDto>) -> Vec<serde_json::Value> {
    let prefs = crate::extensions::load_prefs();
    skills
        .into_iter()
        .map(|s| {
            let enabled = crate::extensions::is_enabled(&prefs.skills, &s.name);
            serde_json::json!({
                "name": s.name,
                "description": s.description,
                "source": s.source,
                "path": s.path,
                "pluginName": s.plugin_name,
                "userInvocable": s.user_invocable,
                "enabled": enabled,
            })
        })
        .collect()
}

/// Current Extensions enable prefs (`extensions.json`).
#[tauri::command]
pub async fn extensions_get() -> Result<crate::extensions::ExtensionsPrefs, String> {
    Ok(crate::extensions::load_prefs())
}

/// Toggle one MCP server; persists prefs, syncs agent-home/config, soft-respawns.
#[tauri::command]
pub async fn extensions_set_mcp(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    name: String,
    enabled: bool,
) -> Result<crate::extensions::ExtensionsPrefs, String> {
    let prefs = tauri::async_runtime::spawn_blocking(move || {
        crate::extensions::set_mcp_enabled(&name, enabled)
    })
    .await
    .map_err(|e| e.to_string())??;
    mgr.apply_extensions_mcp_change(&app).await;
    Ok(prefs)
}

/// Toggle one skill (App filter for slash/composer); persists immediately.
#[tauri::command]
pub async fn extensions_set_skill(
    name: String,
    enabled: bool,
) -> Result<crate::extensions::ExtensionsPrefs, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::extensions::set_skill_enabled(&name, enabled)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Bulk-enable all listed MCP servers; soft-respawns when a live agent exists.
#[tauri::command]
pub async fn extensions_enable_all_mcp(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    names: Vec<String>,
) -> Result<crate::extensions::ExtensionsPrefs, String> {
    let prefs = tauri::async_runtime::spawn_blocking(move || {
        crate::extensions::enable_all_mcp(&names)
    })
    .await
    .map_err(|e| e.to_string())??;
    mgr.apply_extensions_mcp_change(&app).await;
    Ok(prefs)
}

/// Bulk-enable all listed skills.
#[tauri::command]
pub async fn extensions_enable_all_skills(
    names: Vec<String>,
) -> Result<crate::extensions::ExtensionsPrefs, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::extensions::enable_all_skills(&names)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Plugins via Grok Build CLI (`grok plugin …` + `inspect` + config.toml) ──
//
// Keep field semantics aligned with Grok Build:
// - install inventory: `grok plugin list --json` (status/name/version/source/…)
// - enable/disable: `~/.grok/config.toml` `[plugins].disabled` / CLI enable|disable
// - scope + component counts: `grok inspect --json` → `plugins[]`
// Do not invent a parallel store or rewrite CLI `status` values.

const PLUGIN_CMD_TIMEOUT_SECS: u64 = 30;
/// Install / update pull git or marketplace cache; allow longer than enable/list.
const PLUGIN_MUTATE_TIMEOUT_SECS: u64 = 180;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginProvidesDto {
    #[serde(default)]
    pub skills: u32,
    #[serde(default)]
    pub agents: u32,
    #[serde(default)]
    pub hooks: bool,
    #[serde(default)]
    pub mcp_servers: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDto {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub marketplace: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// Install status from `plugin list --json` (usually `"installed"`). Not enable/disable.
    pub status: String,
    /// Load state from Grok Build config (`[plugins].disabled` / enable CLI).
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_key: Option<String>,
    /// Grok Build scope: user / project / cli / custom path / marketplace name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    /// Component inventory from `grok inspect` (skills / agents / hooks / mcp).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provides: Option<PluginProvidesDto>,
}

/// Run probed CLI with the given args. Returns (stdout, stderr, ok).
fn run_grok_cli_args(args: &[&str], timeout_secs: u64) -> Result<(String, String, bool), String> {
    let settings = store::load_settings();
    let probe = cli_probe::probe_cli(settings.manual_cli_path.as_deref());
    let Some(cli_path) = probe.path.filter(|_| probe.found) else {
        return Err("Grok Build CLI not found".into());
    };

    let args_owned: Vec<String> = args.iter().map(|s| (*s).to_string()).collect();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut cmd = std::process::Command::new(&cli_path);
        cmd.args(&args_owned);
        crate::process_util::apply_no_window_std(&mut cmd);
        if let Some(path_env) = crate::process_util::enriched_path_env() {
            cmd.env("PATH", path_env);
        }
        let result = cmd.output();
        let _ = tx.send(result);
    });

    match rx.recv_timeout(std::time::Duration::from_secs(timeout_secs)) {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Ok((stdout, stderr, output.status.success()))
        }
        Ok(Err(e)) => Err(format!("Failed to run grok: {e}")),
        Err(_) => Err(format!("grok command timed out after {timeout_secs}s")),
    }
}

/// Path to the user-level Grok config that tracks plugin enable/disable.
/// Same file Grok Build reads for `[plugins].enabled` / `[plugins].disabled`.
fn user_grok_config_toml() -> std::path::PathBuf {
    crate::process_util::user_home().join(".grok").join("config.toml")
}

/// Parse a string-array key under `[plugins]` (single- or multi-line).
pub fn parse_plugins_toml_string_array(toml_text: &str, key: &str) -> std::collections::HashSet<String> {
    let mut out = std::collections::HashSet::new();
    let mut in_plugins = false;
    let mut collecting = false;
    let mut buf = String::new();
    let key_prefix = key;

    for line in toml_text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            if collecting {
                break;
            }
            in_plugins = trimmed == "[plugins]";
            continue;
        }
        if !in_plugins {
            continue;
        }
        if collecting {
            buf.push(' ');
            buf.push_str(trimmed);
            if trimmed.contains(']') {
                collecting = false;
                for name in extract_toml_string_array(&buf) {
                    out.insert(name);
                }
                buf.clear();
            }
            continue;
        }
        if let Some(rest) = trimmed
            .strip_prefix(key_prefix)
            .map(str::trim)
            .and_then(|s| s.strip_prefix('='))
            .map(str::trim)
        {
            if rest.contains('[') && rest.contains(']') {
                for name in extract_toml_string_array(rest) {
                    out.insert(name);
                }
            } else if rest.contains('[') {
                collecting = true;
                buf = rest.to_string();
            }
        }
    }
    out
}

/// Grok Build config: plugin IDs or plain names listed under `[plugins].disabled`.
pub fn parse_plugins_disabled_names(toml_text: &str) -> std::collections::HashSet<String> {
    parse_plugins_toml_string_array(toml_text, "disabled")
}

fn extract_toml_string_array(s: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '"' || c == '\'' {
            let quote = c;
            let mut name = String::new();
            while let Some(ch) = chars.next() {
                if ch == quote {
                    break;
                }
                if ch == '\\' {
                    if let Some(escaped) = chars.next() {
                        name.push(escaped);
                    }
                } else {
                    name.push(ch);
                }
            }
            let n = name.trim();
            if !n.is_empty() {
                names.push(n.to_string());
            }
        }
    }
    names
}

fn load_disabled_plugin_entries() -> std::collections::HashSet<String> {
    let path = user_grok_config_toml();
    match std::fs::read_to_string(&path) {
        Ok(text) => parse_plugins_disabled_names(&text),
        Err(_) => std::collections::HashSet::new(),
    }
}

/// Match Grok Build disabled entries: plain name or full id `scope/hash/name`.
pub fn plugin_matches_disabled(
    name: &str,
    repo_key: Option<&str>,
    disabled: &std::collections::HashSet<String>,
) -> bool {
    if disabled.is_empty() {
        return false;
    }
    if disabled.contains(name) {
        return true;
    }
    for entry in disabled {
        let e = entry.trim();
        if e.is_empty() {
            continue;
        }
        // Full plugin id: <scope>/<hash>/<name>
        if let Some((head, tail)) = e.rsplit_once('/') {
            if tail == name {
                // Optional: also match hash against repo_key suffix
                if let Some(rk) = repo_key {
                    if head.ends_with(rk) || rk.ends_with(head.rsplit_once('/').map(|(_, h)| h).unwrap_or(head)) {
                        return true;
                    }
                }
                return true;
            }
        }
        if let Some(rk) = repo_key {
            if e == rk || e.ends_with(&format!("/{rk}")) {
                return true;
            }
        }
    }
    false
}

#[derive(Debug, Clone, Default)]
struct InspectPluginExtra {
    scope: Option<String>,
    provides: Option<PluginProvidesDto>,
}

fn parse_inspect_plugins_map(
    inspect_json: &serde_json::Value,
) -> std::collections::HashMap<String, InspectPluginExtra> {
    let mut map = std::collections::HashMap::new();
    let Some(arr) = inspect_json.get("plugins").and_then(|x| x.as_array()) else {
        return map;
    };
    for item in arr {
        let name = item
            .get("name")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if name.is_empty() {
            continue;
        }
        let path = item
            .get("path")
            .and_then(|x| x.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let scope = item
            .get("scope")
            .and_then(|x| x.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let provides = item.get("provides").map(|p| PluginProvidesDto {
            skills: p
                .get("skills")
                .and_then(|x| x.as_u64())
                .unwrap_or(0) as u32,
            agents: p
                .get("agents")
                .and_then(|x| x.as_u64())
                .unwrap_or(0) as u32,
            hooks: p.get("hooks").and_then(|x| x.as_bool()).unwrap_or(false),
            mcp_servers: p
                .get("mcpServers")
                .or_else(|| p.get("mcp_servers"))
                .and_then(|x| x.as_u64())
                .unwrap_or(0) as u32,
        });
        let extra = InspectPluginExtra { scope, provides };
        // Key by name and path so duplicate names (e.g. two cloudflare installs) can match path.
        map.insert(name.clone(), extra.clone());
        if let Some(p) = path {
            map.insert(format!("path:{p}"), extra);
        }
    }
    map
}
