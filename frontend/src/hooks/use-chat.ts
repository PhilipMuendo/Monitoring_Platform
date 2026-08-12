"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { apiUrl, getAccessToken } from "@/lib/api-client";

export interface ChatMessage {
  role: "user" | "model";
  text: string;
}

interface ChatEvent {
  type: string;
  data: unknown;
}

// Splits a growing text buffer into complete SSE frames ("event: x\ndata:
// y\n\n"), returning any trailing partial frame to prepend to the next
// chunk. Mirrors the wire format backend/internal/api/chat.go's writeSSE
// writes. A hand-rolled parser rather than EventSource because this is a
// POST request with a body — EventSource is GET-only.
function parseFrames(buffer: string): { events: ChatEvent[]; rest: string } {
  const events: ChatEvent[] = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    let type = "message";
    let data = "";
    for (const line of part.split("\n")) {
      if (line.startsWith("event: ")) type = line.slice(7);
      else if (line.startsWith("data: ")) data = line.slice(6);
    }
    if (!data) continue;
    try {
      events.push({ type, data: JSON.parse(data) });
    } catch {
      // malformed frame — drop it rather than crash the stream
    }
  }
  return { events, rest };
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  // Only the tail of the transcript is replayed to the backend (which
  // itself caps it further — see chatMaxHistory in chat.go) so a long chat
  // doesn't grow the prompt, and therefore the bill, without bound.
  const historyRef = useRef<ChatMessage[]>([]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;

      const userMessage: ChatMessage = { role: "user", text: trimmed };
      const history = historyRef.current;
      setMessages((prev) => [...prev, userMessage]);
      setError(null);
      setSending(true);

      let assistantText = "";
      let appendedAssistant = false;

      try {
        const res = await fetch(apiUrl("/api/v1/chat"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getAccessToken() ?? ""}`,
          },
          body: JSON.stringify({ message: trimmed, history }),
        });

        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => ({}) as { error?: string });
          throw new Error(body.error ?? `chat request failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { events, rest } = parseFrames(buffer);
          buffer = rest;

          for (const evt of events) {
            if (evt.type === "token") {
              assistantText += (evt.data as { text: string }).text;
              setMessages((prev) => {
                if (!appendedAssistant) {
                  appendedAssistant = true;
                  return [...prev, { role: "model", text: assistantText }];
                }
                const next = prev.slice();
                next[next.length - 1] = { role: "model", text: assistantText };
                return next;
              });
            } else if (evt.type === "tool_result") {
              // A tool (currently only acknowledge_alert) mutated fleet
              // state — refresh the same query keys the dashboard's own
              // acknowledge button invalidates (see useAcknowledgeAlert in
              // use-alerts.ts) so the UI reflects it without a reload.
              qc.invalidateQueries({ queryKey: ["alerts"] });
              qc.invalidateQueries({ queryKey: ["sites"] });
              qc.invalidateQueries({ queryKey: ["fleet-summary"] });
            } else if (evt.type === "error") {
              setError((evt.data as { error: string }).error);
            }
          }
        }

        const assistantMessage: ChatMessage = { role: "model", text: assistantText };
        historyRef.current = [...history, userMessage, assistantMessage].slice(-20);
      } catch (err) {
        setError(err instanceof Error ? err.message : "chat request failed");
      } finally {
        setSending(false);
      }
    },
    [qc, sending],
  );

  return { messages, sendMessage, sending, error };
}
