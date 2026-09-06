import MarkdownIt from "markdown-it";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { LibraryEntry } from "./types";
import "./styles.css";

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

const openLibraryButton = document.getElementById(
  "open-library",
) as HTMLButtonElement;
const fileList = document.getElementById("file-list") as HTMLElement;
const viewer = document.getElementById("viewer") as HTMLElement;

let entries: LibraryEntry[] = [];

openLibraryButton.addEventListener("click", async () => {
  const picked = await open({ directory: true, multiple: false });
  if (typeof picked !== "string") return;
  entries = await invoke<LibraryEntry[]>("list_library", { root: picked });
  renderSidebar();
});

function renderSidebar(): void {
  fileList.replaceChildren();
  for (const entry of entries) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `file-item kind-${entry.kind}`;
    item.textContent = entry.name;
    item.addEventListener("click", () => openEntry(entry));
    fileList.appendChild(item);
  }
}

function openEntry(entry: LibraryEntry): void {
  if (entry.kind === "markdown") {
    void renderMarkdown(entry.path);
  } else if (entry.kind === "video") {
    renderVideo(entry.path);
  }
}

async function renderMarkdown(path: string): Promise<void> {
  const raw = await invoke<string>("read_text_file", { path });
  const rendered = md.render(raw);
  viewer.replaceChildren();
  const article = document.createElement("article");
  article.className = "markdown-body";
  article.innerHTML = rendered;
  viewer.appendChild(article);
}

function renderVideo(path: string): void {
  viewer.replaceChildren();
  const video = document.createElement("video");
  video.controls = true;
  // Local file through Tauri's asset protocol — no network, no codec pack.
  video.src = convertFileSrc(path);
  viewer.appendChild(video);
}
