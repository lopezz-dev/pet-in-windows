//! Reads Claude Code transcripts (`~/.claude/projects/<project>/<session>.jsonl`)
//! and turns each live session (and each running subagent) into an `Agent`
//! with a simple state the pets can act out.
//!
//! This is purely passive: we only read files Claude Code already writes, so no
//! configuration is needed. Hooks can make "needs permission" exact later on.

use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Main sessions touched within this window get a pet.
const MAIN_WINDOW: Duration = Duration::from_secs(3 * 3600);
/// Subagents only appear while they're actively writing.
const SUB_WINDOW: Duration = Duration::from_secs(90);
/// A tool call with no result after this long is probably a permission prompt.
const PERMISSION_GUESS: Duration = Duration::from_secs(25);
/// Working/thinking with no writes for this long: the session likely died.
const STALE: Duration = Duration::from_secs(10 * 60);
/// Finished sessions ("waiting" for you) stay visible this long.
const WAITING_WINDOW: Duration = Duration::from_secs(45 * 60);
/// Max main pets on screen.
const MAX_PETS: usize = 8;
/// Only the end of each transcript matters.
const TAIL_BYTES: u64 = 512 * 1024;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: String,
    pub parent_id: Option<String>,
    pub kind: &'static str, // "main" | "sub"
    pub project: String,
    pub cwd: String,
    pub branch: String,
    pub state: &'static str, // working | thinking | waiting | attention | idle
    pub activity: String,
    pub last_text: String,
    pub last_prompt: String,
    pub agent_type: String,
    pub description: String,
    pub idle_ms: u64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
enum Last {
    #[default]
    Nothing,
    UserPrompt,
    ToolResult,
    AssistantTool,
    AssistantThinking,
    AssistantDone,
    Stopped,
    Interrupted,
}

#[derive(Clone, Debug, Default)]
struct Facts {
    cwd: String,
    branch: String,
    permission_mode: String,
    last_prompt: String,
    last_text: String,
    activity: String,
    pending_tool: String,
    last: Last,
}

struct Cached {
    mtime: SystemTime,
    len: u64,
    facts: Facts,
}

pub struct Scanner {
    root: PathBuf,
    cache: HashMap<PathBuf, Cached>,
}

impl Scanner {
    pub fn new() -> Self {
        Self { root: claude_dir().join("projects"), cache: HashMap::new() }
    }

    pub fn scan(&mut self) -> Vec<Agent> {
        let now = SystemTime::now();
        let mut agents = Vec::new();
        let mut seen = Vec::new();

        let Ok(projects) = fs::read_dir(&self.root) else { return agents };
        for project in projects.flatten() {
            let project_dir = project.path();
            let Ok(files) = fs::read_dir(&project_dir) else { continue };
            for file in files.flatten() {
                let path = file.path();
                if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                    continue;
                }
                let Some((mtime, len)) = stat(&path) else { continue };
                let age = now.duration_since(mtime).unwrap_or_default();
                if age > MAIN_WINDOW {
                    continue;
                }
                let session_id = stem(&path);
                let facts = self.facts(&path, mtime, len);
                seen.push(path.clone());
                if facts.last == Last::Nothing {
                    continue; // e.g. a file that only holds summaries
                }
                let main = build_agent(&session_id, None, "main", &facts, age, &project_dir);

                // Running subagents live in <project>/<session>/subagents/agent-*.jsonl
                let sub_dir = project_dir.join(&session_id).join("subagents");
                if let Ok(subs) = fs::read_dir(&sub_dir) {
                    for sub in subs.flatten() {
                        let sp = sub.path();
                        if sp.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                            continue;
                        }
                        let Some((smtime, slen)) = stat(&sp) else { continue };
                        let sage = now.duration_since(smtime).unwrap_or_default();
                        if sage > SUB_WINDOW {
                            continue;
                        }
                        let sfacts = self.facts(&sp, smtime, slen);
                        seen.push(sp.clone());
                        let mut a = build_agent(&stem(&sp), Some(&session_id), "sub", &sfacts, sage, &project_dir);
                        if matches!(a.state, "waiting" | "idle") {
                            continue; // finished subagent: let it vanish
                        }
                        if a.project.is_empty() {
                            a.project = main.project.clone();
                        }
                        read_sub_meta(&sp, &mut a);
                        agents.push(a);
                    }
                }
                agents.push(main);
            }
        }

        self.cache.retain(|p, _| seen.contains(p));

        // Keep the screen readable: finished sessions fade out after a while,
        // and at most MAX_PETS main pets are shown (most urgent / recent first).
        agents.retain(|a| {
            a.kind == "sub"
                || !matches!(a.state, "waiting" | "idle")
                || a.idle_ms < WAITING_WINDOW.as_millis() as u64
        });
        let mut mains: Vec<&Agent> = agents.iter().filter(|a| a.kind == "main").collect();
        mains.sort_by_key(|a| (priority(a.state), a.idle_ms));
        let keep: Vec<String> = mains.iter().take(MAX_PETS).map(|a| a.id.clone()).collect();
        agents.retain(|a| match &a.parent_id {
            None => keep.contains(&a.id),
            Some(p) => keep.contains(p),
        });
        // Stable order so pets keep their spot on the taskbar.
        agents.sort_by(|a, b| a.id.cmp(&b.id));
        agents
    }

    fn facts(&mut self, path: &Path, mtime: SystemTime, len: u64) -> Facts {
        if let Some(c) = self.cache.get(path) {
            if c.mtime == mtime && c.len == len {
                return c.facts.clone();
            }
        }
        let facts = parse_tail(path, len).unwrap_or_default();
        self.cache.insert(path.to_path_buf(), Cached { mtime, len, facts: facts.clone() });
        facts
    }
}

