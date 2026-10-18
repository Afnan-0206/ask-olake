"use client";

import * as React from "react";
import { ArrowUp, Check, ChevronDown, GitFork, Square } from "lucide-react";

export type BranchingReasoningStatus = "idle" | "branching" | "choosing" | "answering" | "done";
export type ReasoningBranch = { id: string; title: string; note: string; score?: number; chosen?: boolean };
export type BranchingReasoningChatInputProps = {
  ref?: React.ComponentProps<"div">["ref"];
  status?: BranchingReasoningStatus;
  branches?: ReasoningBranch[];
  prompt?: string;
  answer?: string;
  answerSlot?: React.ReactNode;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  onStop?: () => void;
  expanded?: boolean;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  sourcesSlot?: React.ReactNode;
};

type CardPosition = { left: number; top: number; width: number; height: number; angle: number; opacity: number };
const EMPTY_BRANCHES: ReasoningBranch[] = [];
const MOVE_MS = 520;
const EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

function boundedScore(score?: number) {
  return typeof score === "number" && Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : undefined;
}

/** Present host-provided approach summaries and scores. No timers, autoplay, or requests. */
export function BranchingReasoningChatInput({
  ref,
  status = "idle",
  branches = EMPTY_BRANCHES,
  prompt = "",
  answer = "",
  answerSlot,
  value,
  defaultValue = "",
  onValueChange,
  onSubmit,
  onStop,
  expanded,
  defaultExpanded = false,
  onExpandedChange,
  placeholder = "Ask a question…",
  disabled = false,
  className = "",
  sourcesSlot,
}: BranchingReasoningChatInputProps) {
  const [draft, setDraft] = React.useState(defaultValue);
  const [localExpanded, setLocalExpanded] = React.useState(defaultExpanded);
  const [reduced, setReduced] = React.useState(true);
  const deck = React.useRef(null as HTMLDivElement | null);
  const shimmer = React.useRef(null as HTMLSpanElement | null);
  const positions = React.useRef({} as { [id: string]: CardPosition });
  const animations = React.useRef([] as Animation[]);
  const deckId = React.useId();
  const inputId = React.useId();
  const inputValue = value ?? draft;
  const busy = status === "branching" || status === "choosing" || status === "answering";
  const isExpanded = expanded ?? localExpanded;
  const chosen = branches.find((branch) => branch.chosen);
  const open = status === "branching" || !chosen || isExpanded;
  const otherCount = Math.max(0, branches.length - 1);
  const showBranches = status !== "idle" && branches.length > 0;
  const heading = chosen && status !== "branching"
    ? `Chose: ${chosen.title}`
    : status === "done" ? "Approaches considered"
    : branches.length > 0 ? `Considering ${branches.length} ${branches.length === 1 ? "approach" : "approaches"}` : "Finding a few ways forward";
  const layoutKey = `${showBranches}:${open}:${chosen?.id ?? ""}:${branches.map((branch) => branch.id).join("|")}`;
  const announcement = status === "idle" ? "Ready for a question."
    : status === "done" ? `Response complete. ${answer}`
    : status === "answering" ? `${chosen ? `Chose: ${chosen.title}. ` : ""}Writing a response.` : heading;

  React.useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  React.useEffect(() => {
    if (status === "idle" || status === "branching") setLocalExpanded(false);
  }, [status, prompt]);

  // FLIP: measure the final layout, invert to the previous geometry, then play.
  // Score/answer updates deliberately do not restart a running card transition.
  React.useLayoutEffect(() => {
    animations.current.forEach((animation) => animation.cancel());
    animations.current = [];
    const next: { [id: string]: CardPosition } = {};
    deck.current?.querySelectorAll("[data-branch]").forEach((element, index) => {
      const node = element as HTMLElement;
      const id = node.dataset.branch!;
      const to = {
        left: node.offsetLeft, top: node.offsetTop, width: node.offsetWidth, height: node.offsetHeight,
        angle: Number(node.dataset.angle), opacity: Number(node.style.opacity),
      };
      next[id] = to;
      const from = positions.current[id];
      if (reduced || typeof node.animate !== "function" || !to.width || !to.height) return;
      const start = from ? {
        transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) rotate(${from.angle}deg) scale(${from.width / to.width}, ${from.height / to.height})`,
        opacity: from.opacity,
      } : {
        transform: `translate(${(deck.current!.clientWidth - to.width) / 2 - to.left}px, 22px) rotate(0deg) scale(0.86)`,
        opacity: 0,
      };
      animations.current.push(node.animate([
        start,
        { transform: `translate(0px, 0px) rotate(${to.angle}deg) scale(1)`, opacity: to.opacity },
      ], { duration: MOVE_MS, delay: from ? 0 : index * 35, easing: EASING, fill: "backwards" }));
    });
    positions.current = next;
    return () => animations.current.forEach((animation) => animation.cancel());
  }, [layoutKey, reduced]);

  React.useEffect(() => {
    if (status !== "branching" || reduced || !shimmer.current) return;
    const animation = shimmer.current.animate([{ backgroundPosition: "100% 0" }, { backgroundPosition: "0% 0" }], {
      duration: 1600, iterations: Infinity, easing: "linear",
    });
    return () => animation.cancel();
  }, [status, reduced]);

  function changeValue(next: string) {
    if (value === undefined) setDraft(next);
    onValueChange?.(next);
  }

  function submit() {
    const message = inputValue.trim();
    if (!message || busy || disabled || !onSubmit) return;
    changeValue("");
    onSubmit(message);
  }

  return (
    <div ref={ref} data-slot="branching-reasoning-chat-input" data-state={status} data-reduced={reduced}
      className={`flex h-full min-h-0 w-full flex-col rounded-[26px] border border-border bg-card p-4 text-card-foreground shadow-xl shadow-primary/5 ${className}`}>
      <div data-transcript role="region" aria-label="Conversation" tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-xl px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {status === "idle" ? (
          <div data-empty className="flex h-full min-h-40 flex-col items-center justify-center pb-6 text-center">
            <svg viewBox="0 0 176 70" className="mb-5 h-[70px] w-44 text-muted-foreground" fill="none" aria-hidden="true">
              <path d="M88 6V22M28 57V42Q28 32 38 32H138Q148 32 148 42V57M88 32V57" stroke="currentColor" strokeWidth="1.5" />
              {[28, 88, 148].map((x) => <circle key={x} cx={x} cy="60" r="5" className="fill-card stroke-border" strokeWidth="2" />)}
              <circle cx="88" cy="7" r="6" className="fill-primary" />
            </svg>
            <p className="text-lg font-medium tracking-tight">One question. A few ways forward.</p>
            <p className="mt-2 max-w-72 text-xs leading-5 text-muted-foreground">Search official documentation, explore retrieval approaches, and ground every answer in verifiable evidence.</p>
          </div>
        ) : (
          <>
            {prompt && <p data-question className="mb-3 ml-auto w-fit max-w-[95%] rounded-2xl rounded-br-md bg-muted px-3 py-2 text-xs leading-5 [overflow-wrap:anywhere]">{prompt}</p>}
            <div data-assistant>
              <div className="flex min-h-5 items-center gap-2 text-xs">
                {chosen && status !== "branching" ? <Check className="size-3.5 shrink-0 text-primary" aria-hidden="true" /> : <GitFork className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                <span ref={shimmer} data-branch-heading className={`font-medium [overflow-wrap:anywhere] ${status === "branching" && !reduced ? "bg-[linear-gradient(100deg,var(--color-muted-foreground)_25%,var(--color-foreground)_50%,var(--color-muted-foreground)_75%)] bg-[length:240%_100%] bg-clip-text text-transparent" : "text-muted-foreground"}`}>{heading}</span>
              </div>
              <div ref={deck} id={deckId} data-branch-deck data-open={open} role="group" aria-label="Approaches"
                className="relative mx-1" style={{ height: showBranches ? (open ? 180 + Math.floor((branches.length - 1) / 3) * 158 : 104) : 24 }}>
                {showBranches && branches.map((branch, index) => {
                  const selected = branch.id === chosen?.id;
                  const folded = !open && !selected;
                  const count = branches.length;
                  const column = index % 3;
                  const row = Math.floor(index / 3);
                  const visibleColumns = Math.min(count, 3);
                  const angle = open ? (column - (visibleColumns - 1) / 2) * 4 : 0;
                  const score = boundedScore(branch.score);
                  const highlighted = selected && status !== "branching";
                  return (
                    <div key={branch.id} data-branch={branch.id} data-selected={selected} data-angle={angle}
                      aria-hidden={folded || undefined} {...(folded ? { inert: '' } : {})}
                      className={`absolute flex flex-col rounded-xl border p-2.5 shadow-md shadow-primary/5 ${highlighted ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-card-foreground"}`}
                      style={{
                        left: open ? `${2 + column * (96 / visibleColumns)}%` : "8%",
                        top: open ? 20 + Math.abs(angle) * 1.2 + row * 158 : 8,
                        width: open ? `${96 / visibleColumns - 2}%` : "84%",
                        height: open ? 144 : 88,
                        transform: `rotate(${angle}deg)`, transformOrigin: "top left",
                        opacity: folded ? 0 : 1, zIndex: selected ? 4 : index + 1,
                        pointerEvents: folded ? "none" : "auto",
                      }}>
                      <div className={`mb-2 flex items-center justify-between text-[9px] font-medium uppercase tracking-[0.12em] ${highlighted ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                        <span>{highlighted ? "Selected approach" : `Approach 0${index + 1}`}</span>
                        {highlighted && <Check className="size-3" aria-hidden="true" />}
                      </div>
                      <p className={`font-medium leading-[1.3] [overflow-wrap:anywhere] ${open ? "text-[12px]" : "text-sm"}`}>{branch.title}</p>
                      {open && <p className={`mt-1.5 text-[10px] leading-[1.4] [overflow-wrap:anywhere] ${highlighted ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{branch.note}</p>}
                      <div className="mt-auto flex items-center gap-2 pt-2">
                        <div role="progressbar" aria-label={`${branch.title} score`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={score}
                          className={`h-1 flex-1 overflow-hidden rounded-full ${highlighted ? "bg-primary-foreground/20" : "bg-muted"}`}>
                          <div data-score-fill className={`h-full rounded-full ${highlighted ? "bg-primary-foreground" : "bg-primary"}`}
                            style={{ width: `${score ?? 0}%`, transition: reduced ? "none" : "width 180ms linear" }} />
                        </div>
                        <span data-score-label className="w-5 text-right font-mono text-[10px] tabular-nums">{score === undefined ? "—" : Math.round(score)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {chosen && status !== "branching" && otherCount > 0 && (
                <button type="button" data-approaches-toggle aria-expanded={isExpanded} aria-controls={deckId} disabled={disabled}
                  onClick={() => { if (expanded === undefined) setLocalExpanded(!isExpanded); onExpandedChange?.(!isExpanded); }}
                  className="flex min-h-6 items-center gap-1.5 rounded-md px-1 text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">
                  <ChevronDown className={`size-3 transition-transform motion-reduce:transition-none ${isExpanded ? "rotate-180" : ""}`} aria-hidden="true" />
                  {isExpanded ? "Hide" : otherCount} {isExpanded ? "other approaches" : `other ${otherCount === 1 ? "approach" : "approaches"}`}
                </button>
              )}
              {(status === "answering" || status === "done") && (
                <div data-answer role="region" aria-label="Response" aria-live="off" className="mt-2 text-[13px] leading-[1.55] [overflow-wrap:anywhere]">
                  {answerSlot ? answerSlot : (
                    <div className="whitespace-pre-wrap">
                      {answer}
                      {status === "answering" && <span data-stream-cursor aria-hidden="true" className="ml-1 inline-block h-3 w-1 translate-y-0.5 rounded-full bg-primary motion-safe:animate-pulse" />}
                    </div>
                  )}
                  {sourcesSlot}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <form data-composer onSubmit={(event) => { event.preventDefault(); submit(); }}
        className="mt-3 shrink-0 rounded-2xl border border-border bg-background p-2.5 focus-within:border-ring">
        <label htmlFor={inputId} className="sr-only">Your question</label>
        <textarea id={inputId} value={inputValue} placeholder={placeholder} disabled={disabled} rows={1}
          onChange={(event) => changeValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
              event.preventDefault(); submit();
            }
          }}
          className="block h-9 w-full resize-none rounded-lg bg-transparent px-1 py-1.5 text-[13px] leading-5 outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40" />
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 pl-1 text-[10px] text-muted-foreground"><GitFork className="size-3" aria-hidden="true" /> Explore approaches</span>
          <button type={busy ? "button" : "submit"} aria-label={busy ? "Stop" : "Send question"} data-action={busy ? "stop" : "send"}
            disabled={disabled || (busy ? !onStop : !inputValue.trim() || !onSubmit)}
            onClick={busy ? (event) => { event.preventDefault(); onStop?.(); } : undefined}
            className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-30">
            {busy ? <Square className="size-3 fill-current" aria-hidden="true" /> : <ArrowUp className="size-4" aria-hidden="true" />}
          </button>
        </div>
      </form>
      <p role="status" aria-live="polite" aria-atomic="true" data-announcement className="sr-only">{announcement}</p>
    </div>
  );
}

export default BranchingReasoningChatInput;
