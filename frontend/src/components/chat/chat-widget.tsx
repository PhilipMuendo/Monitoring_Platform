"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useChat } from "@/hooks/use-chat";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const { messages, sendMessage, sending, error } = useChat();
  const { hasRole } = useAuth();
  const canAct = hasRole("admin", "technician");
  const scrollEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const submit = () => {
    if (!input.trim() || sending) return;
    void sendMessage(input);
    setInput("");
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          size="icon"
          className="fixed right-6 bottom-6 z-50 size-12 rounded-full shadow-lg"
          aria-label="Open fleet assistant"
        >
          <MessageCircle className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col data-[side=right]:w-full sm:data-[side=right]:max-w-md">
        <SheetHeader>
          <SheetTitle>Fleet assistant</SheetTitle>
          <SheetDescription>
            Ask about site status, power history, or alerts.
            {!canAct && " You have view-only access — you can ask, but not acknowledge alerts."}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 px-4">
          <div className="flex flex-col gap-3 pb-2">
            {messages.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Try: &quot;What&apos;s the fleet summary?&quot; or &quot;List active alerts&quot;.
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                  m.role === "user"
                    ? "self-end bg-primary text-primary-foreground"
                    : "self-start bg-muted text-foreground",
                )}
              >
                {m.text}
              </div>
            ))}
            {sending && (
              <div className="self-start rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                Thinking…
              </div>
            )}
            {error && (
              <div className="self-start rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            <div ref={scrollEndRef} />
          </div>
        </ScrollArea>

        <SheetFooter className="border-t pt-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="Ask about your fleet…"
              className="min-h-10 resize-none"
              rows={1}
              disabled={sending}
            />
            <Button size="icon" onClick={submit} disabled={sending || !input.trim()} aria-label="Send message">
              <Send className="size-4" />
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