fn priority(state: &str) -> u8 {
    match state {
        "attention" => 0,
        "working" | "thinking" => 1,
        "waiting" => 2,
        _ => 3,
    }
}

fn build_agent(
    id: &str,
    parent: Option<&str>,
    kind: &'static str,
    f: &Facts,
    age: Duration,
    project_dir: &Path,
) -> Agent {
    let state = match f.last {
        Last::AssistantTool => {
            let long_running = matches!(f.pending_tool.as_str(), "Task" | "Agent");
            let bypass = f.permission_mode == "bypassPermissions";
            if age > Duration::from_secs(3600) {
                "idle"
            } else if !long_running && !bypass && kind == "main" && age > PERMISSION_GUESS {
                "attention"
            } else {
                "working"
            }
        }
        Last::UserPrompt | Last::ToolResult | Last::AssistantThinking => "thinking",
        Last::AssistantDone | Last::Stopped | Last::Interrupted => "waiting",
        Last::Nothing => "idle",
    };
    let state = if matches!(state, "working" | "thinking") && age > STALE { "idle" } else { state };

    let project = project_name(&f.cwd).unwrap_or_else(|| stem(project_dir));

    Agent {
        id: id.to_string(),
        parent_id: parent.map(str::to_string),
        kind,
        project,
        cwd: f.cwd.clone(),
        branch: f.branch.clone(),
        state,
        activity: f.activity.clone(),
        last_text: f.last_text.clone(),
        last_prompt: f.last_prompt.clone(),
        agent_type: String::new(),
        description: String::new(),
        idle_ms: age.as_millis() as u64,
    }
}

/// Reads the end of a transcript and replays it to find out where it stands.
fn parse_tail(path: &Path, len: u64) -> Option<Facts> {
    let mut file = File::open(path).ok()?;
    let start = len.saturating_sub(TAIL_BYTES);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf);
    let mut lines = text.lines();
    if start > 0 {
        lines.next(); // probably cut in half
    }

    let mut f = Facts::default();
    for line in lines {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        apply(&mut f, &v);
    }
    Some(f)
}

