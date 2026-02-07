import { getContentString } from "./lib/github/rest-api";
import { fitTextareaToContent } from "./lib/utils/fit-textarea-to-content";
import { getUniqueTagsFromMarkdownString } from "./lib/utils/tags";
import { getUserOptions, setUserOptions } from "./lib/utils/user-options";

const optionsForm = document.querySelector(".js-options-form") as HTMLElement;
const connectButtonElement = document.querySelector(".js-connect") as HTMLElement;
const accessTokenElement = document.querySelector(".js-access-token") as HTMLInputElement;
const tagsElement = document.querySelector(".js-tags") as HTMLElement;
const tagCountElement = document.querySelector(".js-tag-count") as HTMLElement;
const usernameElement = document.querySelector(".js-username") as HTMLInputElement;
const repoElement = document.querySelector(".js-repo") as HTMLInputElement;
const filenameElement = document.querySelector(".js-filename") as HTMLInputElement;
const syncToggleElement = document.querySelector(".js-sync-toggle") as HTMLInputElement;
const syncModeFieldElement = document.querySelector(".js-sync-mode-field") as HTMLElement;
const syncModeElement = document.querySelector(".js-sync-mode") as HTMLSelectElement;
const syncIntervalFieldElement = document.querySelector(".js-sync-interval-field") as HTMLElement;
const syncIntervalElement = document.querySelector(".js-sync-interval") as HTMLInputElement;
const syncNowElement = document.querySelector(".js-sync-now") as HTMLButtonElement;
const syncStatusElement = document.querySelector(".js-sync-status") as HTMLSpanElement;

function renderInputField({ element, string }) {
  element.value = string;
}

async function renderAllFields() {
  const { accessToken, username, repo, filename, syncToBookmarksBar, bookmarksSyncMode, bookmarksSyncIntervalMinutes } = await getUserOptions();

  renderInputField({ element: accessTokenElement, string: accessToken });
  renderInputField({ element: usernameElement, string: username });
  renderInputField({ element: repoElement, string: repo });
  renderInputField({ element: filenameElement, string: filename });

  syncToggleElement.checked = syncToBookmarksBar;
  syncModeElement.value = bookmarksSyncMode;
  syncIntervalElement.value = bookmarksSyncIntervalMinutes > 0 ? String(bookmarksSyncIntervalMinutes) : "";
  updateSyncUI(syncToBookmarksBar);
}

function updateSyncUI(enabled: boolean) {
  syncModeFieldElement.style.display = enabled ? "" : "none";
  syncIntervalFieldElement.style.display = enabled ? "" : "none";
  syncNowElement.style.display = enabled ? "" : "none";
}

renderAllFields();

chrome.storage.onChanged.addListener(function (changes, namespace) {
  if (namespace === "sync") {
    renderAllFields();
  }
});

connectButtonElement.addEventListener("click", async (event) => {
  if (!(optionsForm as HTMLFormElement).checkValidity()) return;
  event.preventDefault();

  const accessToken = accessTokenElement.value;
  const username = usernameElement.value;
  const repo = repoElement.value;
  const filename = filenameElement.value;

  connectButtonElement.innerText = "🔗 Connecting…";

  try {
    const markdownString = await getContentString({ accessToken, username, repo, filename });
    connectButtonElement.innerText = "✅ Connected to GitHub";
    setUserOptions({ accessToken, username, repo, filename });

    const tagOptions = await getUniqueTagsFromMarkdownString(markdownString);
    updateTagOptionsPreview(tagOptions);
    showConditionalElements("on-success");
  } catch (e) {
    connectButtonElement.innerText = "❌ Something went wrong. Try again";
    showConditionalElements("on-error");
  }
});

function updateTagOptionsPreview(tags: string[]) {
  renderInputField({ element: tagsElement, string: tags.join(", ") });
  tagCountElement.innerText = `${tags.length} found`;

  fitTextareaToContent();
}

function showConditionalElements(condition: "on-success" | "on-error") {
  (document.querySelectorAll(`[data-show]`) as NodeListOf<HTMLElement>).forEach((element) => {
    if (element.dataset.show === condition) {
      element.dataset.showActive = "";
    } else {
      delete element.dataset.showActive;
    }
  });
}

syncToggleElement.addEventListener("change", async () => {
  const wantEnabled = syncToggleElement.checked;

  if (wantEnabled) {
    const granted = await chrome.permissions.request({ permissions: ["bookmarks"] });
    if (!granted) {
      syncToggleElement.checked = false;
      syncStatusElement.innerText = "Permission denied";
      return;
    }
  }

  await setUserOptions({ syncToBookmarksBar: wantEnabled });
  updateSyncUI(wantEnabled);
  chrome.runtime.sendMessage({ type: "SYNC_SETTINGS_CHANGED" });

  if (wantEnabled) {
    syncStatusElement.innerText = "Syncing...";
    chrome.runtime.sendMessage({ type: "SYNC_BOOKMARKS_NOW" }).then((result) => {
      syncStatusElement.innerText = result?.message ?? "Done";
    }).catch((e) => {
      syncStatusElement.innerText = `Sync failed: ${e.message ?? e}`;
    });
  } else {
    syncStatusElement.innerText = "";
  }
});

syncModeElement.addEventListener("change", async () => {
  const mode = syncModeElement.value as "bar" | "folder";
  await setUserOptions({ bookmarksSyncMode: mode });
  chrome.runtime.sendMessage({ type: "SYNC_SETTINGS_CHANGED" });
});

syncIntervalElement.addEventListener("change", async () => {
  const minutes = parseInt(syncIntervalElement.value) || 0;
  await setUserOptions({ bookmarksSyncIntervalMinutes: minutes });
  chrome.runtime.sendMessage({ type: "SYNC_SETTINGS_CHANGED" });
});

syncNowElement.addEventListener("click", async () => {
  syncStatusElement.innerText = "Syncing...";
  try {
    const result = await chrome.runtime.sendMessage({ type: "SYNC_BOOKMARKS_NOW" });
    syncStatusElement.innerText = result?.message ?? "Done";
  } catch (e: any) {
    syncStatusElement.innerText = `Sync failed: ${e.message ?? e}`;
  }
});
