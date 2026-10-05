//! A project and the repository it is linked to: what is fetched from there and pushed to it.
//! The repository is GitHub's, reached over HTTPS with the token of the user who signed in; a
//! path on this machine is one too (the tests' other side). The token is handed to the
//! transport in memory, and stands in no file and in no address.
#![allow(dead_code)] // (the shell does not ask yet: the reconciling is the next step)

use std::path::Path;

use git2::{Cred, FetchOptions, PushOptions, RemoteCallbacks, Repository};

pub const REMOTE: &str = "origin";

type Res<T> = Result<T, String>;

fn say<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// What the other side is reached with: the token of the signed-in user (none: an address that
/// asks for nothing).
#[derive(Clone, Default)]
pub struct Access {
    pub token: Option<String>,
}

impl Access {
    fn callbacks(&self) -> RemoteCallbacks<'_> {
        let mut callbacks = RemoteCallbacks::new();
        let mut asked = false;
        callbacks.credentials(move |_url, _user, _allowed| {
            // (asked again: the token was not taken — said once, not tried for ever)
            if std::mem::replace(&mut asked, true) {
                return Err(git2::Error::from_str("the sign-in was not accepted"));
            }
            match &self.token {
                Some(token) => Cred::userpass_plaintext("x-access-token", token),
                None => Err(git2::Error::from_str("not signed in")),
            }
        });
        callbacks
    }
}

/// The project's repository is told where its other side is (anew, if it had another).
pub fn link(root: &Path, url: &str) -> Res<()> {
    let repo = Repository::open(root).map_err(say)?;
    if repo.find_remote(REMOTE).is_ok() {
        return repo.remote_set_url(REMOTE, url).map_err(say);
    }
    let made = repo.remote(REMOTE, url).map(|_| ()).map_err(say);
    made
}

/// Where the project's other side is, if it has one.
pub fn linked(root: &Path) -> Option<String> {
    let repo = Repository::open(root).ok()?;
    let url = repo.find_remote(REMOTE).ok()?.url().ok().map(String::from);
    url
}

/// The branches the repository at an address has (none: it is empty). Says whether it can be reached.
pub fn branches(url: &str, access: &Access) -> Res<Vec<String>> {
    let mut remote = git2::Remote::create_detached(url).map_err(say)?;
    let connection = remote.connect_auth(git2::Direction::Fetch, Some(access.callbacks()), None).map_err(say)?;
    let heads = connection.list().map_err(say)?.iter().filter_map(|h| h.name().strip_prefix("refs/heads/").map(String::from)).collect();
    Ok(heads)
}

/// What the other side has is brought here (refs/remotes/origin/…); nothing of the folder changes.
pub fn fetch(root: &Path, access: &Access) -> Res<()> {
    let repo = Repository::open(root).map_err(say)?;
    let mut remote = repo.find_remote(REMOTE).map_err(say)?;
    let mut opts = FetchOptions::new();
    opts.remote_callbacks(access.callbacks());
    remote.fetch(&[] as &[&str], Some(&mut opts), None).map_err(say)
}

