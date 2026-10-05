//! Signing in with GitHub, for a linked project's other side. The app is a GitHub App's client:
//! it shows a code, the user confirms it in the browser (the device flow — nothing secret is
//! in the program), and GitHub hands out a token for eight hours and one to renew it with for
//! six months. The renewing one is kept in the system's keyring, the other only in memory.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};

use crate::Event;

pub const CLIENT_ID: &str = "Iv23liovowgVJASctV6s"; // (the GitHub App "mdview" of @henriSchulz; not a secret)
const SERVICE: &str = "dev.henri.MdView";

type Res<T> = Result<T, String>;

fn say<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Where GitHub is (the tests have one of their own).
#[derive(Clone)]
pub struct Hosts {
    pub web: String,
    pub api: String,
}

impl Default for Hosts {
    fn default() -> Self {
        let from = |name: &str, or: &str| std::env::var(name).ok().filter(|v| !v.is_empty()).unwrap_or_else(|| or.to_string());
        Hosts { web: from("MDVIEW_GITHUB_WEB", "https://github.com"), api: from("MDVIEW_GITHUB_API", "https://api.github.com") }
    }
}

/// The user as signed in: the token that reaches GitHub (until `expires`, seconds since 1970),
/// and who it is.
#[derive(Clone, Debug, PartialEq)]
pub struct Session {
    pub access: String,
    pub expires: u64,
    pub login: String,
    pub name: String,
    pub id: u64,
}

impl Session {
    /// Who the commits made here are by: the name, and the address GitHub knows the account by
    /// without telling a real one.
    pub fn author(&self) -> (String, String) {
        (if self.name.is_empty() { self.login.clone() } else { self.name.clone() }, format!("{}+{}@users.noreply.github.com", self.id, self.login))
    }
}

