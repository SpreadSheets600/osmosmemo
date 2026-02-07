export interface UserOptions {
  tagOptions: string[];
  accessToken: string;
  username: string;
  repo: string;
  filename: string;
  syncToBookmarksBar: boolean;
  bookmarksSyncIntervalMinutes: number;
}

export async function getUserOptions(): Promise<UserOptions> {
  const options = await chrome.storage.sync.get(["accessToken", "tagOptions", "username", "repo", "filename", "syncToBookmarksBar", "bookmarksSyncIntervalMinutes"]);

  const { accessToken = "", username = "", repo = "", filename = "README.md", tagOptions = [], syncToBookmarksBar = false, bookmarksSyncIntervalMinutes = 0 } = options;
  const safeOptions: UserOptions = {
    accessToken,
    username,
    repo,
    filename,
    tagOptions: tagOptions,
    syncToBookmarksBar,
    bookmarksSyncIntervalMinutes,
  };

  return safeOptions;
}

export async function setUserOptions(update: Partial<UserOptions>) {
  return chrome.storage.sync.set(update);
}
