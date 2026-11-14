import React, { useEffect, useState } from "react";
import { Button } from "./common";
import type { AgentQuestion, QuestionAnswer } from "../lib/types";

/** A question an agent asked with Claude's AskUserQuestion, answerable from the chat instead of its terminal. */
export function QuestionCard({ agent, question, openTerminal, onError }: { agent: string; question: AgentQuestion; openTerminal: () => void; onError: (text: string) => void }) {
  const [answers, setAnswers] = useState<QuestionAnswer[]>(() => question.questions.map(() => ({ picks: [] })));
  const [sending, setSending] = useState(false);
  useEffect(() => { setAnswers(question.questions.map(() => ({ picks: [] }))); setSending(false); }, [question.id]);
  // One question with one choice: a click answers it, like in the terminal.
  const instant = question.questions.length === 1 && !question.questions[0].multiSelect;
  const submit = async (list = answers) => {
    if (sending) return;
    setSending(true);
    try { await window.army.questions.answer(agent, list); }
    catch (e) { setSending(false); onError(String(e).replace(/^Error:\s*(Error invoking remote method '[^']+':\s*)?(Error:\s*)?/, "")); }
  };
  const pick = (qi: number, oi: number) => {
    const q = question.questions[qi];
    const next = answers.map((a, i) => i !== qi ? a : q.multiSelect ? { ...a, picks: a.picks.includes(oi) ? a.picks.filter(p => p !== oi) : [...a.picks, oi].sort() } : { picks: [oi], other: "" });
    setAnswers(next);
    if (instant) void submit(next);
  };
  const setOther = (qi: number, other: string) => setAnswers(v => v.map((a, i) => i !== qi ? a : { picks: question.questions[qi].multiSelect ? a.picks : [], other }));
  const ready = answers.every(a => a.picks.length || (a.other || "").trim());
  return (
    <section className="question-card" aria-label={`${agent} asks you`}>
      <p className="question-from"><b>{agent}</b> is waiting for your answer</p>
      {question.questions.map((q, qi) => (
        <fieldset className="question" key={qi} disabled={sending}>
          <legend>{q.header && question.questions.length > 1 && <small>{q.header}</small>}{q.question}</legend>
          {q.multiSelect && <p className="question-hint">Pick one or more</p>}
          <div className="question-options">
            {q.options.map((o, oi) => {
              const on = answers[qi]?.picks.includes(oi);
              return <button type="button" key={oi} className={"question-option" + (on ? " on" : "")} role={q.multiSelect ? "checkbox" : "radio"} aria-checked={!!on} onClick={() => pick(qi, oi)}>
                <span className="question-key" aria-hidden="true">{oi + 1}</span>
                <span className="question-label"><b>{o.label}</b>{o.description && <small>{o.description}</small>}</span>
              </button>;
            })}
            <input className="question-other" type="text" placeholder="Or write your own answer" aria-label={`Own answer: ${q.question}`} value={answers[qi]?.other || ""}
              onChange={e => setOther(qi, e.target.value)} onKeyDown={e => { if (e.key === "Enter" && ready) { e.preventDefault(); void submit(); } }} />
          </div>
        </fieldset>
      ))}
      <div className="question-foot">
        <Button className="ghost" onClick={openTerminal}>Answer in terminal</Button>
        {(!instant || answers[0]?.other) && <Button className="primary" disabled={!ready || sending} onClick={() => void submit()}>{sending ? "Sending…" : "Send answer"}</Button>}
        {instant && !answers[0]?.other && sending && <span className="question-hint">Sending…</span>}
      </div>
    </section>
  );
}