/// The project's branch goes to the other side — only as a continuation of what is there: where
/// the other side has commits this one has not, nothing is pushed and that is said.
pub fn push(root: &Path, access: &Access) -> Res<()> {
    let repo = Repository::open(root).map_err(say)?;
    let head = repo.head().map_err(say)?;
    let branch = head.name().map_err(say)?.to_string();
    let mut remote = repo.find_remote(REMOTE).map_err(say)?;
    let mut refused = None;
    {
        let mut callbacks = access.callbacks();
        callbacks.push_update_reference(|_name, status| {
            refused = status.map(String::from);
            Ok(())
        });
        let mut opts = PushOptions::new();
        opts.remote_callbacks(callbacks);
        remote.push(&[format!("{branch}:{branch}")], Some(&mut opts)).map_err(say)?;
    }
    match refused {
        Some(why) => Err(why),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::{self, Stamp};
    use std::fs;
    use std::path::PathBuf;

    struct Dir(PathBuf);
    impl Dir {
        fn new() -> Dir {
            let d = std::env::temp_dir().join(format!("mdview-sync-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&d).unwrap();
            Dir(d.canonicalize().unwrap())
        }
    }
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn stamp(device: &str) -> Stamp {
        Stamp { device: format!("{device} (1234)"), client: "desktop test".into(), author: Some(("Tester".into(), "tester@example.invalid".into())) }
    }

    fn head(root: &Path, name: &str) -> Option<String> {
        Repository::open(root).ok()?.refname_to_id(name).ok().map(|id| id.to_string())
    }

    /// The other side (a repository without a folder, as GitHub's is), and one device's project linked to it.
    fn pair(d: &Dir) -> (PathBuf, PathBuf) {
        let (hub, a) = (d.0.join("hub.git"), d.0.join("a"));
        let mut bare = git2::RepositoryInitOptions::new();
        bare.bare(true).initial_head("main"); // (as GitHub: the branch first pushed is the one a clone gets)
        Repository::init_opts(&hub, &bare).unwrap();
        fs::create_dir_all(&a).unwrap();
        fs::write(a.join("note.md"), "one\n").unwrap();
        history::enable(&a).unwrap();
        history::snapshot(&a, &stamp("a")).unwrap();
        link(&a, hub.to_str().unwrap()).unwrap();
        (hub, a)
    }

    #[test]
    fn a_project_is_pushed_and_another_device_gets_it() {
        let d = Dir::new();
        let (hub, a) = pair(&d);
        let none = Access::default();
        assert_eq!(linked(&a).as_deref(), hub.to_str());
        assert!(branches(hub.to_str().unwrap(), &none).unwrap().is_empty()); // (empty yet)
        push(&a, &none).unwrap();
        assert_eq!(branches(hub.to_str().unwrap(), &none).unwrap(), ["main"]);
        assert_eq!(head(&hub, "refs/heads/main"), head(&a, "HEAD"));

        // another device: the repository fetched into a new folder is the same project
        let b = d.0.join("b");
        Repository::clone(hub.to_str().unwrap(), &b).unwrap();
        assert_eq!(history::place_of(&b), history::Place::Project(b.clone()));
        assert_eq!(fs::read(b.join(".mdview/project.json")).unwrap(), fs::read(a.join(".mdview/project.json")).unwrap());
        fs::write(b.join("note.md"), "two\n").unwrap();
        history::snapshot(&b, &stamp("b")).unwrap();
        push(&b, &none).unwrap();

        // back on the first: fetched, it knows of the other's commit and its folder is untouched
        fetch(&a, &none).unwrap();
        assert_eq!(head(&a, "refs/remotes/origin/main"), head(&b, "HEAD"));
        assert_ne!(head(&a, "HEAD"), head(&b, "HEAD"));
        assert_eq!(fs::read_to_string(a.join("note.md")).unwrap(), "one\n");
    }

    #[test]
    fn a_push_over_commits_not_had_here_is_refused() {
        let d = Dir::new();
        let (hub, a) = pair(&d);
        let none = Access::default();
        push(&a, &none).unwrap();
        let b = d.0.join("b");
        Repository::clone(hub.to_str().unwrap(), &b).unwrap();
        fs::write(b.join("note.md"), "theirs\n").unwrap();
        history::snapshot(&b, &stamp("b")).unwrap();
        push(&b, &none).unwrap();
        fs::write(a.join("note.md"), "mine\n").unwrap();
        history::snapshot(&a, &stamp("a")).unwrap();
        assert!(push(&a, &none).is_err());
        assert_eq!(head(&hub, "refs/heads/main"), head(&b, "HEAD")); // (the other side is as it was)
    }

    #[test]
    fn without_a_link_nothing_is_fetched_or_pushed() {
        let d = Dir::new();
        let a = d.0.join("a");
        fs::create_dir_all(&a).unwrap();
        fs::write(a.join("note.md"), "one\n").unwrap();
        history::enable(&a).unwrap();
        history::snapshot(&a, &stamp("a")).unwrap();
        assert_eq!(linked(&a), None);
        assert!(fetch(&a, &Access::default()).is_err() && push(&a, &Access::default()).is_err());
    }

    /// The transport over HTTPS, against the real GitHub: a public repository's branches are
    /// read without signing in, and a private address without a token is refused, not waited
    /// for. Needs the network — cargo test --release network -- --ignored
    #[test]
    #[ignore]
    fn network_https_reaches_github() {
        let none = Access::default();
        assert!(!branches("https://github.com/libgit2/libgit2", &none).unwrap().is_empty());
        assert!(branches("https://github.com/henriSchulz/a-repository-that-is-not-there", &none).is_err());
        let wrong = Access { token: Some("not-a-token".into()) };
        assert!(branches("https://github.com/henriSchulz/a-repository-that-is-not-there", &wrong).is_err());
    }
}
