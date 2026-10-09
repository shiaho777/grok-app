#[cfg(test)]
mod plugin_config_tests {
    use super::*;

    #[test]
    fn parse_disabled_single_line() {
        let toml = r#"
[plugins]
enabled = ["a", "b"]
disabled = ["chrome-devtools-mcp", "x"]
"#;
        let set = parse_plugins_disabled_names(toml);
        assert!(set.contains("chrome-devtools-mcp"));
        assert!(set.contains("x"));
        assert_eq!(set.len(), 2);
    }

    #[test]
    fn parse_disabled_multiline() {
        let toml = r#"
[plugins]
enabled = [
    "cloudflare",
]
disabled = [
    "chrome-devtools-mcp",
    "playwright",
]

[marketplace]
foo = 1
"#;
        let set = parse_plugins_disabled_names(toml);
        assert!(set.contains("chrome-devtools-mcp"));
        assert!(set.contains("playwright"));
        assert_eq!(set.len(), 2);
    }

    #[test]
    fn parse_disabled_empty() {
        let set = parse_plugins_disabled_names("[plugins]\ndisabled = []\n");
        assert!(set.is_empty());
    }

    #[test]
    fn parse_disabled_ignores_other_sections() {
        let toml = r#"
[other]
disabled = ["nope"]

[plugins]
disabled = ["yes"]
"#;
        let set = parse_plugins_disabled_names(toml);
        assert!(set.contains("yes"));
        assert!(!set.contains("nope"));
    }

    #[test]
    fn matches_full_plugin_id_like_grok_build() {
        let mut disabled = std::collections::HashSet::new();
        disabled.insert("user/a0b23c68/chrome-devtools-mcp".into());
        assert!(plugin_matches_disabled(
            "chrome-devtools-mcp",
            Some("chrome-devtools-mcp-a0b23c68"),
            &disabled
        ));
        assert!(!plugin_matches_disabled("other", None, &disabled));
    }

