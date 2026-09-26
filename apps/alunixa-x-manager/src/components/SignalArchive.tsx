import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Radio, RotateCcw, Satellite, X } from "lucide-react";

import { getLanguage } from "@/i18n";
import {
  SIGNAL_ARCHIVE_NODES,
  SIGNAL_ARCHIVE_UI,
  availableSignalArchiveChoices,
  chooseSignalArchivePath,
  createSignalArchiveState,
  localizeLine,
  normalizeSignalArchiveProgress,
  recordSignalArchiveEnding,
  type SignalArchiveEnding,
  type SignalArchiveLocale,
  type SignalArchiveProgress,
} from "@/signal-archive";

const PROGRESS_KEY = "alunixa-x-surface-memory-v1";

type Props = {
  onClose: () => void;
};

function loadProgress(): SignalArchiveProgress {
  try {
    return normalizeSignalArchiveProgress(JSON.parse(window.localStorage.getItem(PROGRESS_KEY) ?? "null"));
  } catch {
    return { endings: [], visits: 0 };
  }
}

function saveProgress(progress: SignalArchiveProgress) {
  try {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // The story remains fully playable when storage is unavailable.
  }
}

export default function SignalArchive({ onClose }: Props) {
  const locale = getLanguage() as SignalArchiveLocale;
  const [story, setStory] = useState(createSignalArchiveState);
  const [progress, setProgress] = useState<SignalArchiveProgress>(() => {
    const stored = loadProgress();
    const next = { ...stored, visits: stored.visits + 1 };
    saveProgress(next);
    return next;
  });
  const [visibleCharacters, setVisibleCharacters] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const typingTimerRef = useRef<number | null>(null);
  const transitionTimerRef = useRef<number | null>(null);

  const node = SIGNAL_ARCHIVE_NODES[story.nodeId];
  const fullText = localizeLine(node.text, locale);
  const reducedMotion = useMemo(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
    [],
  );
  const typing = visibleCharacters < fullText.length;
  const choices = availableSignalArchiveChoices(story);
  const integrity = Math.min(100, 18 + story.trail.length * 9 + story.flags.length * 4);

  const close = useCallback(() => {
    if (typingTimerRef.current !== null) window.clearInterval(typingTimerRef.current);
    if (transitionTimerRef.current !== null) window.clearTimeout(transitionTimerRef.current);
    onClose();
  }, [onClose]);

  const revealAll = useCallback(() => {
    if (typingTimerRef.current !== null) {
      window.clearInterval(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    setVisibleCharacters(fullText.length);
  }, [fullText.length]);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close]);

  useEffect(() => {
    if (typingTimerRef.current !== null) window.clearInterval(typingTimerRef.current);
    setVisibleCharacters(reducedMotion ? fullText.length : 0);
    if (reducedMotion) return;
    let index = 0;
    typingTimerRef.current = window.setInterval(() => {
      index = Math.min(fullText.length, index + (index % 7 === 0 ? 2 : 1));
      setVisibleCharacters(index);
      if (index >= fullText.length && typingTimerRef.current !== null) {
        window.clearInterval(typingTimerRef.current);
        typingTimerRef.current = null;
      }
    }, 18);
    return () => {
      if (typingTimerRef.current !== null) {
        window.clearInterval(typingTimerRef.current);
        typingTimerRef.current = null;
      }
    };
  }, [fullText, reducedMotion]);

  useEffect(() => {
    if (!node.ending || progress.endings.includes(node.ending)) return;
    const next = recordSignalArchiveEnding(progress, node.ending);
    setProgress(next);
    saveProgress(next);
  }, [node.ending, progress]);

  useEffect(() => () => {
    if (typingTimerRef.current !== null) window.clearInterval(typingTimerRef.current);
    if (transitionTimerRef.current !== null) window.clearTimeout(transitionTimerRef.current);
  }, []);

  const selectChoice = (choiceId: string) => {
    if (transitioning) return;
    if (typing) {
      revealAll();
      return;
    }
    setTransitioning(true);
    transitionTimerRef.current = window.setTimeout(() => {
      setStory((current) => chooseSignalArchivePath(current, choiceId));
      setTransitioning(false);
      transitionTimerRef.current = null;
    }, reducedMotion ? 0 : 220);
  };

  const restart = () => {
    setTransitioning(true);
    transitionTimerRef.current = window.setTimeout(() => {
      setStory(createSignalArchiveState());
      setTransitioning(false);
      transitionTimerRef.current = null;
    }, reducedMotion ? 0 : 260);
  };

  const endingLabel = (ending: SignalArchiveEnding) => localizeLine(SIGNAL_ARCHIVE_UI.endingLabels[ending], locale);

  return (
    <div
      className="signal-archive-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) close();
      }}
      role="presentation"
    >
      <section
        aria-label={localizeLine(SIGNAL_ARCHIVE_UI.station, locale)}
        aria-modal="true"
        className={`signal-archive ${transitioning ? "is-transitioning" : ""} ${node.ending ? "is-ending" : ""}`}
        role="dialog"
      >
        <div aria-hidden="true" className="signal-archive-sky">
          <i /><i /><i />
        </div>

        <header className="signal-archive-header">
          <div className="signal-archive-station">
            <span className="signal-archive-beacon"><Satellite /></span>
            <div>
              <strong>{localizeLine(SIGNAL_ARCHIVE_UI.station, locale)}</strong>
              <small><span />{localizeLine(SIGNAL_ARCHIVE_UI.status, locale)} · 04:17</small>
            </div>
          </div>
          <button
            aria-label={localizeLine(SIGNAL_ARCHIVE_UI.close, locale)}
            className="signal-archive-close"
            onClick={close}
            ref={closeButtonRef}
            title={localizeLine(SIGNAL_ARCHIVE_UI.close, locale)}
            type="button"
          >
            <X />
          </button>
        </header>

        <div className="signal-archive-layout">
          <aside className="signal-archive-telemetry" aria-label={localizeLine(SIGNAL_ARCHIVE_UI.route, locale)}>
            <div className="signal-archive-meter">
              <div><span>{localizeLine(SIGNAL_ARCHIVE_UI.signal, locale)}</span><strong>{integrity}%</strong></div>
              <b><i style={{ width: `${integrity}%` }} /></b>
            </div>
            <div className="signal-archive-readout">
              <span>{localizeLine(SIGNAL_ARCHIVE_UI.memory, locale)}</span>
              <strong>{String(story.flags.length).padStart(2, "0")}</strong>
            </div>
            <div className="signal-archive-route">
              <span>{localizeLine(SIGNAL_ARCHIVE_UI.route, locale)}</span>
              <ol>
                {story.trail.slice(-6).map((step, index) => (
                  <li className={index === Math.min(5, story.trail.length - 1) ? "active" : ""} key={`${step}-${index}`}>
                    <i /> <span>{String(Math.max(1, story.trail.length - 5 + index)).padStart(2, "0")}</span>
                  </li>
                ))}
              </ol>
            </div>
          </aside>

          <main className="signal-archive-scene">
            <div className="signal-archive-chapter">{localizeLine(node.chapter, locale)}</div>
            <h2>{localizeLine(node.title, locale)}</h2>
            <div className="signal-archive-speaker"><Radio />{localizeLine(node.speaker, locale)}</div>
            <div aria-live="polite" className="signal-archive-copy">
              {fullText.slice(0, visibleCharacters)}
              {typing ? <span aria-hidden="true" className="signal-archive-caret" /> : null}
            </div>

            {typing ? (
              <button className="signal-archive-skip" onClick={revealAll} type="button">
                {localizeLine(SIGNAL_ARCHIVE_UI.skip, locale)}
              </button>
            ) : node.ending ? (
              <div className="signal-archive-ending-actions">
                <div className={`signal-archive-ending-mark ending-${node.ending}`}>
                  {endingLabel(node.ending)}
                </div>
                <button onClick={restart} type="button"><RotateCcw />{localizeLine(SIGNAL_ARCHIVE_UI.replay, locale)}</button>
                <button onClick={close} type="button"><ChevronRight />{localizeLine(SIGNAL_ARCHIVE_UI.return, locale)}</button>
              </div>
            ) : (
              <div className="signal-archive-choices">
                {choices.map((choice, index) => (
                  <button
                    className={`tone-${choice.tone ?? "quiet"}`}
                    key={choice.id}
                    onClick={() => selectChoice(choice.id)}
                    type="button"
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{localizeLine(choice.label, locale)}</strong>
                    <ChevronRight />
                  </button>
                ))}
              </div>
            )}
          </main>

          <aside className="signal-archive-endings">
            <span>{localizeLine(SIGNAL_ARCHIVE_UI.endings, locale)}</span>
            {progress.endings.length ? (
              <div>
                {progress.endings.map((ending) => <b className={`ending-${ending}`} key={ending}>{endingLabel(ending)}</b>)}
              </div>
            ) : <small>{localizeLine(SIGNAL_ARCHIVE_UI.noEndings, locale)}</small>}
            <p>{localizeLine(SIGNAL_ARCHIVE_UI.help, locale)}</p>
          </aside>
        </div>
      </section>
    </div>
  );
}
