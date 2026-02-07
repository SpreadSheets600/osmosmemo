import { getContentString } from "./lib/github/rest-api.js";
import { getUserOptions } from "./lib/utils/user-options.js";
import { parseAllEntries } from "./lib/utils/markdown.js";

let syncing = false;

async function syncBookmarks(markdownString?: string): Promise<void> {
  if (syncing) {
    console.log("[background] sync already in progress, skipping");
    return;
  }

  syncing = true;

  try {
    const options = await getUserOptions();

    if (!options.syncToBookmarksBar) {
      console.log("[background] syncToBookmarksBar is disabled, skipping");
      return;
    }

    if (!markdownString) {
      markdownString = await getContentString(options);
    }

    const entries = parseAllEntries(markdownString);
    const tree = await chrome.bookmarks.getTree();
    const bookmarksBar = tree[0].children?.[0];
    if (!bookmarksBar) {
      console.log("[background] bookmarks bar not found");
      return;
    }

    let osmosFolder = bookmarksBar.children?.find((child) => child.title === "osmosmemo" && !child.url);
    if (!osmosFolder) {
      osmosFolder = await chrome.bookmarks.create({ parentId: bookmarksBar.id, title: "osmosmemo" });
    }

    const currentChildren = await chrome.bookmarks.getChildren(osmosFolder.id);

    const existingByUrl = new Map<string, chrome.bookmarks.BookmarkTreeNode>();
    for (const child of currentChildren) {
      if (child.url) {
        existingByUrl.set(child.url, child);
      }
    }

    const desiredUrls = new Set<string>(entries.map((e) => e.href));

    for (const entry of entries) {
      const existing = existingByUrl.get(entry.href);
      if (existing) {
        if (existing.title !== entry.title) {
          await chrome.bookmarks.update(existing.id, { title: entry.title });
        }
      } else {
        await chrome.bookmarks.create({ parentId: osmosFolder.id, title: entry.title, url: entry.href });
      }
    }

    for (const [url, node] of existingByUrl) {
      if (!desiredUrls.has(url)) {
        await chrome.bookmarks.remove(node.id);
      }
    }

    console.log(`[background] sync complete — ${entries.length} entries`);
  } catch (error) {
    console.error("[background] sync failed", error);
  } finally {
    syncing = false;
  }
}

async function updateSyncAlarm(): Promise<void> {
  const options = await getUserOptions();

  if (options.syncToBookmarksBar && options.bookmarksSyncIntervalMinutes > 0) {
    await chrome.alarms.create("bookmarks-sync", { periodInMinutes: options.bookmarksSyncIntervalMinutes });
    console.log(`[background] alarm set — every ${options.bookmarksSyncIntervalMinutes} min`);
  } else {
    await chrome.alarms.clear("bookmarks-sync");
    console.log("[background] alarm cleared");
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  console.log("[background] onInstalled");
  const options = await getUserOptions();
  if (options.syncToBookmarksBar) {
    await updateSyncAlarm();
    await syncBookmarks();
  }
});

chrome.runtime.onStartup.addListener(async () => {
  console.log("[background] onStartup");
  const options = await getUserOptions();
  if (options.syncToBookmarksBar) {
    await updateSyncAlarm();
    await syncBookmarks();
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "bookmarks-sync") {
    console.log("[background] alarm triggered");
    await syncBookmarks();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "SYNC_BOOKMARKS_NOW") {
    syncBookmarks(message.markdownString).then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === "SYNC_SETTINGS_CHANGED") {
    updateSyncAlarm().then(() => sendResponse({ success: true }));
    return true;
  }
});

export {};