    #[test]
    fn list_json_keeps_cli_status_and_config_enabled() {
        let raw = r#"[
          {"status":"installed","name":"demo","repo_key":"demo-abc","version":"1.0.0","path":"/tmp/demo","source":"https://example.com/demo","marketplace":null}
        ]"#;
        let mut disabled = std::collections::HashSet::new();
        disabled.insert("demo".into());
        let empty = std::collections::HashMap::new();
        let plugins = parse_plugin_list_json(raw, &disabled, &empty).unwrap();
        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0].status, "installed"); // CLI install status preserved
        assert!(!plugins[0].enabled); // config disabled
    }

    #[test]
    fn merges_inspect_scope_and_provides() {
        let raw = r#"[
          {"status":"installed","name":"superpowers","repo_key":"superpowers-599","version":"6.1.1","path":"/p/superpowers","source":"https://github.com/obra/superpowers","marketplace":null}
        ]"#;
        let disabled = std::collections::HashSet::new();
        let mut extra = std::collections::HashMap::new();
        extra.insert(
            "path:/p/superpowers".into(),
            InspectPluginExtra {
                scope: Some("user".into()),
                provides: Some(PluginProvidesDto {
                    skills: 14,
                    agents: 0,
                    hooks: true,
                    mcp_servers: 0,
                }),
            },
        );
        let plugins = parse_plugin_list_json(raw, &disabled, &extra).unwrap();
        assert_eq!(plugins[0].scope.as_deref(), Some("user"));
        assert_eq!(plugins[0].provides.as_ref().unwrap().skills, 14);
        assert!(plugins[0].provides.as_ref().unwrap().hooks);
        assert!(plugins[0].enabled);
    }

    #[test]
    fn normalize_install_source_trims_and_rejects_empty() {
        assert_eq!(
            normalize_plugin_install_source("  owner/repo  ").unwrap(),
            "owner/repo"
        );
        assert_eq!(
            normalize_plugin_install_source("https://github.com/a/b.git").unwrap(),
            "https://github.com/a/b.git"
        );
        assert_eq!(
            normalize_plugin_install_source("/tmp/my-plugin").unwrap(),
            "/tmp/my-plugin"
        );
        assert!(normalize_plugin_install_source("").is_err());
        assert!(normalize_plugin_install_source("   ").is_err());
        assert_eq!(
            normalize_plugin_install_source("\"/tmp/my-plugin\"").unwrap(),
            "/tmp/my-plugin"
        );
        #[cfg(unix)]
        assert_eq!(
            normalize_plugin_install_source("file:///tmp/my-plugin").unwrap(),
            "/tmp/my-plugin"
        );
    }

    #[test]
    fn plugin_name_from_install_source_variants() {
        assert_eq!(
            plugin_name_from_install_source("vercel@xAI Official").as_deref(),
            Some("vercel")
        );
        assert_eq!(
            plugin_name_from_install_source("vercel").as_deref(),
            Some("vercel")
        );
        assert_eq!(
            plugin_name_from_install_source("owner/repo").as_deref(),
            Some("repo")
        );
        assert_eq!(
            plugin_name_from_install_source("owner/repo@v1").as_deref(),
            Some("repo")
        );
        // Monorepo subdir pin: prefer #fragment as enable name (ChatCut #codex).
        assert_eq!(
            plugin_name_from_install_source(
                "https://github.com/ChatCut-Inc/agent-plugin#codex"
            )
            .as_deref(),
            Some("codex")
        );
        assert_eq!(
            plugin_name_from_install_source("https://github.com/a/b.git").as_deref(),
            Some("b")
        );
        assert_eq!(
            plugin_name_from_install_source("git@github.com:a/b.git").as_deref(),
            Some("b")
        );
        assert_eq!(
            plugin_name_from_install_source("/tmp/my-plugin").as_deref(),
            Some("my-plugin")
        );
    }

    #[test]
    fn normalize_update_name_empty_means_all() {
        assert_eq!(
            normalize_plugin_update_name(Some("  chrome-devtools-mcp ")).as_deref(),
            Some("chrome-devtools-mcp")
        );
        assert_eq!(normalize_plugin_update_name(Some("")), None);
        assert_eq!(normalize_plugin_update_name(Some("   ")), None);
        assert_eq!(normalize_plugin_update_name(None), None);
    }

    #[test]
    fn parse_validate_messages_stderr_first_dedupe() {
        let msgs = parse_plugin_validate_messages(
            "Plugin manifest is valid.\n  name: demo\n",
            "  name: demo\n",
        );
        assert_eq!(
            msgs,
            vec![
                "name: demo".to_string(),
                "Plugin manifest is valid.".to_string()
            ]
        );
    }

    #[test]
    fn looks_like_unsupported_validate_clap() {
        assert!(looks_like_unsupported_plugin_validate(
            "error: unrecognized subcommand 'validate'\n\nUsage: grok plugin …",
            ""
        ));
        assert!(looks_like_unsupported_plugin_validate(
            "error: unexpected argument 'validate' found",
            ""
        ));
        assert!(!looks_like_unsupported_plugin_validate(
            "Error: Not a directory: /nope",
            ""
        ));
        assert!(!looks_like_unsupported_plugin_validate(
            "Error: Failed to load manifest: missing field `name`",
            ""
        ));
    }

    #[test]
    fn looks_like_validate_path_variants() {
        assert!(looks_like_plugin_validate_path("/tmp/my-plugin"));
        assert!(looks_like_plugin_validate_path("~/code/plugin"));
        assert!(looks_like_plugin_validate_path("./plugin"));
        assert!(looks_like_plugin_validate_path("C:\\Users\\a\\plugin"));
        assert!(looks_like_plugin_validate_path("owner/repo")); // has slash → path-ish for CLI
        assert!(!looks_like_plugin_validate_path("chrome-devtools-mcp"));
        assert!(!looks_like_plugin_validate_path("https://github.com/a/b.git"));
        assert!(!looks_like_plugin_validate_path("git@github.com:a/b.git"));
    }

    #[test]
    fn normalize_validate_target_empty() {
        assert_eq!(normalize_plugin_validate_target(None), None);
        assert_eq!(normalize_plugin_validate_target(Some("")), None);
        assert_eq!(normalize_plugin_validate_target(Some("  ")), None);
        assert_eq!(
            normalize_plugin_validate_target(Some("  /tmp/p  ")).as_deref(),
            Some("/tmp/p")
        );
    }
}