fn apply(f: &mut Facts, v: &Value) {
    let s = |k: &str| v.get(k).and_then(Value::as_str);
    if let Some(cwd) = s("cwd") {
        f.cwd = cwd.to_string();
    }
    if let Some(b) = s("gitBranch") {
        f.branch = b.to_string();
    }
    if let Some(p) = s("permissionMode") {
        f.permission_mode = p.to_string();
    }

    match s("type").unwrap_or("") {
        "last-prompt" => {
            if let Some(p) = s("lastPrompt") {
                f.last_prompt = clip(p, 160);
            }
        }
        "system" if s("subtype") == Some("stop_hook_summary") => f.last = Last::Stopped,
        "user" => {
            if v.get("isMeta").and_then(Value::as_bool) == Some(true) {
                return;
            }
            let content = v.pointer("/message/content");
            match content {
                Some(Value::String(t)) => user_text(f, t),
                Some(Value::Array(blocks)) => {
                    if blocks.iter().any(|b| b.get("type").and_then(Value::as_str) == Some("tool_result")) {
                        f.last = Last::ToolResult;
                    } else if let Some(t) = blocks
                        .iter()
                        .filter_map(|b| b.get("text").and_then(Value::as_str))
                        .last()
                    {
                        user_text(f, t);
                    }
                }
                _ => {}
            }
        }
        "assistant" => {
            let stop = v.pointer("/message/stop_reason").and_then(Value::as_str);
            let Some(Value::Array(blocks)) = v.pointer("/message/content") else { return };
            let Some(last) = blocks.last() else { return };
            match last.get("type").and_then(Value::as_str) {
                Some("tool_use") => {
                    let name = last.get("name").and_then(Value::as_str).unwrap_or("tool");
                    let input = last.get("input").cloned().unwrap_or(Value::Null);
                    f.pending_tool = name.to_string();
                    f.activity = describe(name, &input);
                    f.last = Last::AssistantTool;
                }
                Some("text") => {
                    if let Some(t) = last.get("text").and_then(Value::as_str) {
                        f.last_text = clip(t, 200);
                    }
                    f.last = if stop == Some("end_turn") { Last::AssistantDone } else { Last::AssistantThinking };
                }
                _ => f.last = Last::AssistantThinking,
            }
        }
        _ => {}
    }
}

fn user_text(f: &mut Facts, t: &str) {
    let t = t.trim();
    if t.starts_with("[Request interrupted") {
        f.last = Last::Interrupted;
    } else if !t.is_empty() && !t.starts_with('<') {
        // Lines starting with '<' are slash-command echoes / local output.
        f.last_prompt = clip(t, 160);
        f.last = Last::UserPrompt;
    }
}

/// Short human description of a tool call, e.g. "Edit main.rs".
fn describe(name: &str, input: &Value) -> String {
    let s = |k: &str| input.get(k).and_then(Value::as_str).unwrap_or("");
    let base = |p: &str| {
        Path::new(p).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default()
    };
    let detail = match name {
        "Bash" | "PowerShell" => {
            if s("description").is_empty() { s("command").to_string() } else { s("description").to_string() }
        }
        "Read" | "Edit" | "Write" | "MultiEdit" => base(s("file_path")),
        "NotebookEdit" => base(s("notebook_path")),
        "Grep" | "Glob" => s("pattern").to_string(),
        "WebFetch" => s("url").to_string(),
        "WebSearch" => s("query").to_string(),
        "Task" | "Agent" => s("description").to_string(),
        _ => String::new(),
    };
    let short = name.rsplit("__").next().unwrap_or(name); // mcp__server__tool -> tool
    clip(&format!("{short} {detail}"), 70)
}

/// Repo folder name; for worktrees (`<repo>/.claude/worktrees/<name>`) the repo
/// name is far more useful than the random worktree name (the branch shows anyway).
fn project_name(cwd: &str) -> Option<String> {
    let parts: Vec<&str> = cwd.split(['\\', '/']).filter(|p| !p.is_empty()).collect();
    if let Some(i) = parts.windows(2).position(|w| w[0] == ".claude" && w[1] == "worktrees") {
        if i > 0 {
            return Some(parts[i - 1].to_string());
        }
    }
    parts.last().map(|s| s.to_string())
}

fn read_sub_meta(jsonl: &Path, a: &mut Agent) {
    let meta = jsonl.with_extension("meta.json");
    let Ok(text) = fs::read_to_string(meta) else { return };
    let Ok(v) = serde_json::from_str::<Value>(&text) else { return };
    if let Some(t) = v.get("agentType").and_then(Value::as_str) {
        a.agent_type = t.to_string();
    }
    if let Some(d) = v.get("description").and_then(Value::as_str) {
        a.description = clip(d, 100);
    }
}

fn claude_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("CLAUDE_CONFIG_DIR") {
        return PathBuf::from(dir);
    }
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_default();
    PathBuf::from(home).join(".claude")
}

fn stat(p: &Path) -> Option<(SystemTime, u64)> {
    let m = fs::metadata(p).ok()?;
    Some((m.modified().ok()?, m.len()))
}

fn stem(p: &Path) -> String {
    p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
}

fn clip(s: &str, max: usize) -> String {
    let one_line = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.chars().count() <= max {
        one_line
    } else {
        let mut out: String = one_line.chars().take(max - 1).collect();
        out.push('…');
        out
    }
}