/// What the shell is told of the signing in.
pub enum News {
    /// the code to confirm, and where
    Code { code: String, uri: String },
    /// signed in; with a word where it could not be kept for the next start (no keyring)
    In(Session, Option<String>),
    /// not signed in (any more), and why — "" where the user said so
    Out(String),
    /// signed in, but GitHub could not be reached to renew the token: later again
    Later,
    /// the repositories the app was given on the user's account (or why they could not be read)
    Repos(Result<Vec<Value>, String>),
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(Duration::from_secs(15)).build()
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// A form sent to GitHub's sign-in side; what it says, as JSON (also where it says no).
fn form(hosts: &Hosts, path: &str, fields: &[(&str, &str)]) -> Res<Value> {
    let said = match agent().post(&format!("{}{path}", hosts.web)).set("Accept", "application/json").send_form(fields) {
        Ok(res) => res.into_string().map_err(say)?,
        Err(ureq::Error::Status(_, res)) => res.into_string().map_err(say)?,
        Err(e) => return Err(say(e)),
    };
    serde_json::from_str(&said).map_err(say)
}

struct Tokens {
    access: String,
    expires: u64,
    refresh: String,
}

fn tokens(said: &Value) -> Option<Tokens> {
    Some(Tokens {
        access: said["access_token"].as_str()?.to_string(),
        expires: now() + said["expires_in"].as_u64().unwrap_or(8 * 3600),
        refresh: said["refresh_token"].as_str().unwrap_or("").to_string(),
    })
}

fn why(said: &Value) -> String {
    said["error_description"].as_str().or(said["error"].as_str()).unwrap_or("GitHub said no").to_string()
}

/// Who a token is: { login, name, id }.
fn user(hosts: &Hosts, access: &str) -> Res<Value> {
    let res = agent().get(&format!("{}/user", hosts.api)).set("Accept", "application/vnd.github+json").set("Authorization", &format!("Bearer {access}")).set("User-Agent", "mdview").call().map_err(say)?;
    serde_json::from_str(&res.into_string().map_err(say)?).map_err(say)
}

fn session(hosts: &Hosts, t: &Tokens) -> Res<Session> {
    let who = user(hosts, &t.access)?;
    let login = who["login"].as_str().ok_or("GitHub did not say who this is")?.to_string();
    Ok(Session { access: t.access.clone(), expires: t.expires, login, name: who["name"].as_str().unwrap_or("").to_string(), id: who["id"].as_u64().unwrap_or(0) })
}

// -- the keyring ----------------------------------------------------------------

/// The keyring's entry: one for every place the app keeps its state in (a test's instance has
/// a state of its own, and must never renew — and so make void — the real one's token).
fn entry(place: &str) -> Res<keyring::Entry> {
    // (the rig's session has no keyring of its own, and asking for one there starts one that waits to be unlocked)
    if std::env::var_os("MDVIEW_NO_KEYRING").is_some() {
        return Err("no keyring".into());
    }
    keyring::Entry::new(SERVICE, &format!("github {place}")).map_err(say)
}

fn remember(place: &str, refresh: &str) -> Res<()> {
    entry(place)?.set_password(refresh).map_err(say)
}

fn recall(place: &str) -> Option<String> {
    entry(place).ok()?.get_password().ok().filter(|t| !t.is_empty())
}

fn forget(place: &str) {
    if let Ok(e) = entry(place) {
        let _ = e.delete_credential();
    }
}

// -- the flows --------------------------------------------------------------------

/// The device flow, start to end: the code is told at once, then GitHub is asked — as often as
/// it allows — whether the user confirmed it. Ok(None): given up (stop was set).
fn device_flow(hosts: &Hosts, stop: &AtomicBool, tell: &dyn Fn(News), pause: &dyn Fn(Duration)) -> Res<Option<Tokens>> {
    let begun = form(hosts, "/login/device/code", &[("client_id", CLIENT_ID)])?;
    let (Some(device), Some(code)) = (begun["device_code"].as_str(), begun["user_code"].as_str()) else { return Err(why(&begun)) };
    let uri = begun["verification_uri"].as_str().unwrap_or("https://github.com/login/device").to_string();
    let mut every = begun["interval"].as_u64().unwrap_or(5);
    let until = now() + begun["expires_in"].as_u64().unwrap_or(900);
    tell(News::Code { code: code.to_string(), uri });
    while now() < until {
        pause(Duration::from_secs(every));
        if stop.load(Ordering::Relaxed) {
            return Ok(None);
        }
        let said = form(hosts, "/login/oauth/access_token", &[("client_id", CLIENT_ID), ("device_code", device), ("grant_type", "urn:ietf:params:oauth:grant-type:device_code")]);
        let Ok(said) = said else { continue }; // (the net, for a moment: asked again)
        if let Some(t) = tokens(&said) {
            return Ok(Some(t));
        }
        match said["error"].as_str() {
            Some("authorization_pending") => {}
            Some("slow_down") => every = said["interval"].as_u64().unwrap_or(every + 5),
            _ => return Err(why(&said)),
        }
    }
    Err("the code was not confirmed in time".into())
}

/// Sign in: on a thread of its own, telling the shell as it goes. Setting `stop` gives it up.
pub fn sign_in(tx: Sender<Event>, place: String, stop: Arc<AtomicBool>) {
    std::thread::spawn(move || {
        let hosts = Hosts::default();
        let tell = |news: News| {
            let _ = tx.send(Event::GitHub(news));
        };
        let news = match device_flow(&hosts, &stop, &tell, &std::thread::sleep) {
            Ok(Some(t)) => match session(&hosts, &t) {
                // (no keyring to keep it in: signed in all the same, until the app ends)
                Ok(s) => News::In(s, remember(&place, &t.refresh).err().map(|e| format!("not kept for the next start: {e}"))),
                Err(e) => News::Out(e),
            },
            Ok(None) => News::Out(String::new()),
            Err(e) => News::Out(e),
        };
        tell(news);
    });
}

/// The sign-in kept in the keyring is taken up again: its token renewed (the one to renew with
/// changes with every use, and is kept anew). Nothing kept: nothing is told.
pub fn resume(tx: Sender<Event>, place: String) {
    std::thread::spawn(move || {
        let Some(refresh) = recall(&place) else { return };
        let hosts = Hosts::default();
        let news = match renew(&hosts, &refresh) {
            Ok(Ok(t)) => match remember(&place, &t.refresh).and_then(|()| session(&hosts, &t)) {
                Ok(s) => News::In(s, None),
                Err(_) => News::Later,
            },
            Ok(Err(no)) => {
                forget(&place); // (GitHub does not take it any more: signed out)
                News::Out(no)
            }
            Err(_) => News::Later,
        };
        let _ = tx.send(Event::GitHub(news));
    });
}

/// Ok(Ok): new tokens. Ok(Err): GitHub refused the one kept (said why). Err: not reached.
fn renew(hosts: &Hosts, refresh: &str) -> Res<Result<Tokens, String>> {
    let said = form(hosts, "/login/oauth/access_token", &[("client_id", CLIENT_ID), ("grant_type", "refresh_token"), ("refresh_token", refresh)])?;
    Ok(tokens(&said).filter(|t| !t.refresh.is_empty()).ok_or_else(|| why(&said)))
}

fn get(hosts: &Hosts, access: &str, path: &str) -> Res<Value> {
    let res = agent().get(&format!("{}{path}", hosts.api)).set("Accept", "application/vnd.github+json").set("Authorization", &format!("Bearer {access}")).set("User-Agent", "mdview").call().map_err(say)?;
    serde_json::from_str(&res.into_string().map_err(say)?).map_err(say)
}

const PAGE: usize = 100; // repositories asked for at a time
const PAGES: usize = 5; // … and how often, at most, for one installation

/// The repositories the signed-in user can reach through the app: those of every account the
/// app is installed on, as far as the user chose them there.
/// [{ name: "owner/repo", url, branch, private }], by name.
fn repositories(hosts: &Hosts, access: &str) -> Res<Vec<Value>> {
    let installed = get(hosts, access, &format!("/user/installations?per_page={PAGE}"))?;
    let mut all = vec![];
    for id in installed["installations"].as_array().into_iter().flatten().filter_map(|i| i["id"].as_u64()) {
        for page in 1..=PAGES {
            let got = get(hosts, access, &format!("/user/installations/{id}/repositories?per_page={PAGE}&page={page}"))?;
            let repos = got["repositories"].as_array().cloned().unwrap_or_default();
            let n = repos.len();
            for r in repos {
                if let (Some(name), Some(url)) = (r["full_name"].as_str(), r["clone_url"].as_str()) {
                    all.push(json!({ "name": name, "url": url, "branch": r["default_branch"].as_str().unwrap_or("main"), "private": r["private"].as_bool().unwrap_or(false) }));
                }
            }
            if n < PAGE {
                break;
            }
        }
    }
    all.sort_by(|a, b| a["name"].as_str().map(str::to_lowercase).cmp(&b["name"].as_str().map(str::to_lowercase)));
    Ok(all)
}

/// The repositories are read, on a thread of its own, and told.
pub fn repos(tx: Sender<Event>, session: Session) {
    std::thread::spawn(move || {
        let _ = tx.send(Event::GitHub(News::Repos(repositories(&Hosts::default(), &session.access))));
    });
}

/// Where the user says which repositories the app is given.
pub const GIVE: &str = "https://github.com/settings/installations";

/// Signed out: the keyring forgets.
pub fn sign_out(place: &str) {
    forget(place);
}

/// For the page: { login, name } of who is signed in.
pub fn shown(session: &Session) -> Value {
    json!({ "login": session.login, "name": session.name })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::Mutex;

    /// A GitHub of the test's own: answers every request with what `answer` says for its path
    /// and body. -> where it is
    fn fake(answer: impl Fn(&str, &str) -> String + Send + 'static) -> Hosts {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let at = format!("http://{}", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let mut reader = BufReader::new(stream);
                let mut first = String::new();
                if reader.read_line(&mut first).is_err() {
                    continue;
                }
                let path = first.split_whitespace().nth(1).unwrap_or("").to_string();
                let mut length = 0;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                        break;
                    }
                    if let Some(n) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                        length = n.trim().parse().unwrap_or(0);
                    }
                }
                let mut body = vec![0; length];
                let _ = reader.read_exact(&mut body);
                let said = answer(&path, &String::from_utf8_lossy(&body));
                let _ = write!(reader.get_mut(), "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{said}", said.len());
            }
        });
        Hosts { web: at.clone(), api: at }
    }

    #[test]
    fn the_device_flow_tells_the_code_waits_and_gets_the_tokens() {
        let asked = Arc::new(Mutex::new(Vec::<String>::new()));
        let seen = asked.clone();
        let hosts = fake(move |path, body| {
            let mut asked = seen.lock().unwrap();
            asked.push(format!("{path} {body}"));
            let polls = asked.iter().filter(|a| a.starts_with("/login/oauth/access_token")).count();
            match (path, polls) {
                ("/login/device/code", _) => json!({ "device_code": "dev-1", "user_code": "ABCD-1234", "verification_uri": "https://github.com/login/device", "interval": 5, "expires_in": 900 }),
                ("/login/oauth/access_token", 1) => json!({ "error": "authorization_pending" }),
                ("/login/oauth/access_token", 2) => json!({ "error": "slow_down", "interval": 10 }),
                ("/login/oauth/access_token", _) => json!({ "access_token": "ghu_a", "expires_in": 28800, "refresh_token": "ghr_r", "refresh_token_expires_in": 15897600 }),
                ("/user", _) => json!({ "login": "octo", "name": "Octo Cat", "id": 42 }),
                _ => json!({ "error": "unexpected" }),
            }
            .to_string()
        });
        let told = Mutex::new(vec![]);
        let waits = Mutex::new(vec![]);
        let stop = AtomicBool::new(false);
        let t = device_flow(&hosts, &stop, &|n| if let News::Code { code, uri } = n { told.lock().unwrap().push(format!("{code} {uri}")) }, &|d| waits.lock().unwrap().push(d.as_secs())).unwrap().unwrap();
        assert_eq!(*told.lock().unwrap(), ["ABCD-1234 https://github.com/login/device"]);
        assert_eq!(*waits.lock().unwrap(), [5, 5, 10]); // (as often as GitHub allows, slower when told to)
        assert_eq!((t.access.as_str(), t.refresh.as_str()), ("ghu_a", "ghr_r"));
        assert!(t.expires > now() + 28000);
        {
            let asked = asked.lock().unwrap();
            assert!(asked[0].contains(&format!("client_id={CLIENT_ID}")) && !asked.iter().any(|a| a.contains("client_secret")));
            assert!(asked[1].contains("device_code=dev-1") && asked[1].contains("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code"));
        }
        // who it is, and who the commits are by
        let s = session(&hosts, &t).unwrap();
        assert_eq!((s.login.as_str(), s.id), ("octo", 42));
        assert_eq!(s.author(), ("Octo Cat".to_string(), "42+octo@users.noreply.github.com".to_string()));
    }

    #[test]
    fn the_device_flow_ends_where_the_user_says_no_or_gives_up() {
        let hosts = fake(|path, _| match path {
            "/login/device/code" => json!({ "device_code": "d", "user_code": "C", "interval": 1, "expires_in": 900 }),
            _ => json!({ "error": "access_denied", "error_description": "The user has denied your application access." }),
        }.to_string());
        let stop = AtomicBool::new(false);
        let said = device_flow(&hosts, &stop, &|_| {}, &|_| {});
        assert_eq!(said.err().as_deref(), Some("The user has denied your application access."));
        let pending = fake(|path, _| match path {
            "/login/device/code" => json!({ "device_code": "d", "user_code": "C", "interval": 1, "expires_in": 900 }),
            _ => json!({ "error": "authorization_pending" }),
        }.to_string());
        let stop = AtomicBool::new(false);
        assert!(device_flow(&pending, &stop, &|_| {}, &|_| stop.store(true, Ordering::Relaxed)).unwrap().is_none());
        // device flow not switched on for the app
        let off = fake(|_, _| json!({ "error": "device_flow_disabled", "error_description": "Device Flow must be explicitly enabled for this App" }).to_string());
        assert!(device_flow(&off, &AtomicBool::new(false), &|_| {}, &|_| {}).err().unwrap().contains("explicitly enabled"));
    }

    #[test]
    fn the_repositories_given_to_the_app_are_listed() {
        let hosts = fake(|path, _| match path {
            p if p.starts_with("/user/installations?") => json!({ "installations": [{ "id": 7 }, { "id": 9 }] }),
            p if p.starts_with("/user/installations/7/repositories") => json!({ "repositories": [
                { "full_name": "octo/Zeta", "clone_url": "https://github.com/octo/Zeta.git", "default_branch": "main", "private": true },
                { "full_name": "octo/alpha", "clone_url": "https://github.com/octo/alpha.git", "default_branch": "trunk", "private": false } ] }),
            _ => json!({ "repositories": [] }),
        }.to_string());
        let all = repositories(&hosts, "ghu_a").unwrap();
        assert_eq!(all.iter().map(|r| r["name"].as_str().unwrap()).collect::<Vec<_>>(), ["octo/alpha", "octo/Zeta"]);
        assert_eq!((all[0]["branch"].as_str(), all[0]["private"].as_bool(), all[1]["url"].as_str()), (Some("trunk"), Some(false), Some("https://github.com/octo/Zeta.git")));
        let none = fake(|_, _| json!({ "installations": [] }).to_string());
        assert!(repositories(&none, "ghu_a").unwrap().is_empty());
    }

    #[test]
    fn a_kept_sign_in_is_renewed_or_said_to_be_over() {
        let hosts = fake(|_, body| if body.contains("refresh_token=ghr_good") && body.contains("grant_type=refresh_token") && !body.contains("client_secret") {
            json!({ "access_token": "ghu_new", "expires_in": 28800, "refresh_token": "ghr_next" }).to_string()
        } else {
            json!({ "error": "bad_refresh_token", "error_description": "The refresh token passed is incorrect or expired." }).to_string()
        });
        let t = renew(&hosts, "ghr_good").unwrap().unwrap();
        assert_eq!((t.access.as_str(), t.refresh.as_str()), ("ghu_new", "ghr_next"));
        assert_eq!(renew(&hosts, "ghr_old").unwrap().err().as_deref(), Some("The refresh token passed is incorrect or expired."));
        // not reached: neither yes nor no
        assert!(renew(&Hosts { web: "http://127.0.0.1:9".into(), api: String::new() }, "ghr_good").is_err());
    }
}
