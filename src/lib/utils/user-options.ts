export type BookmarksSyncMode = "bar" | "folder";

export interface UserOptions {
  tagOptions: string[];
  accessToken: string;
  username: string;
  repo: string;
  filename: string;
  syncToBookmarksBar: boolean;
  bookmarksSyncMode: BookmarksSyncMode;
  bookmarksSyncIntervalMinutes: number;
}

export async function getUserOptions(): Promise<UserOptions> {
  const options = await chrome.storage.sync.get(["accessToken", "tagOptions", "username", "repo", "filename", "syncToBookmarksBar", "bookmarksSyncMode", "bookmarksSyncIntervalMinutes"]);

  const { accessToken = "", username = "", repo = "", filename = "README.md", tagOptions = [], syncToBookmarksBar = false, bookmarksSyncMode = "bar" as BookmarksSyncMode, bookmarksSyncIntervalMinutes = 0 } = options;
  const safeOptions: UserOptions = {
    accessToken,
    username,
    repo,
    filename,
    tagOptions: tagOptions,
    syncToBookmarksBar,
    bookmarksSyncMode,
    bookmarksSyncIntervalMinutes,
  };

  return safeOptions;
}

export async function setUserOptions(update: Partial<UserOptions>) {
  return chrome.storage.sync.set(update);
}
