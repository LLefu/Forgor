import { Sparkles } from "lucide-react";
import { useUI } from "@/app/store";
import { NavItem } from "@/components/NavItem";
import type { Plugin } from "../types";
import { pluginView } from "../host";
import { ChatPage } from "./ChatPage";
import { startChatIndex } from "./indexer";
import { CHAT_MODELS } from "./models";

/**
 * AI chat: questions about your own notes, todos and (through other plugins'
 * `chat` items) tickets and pull requests, answered by the local language
 * model from what the app finds first (search.ts). Nothing leaves the computer.
 */
export const chatPlugin: Plugin = {
  id: "chat",
  name: "AI chat",
  description:
    "Ask about your notes and todos (“what did we decide about…?”, “do I have todos for…?”) and get an answer with links to where it found it. With Jira or Bitbucket on, tickets and pull requests too. Runs on this computer.",
  version: "1.0.0",
  author: "Forgor",
  icon: Sparkles,
  builtIn: true,
  models: CHAT_MODELS,
  sidebar: () => <NavItem icon={Sparkles} label="Chat" target={pluginView("chat", "main")} testId="nav-chat" />,
  pages: { main: { useTab: () => ({ label: "Chat", icon: Sparkles }), component: () => <ChatPage /> } },
  start: startChatIndex,
  shortcuts: [{ id: "open", label: "Open the chat", keys: ["Mod+J"], run: () => useUI.getState().setView(pluginView("chat", "main")) }],
};
