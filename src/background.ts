import { getContentString, updateContent } from "./lib/github/rest-api.js";
import { getUserOptions } from "./lib/utils/user-options.js";
import { parseAllEntries } from "./lib/utils/markdown.js";

interface SyncResult {
  status: "ok" | "skipped" | "error";
  message: string;
}

let syncing = false;

function bookmarkToMarkdownEntry(title: string, url: string): string {
  return `- [${title}](${url})`;
}

async function collectBrowserBookmarks(folderId: string): Promise<{ title: string; url: string }[]> {
  const children = await chrome.bookmarks.getChildren(folderId);
  const results: { title: string; url: string }[] = [];
  for (const child of children) {
    if (child.url) {
      results.push({ title: child.title, url: child.url });
    }
    if (!child.url && child.id) {
      const nested = await collectBrowserBookmarks(child.id);
      results.push(...nested);
    }
  }
  return results;
}

async function syncBookmarks(markdownString?: string): Promise<SyncResult> {
  if (syncing) {
    return { status: "skipped", message: "Sync already in progress" };
  }

  syncing = true;

  try {
    const options = await getUserOptions();

    if (!options.syncToBookmarksBar) {
      return { status: "skipped", message: "Sync is disabled" };
    }

    const hasPermission = await chrome.permissions.contains({ permissions: ["bookmarks"] });
    if (!hasPermission) {
      return { status: "skipped", message: "Bookmarks permission not granted" };
    }

    const { accessToken, username, repo, filename } = options;
    if (!accessToken || !username || !repo) {
      return { status: "skipped", message: "GitHub credentials not configured" };
    }

    const tree = await chrome.bookmarks.getTree();
    const bookmarksBar = tree[0].children?.[0];
    if (!bookmarksBar) {
      return { status: "error", message: "Bookmarks bar not found" };
    }

    let targetFolderId: string;
    if (options.bookmarksSyncMode === "folder") {
      let osmosFolder = bookmarksBar.children?.find((child) => child.title === "osmosmemo" && !child.url);
      if (!osmosFolder) {
        osmosFolder = await chrome.bookmarks.create({ parentId: bookmarksBar.id, title: "osmosmemo" });
      }
      targetFolderId = osmosFolder.id;
    } else {
      targetFolderId = bookmarksBar.id;
    }

    // Step 1: Fetch current GitHub file content
    if (!markdownString) {
      markdownString = await getContentString({ accessToken, username, repo, filename });
    }
    const fileEntries = parseAllEntries(markdownString);
    const fileUrls = new Set(fileEntries.map((e) => e.href));

    // Step 2: Collect browser bookmarks from target folder
    const browserBookmarks = await collectBrowserBookmarks(targetFolderId);
    const browserUrls = new Set(browserBookmarks.map((b) => b.url));

    // Step 3: Import browser bookmarks not in file → push to GitHub
    const newFromBrowser = browserBookmarks.filter((b) => !fileUrls.has(b.url));
    let imported = 0;
    if (newFromBrowser.length > 0) {
      const newLines = newFromBrowser.map((b) => bookmarkToMarkdownEntry(b.title, b.url)).join("\n");
      markdownString = await updateContent(
        { accessToken, username, repo, filename, message: `sync: import ${newFromBrowser.length} browser bookmarks` },
        (existing) => newLines + (existing ? "\n" + existing : "")
      );
      imported = newFromBrowser.length;
      // Re-parse after update
      const updatedEntries = parseAllEntries(markdownString);
      fileUrls.clear();
      for (const e of updatedEntries) fileUrls.add(e.href);
      fileEntries.length = 0;
      fileEntries.push(...updatedEntries);
    }

    // Step 4: Sync file entries → browser bookmarks bar
    const currentChildren = await chrome.bookmarks.getChildren(targetFolderId);
    const existingByUrl = new Map<string, chrome.bookmarks.BookmarkTreeNode>();
    for (const child of currentChildren) {
      if (child.url) {
        existingByUrl.set(child.url, child);
      }
    }

    let created = 0;
    let updated = 0;
    let removed = 0;

    for (const entry of fileEntries) {
      const existing = existingByUrl.get(entry.href);
      if (existing) {
        if (existing.title !== entry.title) {
          await chrome.bookmarks.update(existing.id, { title: entry.title });
          updated++;
        }
      } else {
        await chrome.bookmarks.create({ parentId: targetFolderId, title: entry.title, url: entry.href });
        created++;
      }
    }

    // In folder mode, remove stale bookmarks from folder
    if (options.bookmarksSyncMode === "folder") {
      const desiredUrls = new Set(fileEntries.map((e) => e.href));
      for (const [url, node] of existingByUrl) {
        if (!desiredUrls.has(url)) {
          await chrome.bookmarks.remove(node.id);
          removed++;
        }
      }
    }

    const parts: string[] = [];
    if (imported > 0) parts.push(`${imported} imported from browser`);
    if (created > 0) parts.push(`${created} added to bar`);
    if (updated > 0) parts.push(`${updated} updated`);
    if (removed > 0) parts.push(`${removed} removed`);
    const total = fileEntries.length;
    const detail = parts.length > 0 ? parts.join(", ") : "already in sync";
    const msg = `${total} bookmarks synced (${detail})`;
    return { status: "ok", message: msg };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[background] sync failed", error);
    return { status: "error", message: msg };
  } finally {
    syncing = false;
  }
}

async function updateSyncAlarm(): Promise<void> {
  const options = await getUserOptions();

  if (options.syncToBookmarksBar && options.bookmarksSyncIntervalMinutes > 0) {
    await chrome.alarms.create("bookmarks-sync", { periodInMinutes: options.bookmarksSyncIntervalMinutes });
  } else {
    await chrome.alarms.clear("bookmarks-sync");
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const options = await getUserOptions();
  if (options.syncToBookmarksBar) {
    await updateSyncAlarm();
    await syncBookmarks();
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const options = await getUserOptions();
  if (options.syncToBookmarksBar) {
    await updateSyncAlarm();
    await syncBookmarks();
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "bookmarks-sync") {
    await syncBookmarks();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "SYNC_BOOKMARKS_NOW") {
    syncBookmarks(message.markdownString).then((result) => sendResponse(result));
    return true;
  }

  if (message.type === "SYNC_SETTINGS_CHANGED") {
    updateSyncAlarm().then(() => sendResponse({ status: "ok" }));
    return true;
  }
});

export {};
