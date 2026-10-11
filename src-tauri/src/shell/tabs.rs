//! The tabs of a folder window: made, shown, chosen, closed, opened again, moved.

use super::*;

impl Win {
    pub(super) fn make_tab(&mut self, path: Option<&Path>) -> Tab {
        self.tab_seq += 1;
        Tab { id: self.tab_seq, path: path.map(resolve), back: vec![], fwd: vec![] }
    }

    pub(super) fn tab_index(&self, id: u64) -> Option<usize> {
        self.tabs.iter().position(|t| t.id == id)
    }

    /// What the window shows, written into its tab.
    pub(super) fn stash_tab(&mut self) {
        if let Some(t) = self.tabs.get_mut(self.tab) {
            t.path = self.path.clone();
            t.back = self.back.clone();
            t.fwd = self.fwd.clone();
        }
    }

    /// The tabs as they stand: kept for the folder's next opening, and told to the page.
    pub(super) fn send_tabs(&mut self, app: &mut App) {
        let Some(folder) = self.folder.clone() else { return };
        if self.tabs.is_empty() {
            let tab = self.make_tab(self.path.clone().as_deref());
            self.tabs = vec![tab];
            self.tab = 0;
        }
        self.stash_tab();
        let kept = json!({ "paths": self.tabs.iter().map(|t| t.path.as_deref().map(s).unwrap_or_default()).collect::<Vec<_>>(), "active": self.tab });
        let every = app.sub("tabs");
        if every.get(&s(&folder)) != Some(&kept) {
            bump(every, &s(&folder), kept, 20);
            app.save_state();
        }
        if !self.shell_ready {
            return;
        }
        let payload = json!({
            "tabs": self.tabs.iter().map(|t| json!({ "id": t.id, "path": t.path.as_deref().map(s), "name": t.path.as_deref().map(name_of).unwrap_or_default() })).collect::<Vec<_>>(),
            "active": self.tabs[self.tab].id,
            "closed": !self.closed_tabs.is_empty(),
        });
        let blob = payload.to_string();
        if self.tabs_json.as_ref() != Some(&blob) {
            self.tabs_json = Some(blob);
            self.js("MdView.setTabs", &[payload]);
        }
    }

    /// Tab i takes the window (the one shown before is written down already).
    pub(super) fn show_tab(&mut self, app: &mut App, i: usize, fragment: Option<String>) {
        self.tab = i;
        let t = &self.tabs[i];
        self.back = t.back.clone();
        self.fwd = t.fwd.clone();
        match t.path.clone().filter(|p| p.is_file()) {
            Some(path) => self.open_path(app, &path, fragment, false),
            None => self.show_nothing(app), // an empty tab, or its file is gone
        }
    }

    pub(super) fn select_tab(&mut self, app: &mut App, id: u64) {
        if let Some(i) = self.tab_index(id).filter(|&i| i != self.tab) {
            self.stash_tab();
            self.show_tab(app, i, None);
        }
    }

    /// A tab beside the one shown, and shown at once: empty (the folder's notes to choose from), or on a file.
    pub(super) fn new_tab(&mut self, app: &mut App, path: Option<&Path>, fragment: Option<String>, at: Option<usize>) {
        if self.folder.is_none() {
            return;
        }
        self.stash_tab();
        let i = self.tabs.len().min(at.unwrap_or(self.tab + 1));
        let tab = self.make_tab(path);
        self.tabs.insert(i, tab);
        self.show_tab(app, i, fragment);
    }

    pub(super) fn close_tab(&mut self, app: &mut App, id: u64) {
        let Some(i) = self.tab_index(id) else { return };
        if self.tabs.len() == 1 {
            // the last one: its note goes, the window stays — with an empty tab, which shows All
            // Notes. (Closed once more, empty as it is, the window goes with it.)
            self.stash_tab();
            let Some(path) = self.tabs[0].path.clone().filter(|_| self.folder.is_some()) else { return self.close(app) };
            self.closed_tabs.push((path, 0));
            let over = self.closed_tabs.len().saturating_sub(20);
            self.closed_tabs.drain(..over);
            self.tabs[0] = self.make_tab(None);
            return self.show_tab(app, 0, None);
        }
        self.stash_tab();
        let gone = self.tabs.remove(i);
        if let Some(path) = gone.path {
            self.closed_tabs.push((path, i));
            let over = self.closed_tabs.len().saturating_sub(20);
            self.closed_tabs.drain(..over);
        }
        if i == self.tab {
            self.show_tab(app, i.min(self.tabs.len() - 1), None);
        } else {
            if i < self.tab {
                self.tab -= 1;
            }
            self.send_tabs(app);
        }
    }

    pub(super) fn close_other_tabs(&mut self, app: &mut App, id: u64) {
        let Some(i) = self.tab_index(id).filter(|_| self.tabs.len() > 1) else { return };
        self.stash_tab();
        let was_shown = i == self.tab;
        for (k, t) in self.tabs.iter().enumerate() {
            if k != i {
                if let Some(path) = &t.path {
                    self.closed_tabs.push((path.clone(), k));
                }
            }
        }
        let over = self.closed_tabs.len().saturating_sub(20);
        self.closed_tabs.drain(..over);
        let keep = self.tabs.remove(i);
        self.tabs = vec![keep];
        if was_shown {
            self.tab = 0;
            self.send_tabs(app);
        } else {
            self.show_tab(app, 0, None);
        }
    }

    pub(super) fn reopen_tab(&mut self, app: &mut App) {
        while let Some((path, at)) = self.closed_tabs.pop() {
            if path.is_file() {
                return self.new_tab(app, Some(&path), None, Some(at));
            }
        }
        self.send_tabs(app);
    }

    pub(super) fn move_tab(&mut self, app: &mut App, id: u64, to: i64) {
        let Some(i) = self.tab_index(id) else { return };
        self.stash_tab();
        let shown = self.tabs[self.tab].id;
        let t = self.tabs.remove(i);
        let to = to.clamp(0, self.tabs.len() as i64) as usize;
        self.tabs.insert(to, t);
        self.tab = self.tab_index(shown).unwrap_or(0);
        self.send_tabs(app);
    }

    pub(super) fn tab_op(&mut self, app: &mut App, msg: &Value) {
        if self.folder.is_none() || self.tabs.is_empty() {
            return;
        }
        let id = match &msg["id"] {
            Value::Number(n) => n.as_u64(),
            Value::String(t) => t.parse().ok(),
            _ => None,
        }
        .unwrap_or(self.tabs[self.tab].id);
        match msg["op"].as_str() {
            Some("select") => self.select_tab(app, id),
            Some("new") => self.new_tab(app, None, None, None),
            Some("close") => self.close_tab(app, id),
            Some("others") => self.close_other_tabs(app, id),
            Some("reopen") => self.reopen_tab(app),
            Some("move") => {
                let to = match &msg["to"] {
                    Value::Number(n) => n.as_f64().map(|f| f as i64),
                    Value::String(t) => t.trim().parse().ok(),
                    _ => None,
                };
                if let Some(to) = to {
                    self.move_tab(app, id, to);
                }
            }
            _ => {}
        }
    }
}
