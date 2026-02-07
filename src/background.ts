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

async function syncBookmarks(): Promise<SyncResult> {
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

    const browserBookmarks = await collectBrowserBookmarks(targetFolderId);
    if (browserBookmarks.length === 0) {
      return { status: "skipped", message: "No bookmarks found in browser" };
    }

    const markdownString = await getContentString({ accessToken, username, repo, filename });
    const fileEntries = parseAllEntries(markdownString);
    const fileUrls = new Set(fileEntries.map((e) => e.href));

    const newFromBrowser = browserBookmarks.filter((b) => !fileUrls.has(b.url));

    if (newFromBrowser.length === 0) {
      return { status: "ok", message: `${browserBookmarks.length} bookmarks already in sync` };
    }

    const newLines = newFromBrowser.map((b) => bookmarkToMarkdownEntry(b.title, b.url)).join("\n");
    await updateContent(
      { accessToken, username, repo, filename, message: `sync: import ${newFromBrowser.length} browser bookmarks` },
      (existing) => newLines + (existing ? "\n" + existing : "")
    );

    return { status: "ok", message: `Synced ${newFromBrowser.length} new bookmarks to GitHub` };
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
    syncBookmarks().then((result) => sendResponse(result));
    return true;
  }

  if (message.type === "SYNC_SETTINGS_CHANGED") {
    updateSyncAlarm().then(() => sendResponse({ status: "ok" }));
    return true;
  }
});

export {};
