import React, { useEffect, useState } from "react";
import { Button } from "./common";
import type { AgentQuestion, PluginField, PluginQuestionAnswer, QuestionAnswer } from "../lib/types";

function PluginQuestionCard({ agent, question, openTerminal, onError }: { agent: string; question: AgentQuestion; openTerminal: () => void; onError: (text: string) => void }) {
  const fields: PluginField[] = question.fields || [];
  const [values, setValues] = useState<Record<number, string | boolean>>(() => Object.fromEntries(fields.map((f, i) => [i, f.value])));
  const [sending, setSending] = useState(false);
  useEffect(() => { setValues(Object.fromEntries((question.fields || []).map((f, i) => [i, f.value]))); setSending(false); }, [question.id]);
  const send = async (action: "accept" | "decline") => {
    if (sending) return;
    setSending(true);
    const payload: PluginQuestionAnswer = action === "decline" ? { action } : { action, ...(question.parseable ? { values } : {}) };
    try { await window.army.questions.answer(agent, payload); }
    catch (e) { setSending(false); onError(String(e).replace(/^Error:\s*(Error invoking remote method '[^']+':\s*)?(Error:\s*)?/, "")); }
  };
  const missingRequired = !!question.parseable && fields.some((f, i) => f.required && f.kind !== "boolean" && !String(values[i] ?? "").trim());
  return (
    <section className="question-card" aria-label={`${agent} plugin question`}>
      <p className="question-from"><b>{agent}</b> · {question.title || "Plugin requests your input"}</p>
      {question.message && <p className="question-hint">{question.message}</p>}
      {question.parseable ? (
        <div className="question-options">
          {fields.map((f, i) => (
            <label key={i} className="question" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="question-label"><b>{f.label}{f.required ? " *" : ""}</b>{f.description && <small>{f.description}</small>}</span>
              {f.kind === "boolean" ? (
                <button type="button" className={"question-option" + (values[i] ? " on" : "")} role="checkbox" aria-checked={!!values[i]} disabled={sending}
                  onClick={() => setValues(v => ({ ...v, [i]: !v[i] }))}>
                  <span className="question-key" aria-hidden="true">{values[i] ? "×" : " "}</span>
                  <span className="question-label"><b>{values[i] ? "Yes" : "No"}</b></span>
                </button>
              ) : (
                <input className="question-other" type={f.kind === "number" ? "number" : "text"} disabled={sending}
                  placeholder={f.required ? "Required" : "Optional"} value={String(values[i] ?? "")}
                  onChange={e => setValues(v => ({ ...v, [i]: e.target.value }))} />
              )}
            </label>
          ))}
        </div>
      ) : (
        <p className="question-hint">{question.totalFields ? `${question.totalFields} fields — fill them in the terminal, or Accept defaults / Decline here.` : "Fill in the terminal, or Accept / Decline here."}</p>
      )}
      <div className="question-foot">
        <Button className="ghost" onClick={openTerminal}>Answer in terminal</Button>
        <Button className="ghost" disabled={sending} onClick={() => void send("decline")}>Decline</Button>
        <Button className="primary" disabled={sending || missingRequired} onClick={() => void send("accept")}>{sending ? "Sending…" : "Accept"}</Button>
      </div>
    </section>
  );
}

/** A menu in the agent's terminal (run this command? read this file?) with the CLI's own choices: a click picks one. */
function MenuCard({ agent, question, openTerminal, onError }: { agent: string; question: AgentQuestion; openTerminal: () => void; onError: (text: string) => void }) {
  const [sent, setSent] = useState("");
  useEffect(() => setSent(""), [question.id]);
  const pick = async (label: string) => {
    if (sent) return; setSent(label);
    try { await window.army.questions.answer(agent, { label }); }
    catch (e) { setSent(""); onError(String(e).replace(/^Error:\s*(Error invoking remote method '[^']+':\s*)?(Error:\s*)?/, "")); }
  };
  return (
    <section className="question-card" aria-label={`${agent} waits for approval`}>
      <p className="question-from"><b>{agent}</b> is waiting for you{question.title ? ` · ${question.title}` : ""}</p>
      {question.message && <pre className="question-body">{question.message}</pre>}
      <div className="question">
        {question.question && <p className="question-ask">{question.question}</p>}
        <div className="question-options">
          {(question.options || []).map((label, i) => <button type="button" key={i} className={"question-option" + (sent === label ? " on" : "")} disabled={!!sent} onClick={() => void pick(label)}>
            <span className="question-key" aria-hidden="true">{i + 1}</span><span className="question-label"><b>{label}</b></span>
          </button>)}
        </div>
      </div>
      <div className="question-foot"><Button className="ghost" onClick={openTerminal}>Answer in terminal</Button></div>
    </section>
  );
}

/** A question an agent asked with Claude's AskUserQuestion, answerable from the chat instead of its terminal. */
export function QuestionCard({ agent, question, openTerminal, onError }: { agent: string; question: AgentQuestion; openTerminal: () => void; onError: (text: string) => void }) {
  if (question.kind === "menu") return <MenuCard agent={agent} question={question} openTerminal={openTerminal} onError={onError} />;
  if (question.kind === "plugin") return <PluginQuestionCard agent={agent} question={question} openTerminal={openTerminal} onError={onError} />;
  const qs = question.questions || [];
  const [answers, setAnswers] = useState<QuestionAnswer[]>(() => qs.map(() => ({ picks: [] })));
  const [sending, setSending] = useState(false);
  useEffect(() => { setAnswers((question.questions || []).map(() => ({ picks: [] }))); setSending(false); }, [question.id]);
  // One question with one choice: a click answers it, like in the terminal.
  const instant = qs.length === 1 && !qs[0].multiSelect;
  const submit = async (list = answers) => {
    if (sending) return;
    setSending(true);
    try { await window.army.questions.answer(agent, list); }
    catch (e) { setSending(false); onError(String(e).replace(/^Error:\s*(Error invoking remote method '[^']+':\s*)?(Error:\s*)?/, "")); }
  };
  const pick = (qi: number, oi: number) => {
    const q = qs[qi];
    const next = answers.map((a, i) => i !== qi ? a : q.multiSelect ? { ...a, picks: a.picks.includes(oi) ? a.picks.filter(p => p !== oi) : [...a.picks, oi].sort() } : { picks: [oi], other: "" });
    setAnswers(next);
    if (instant) void submit(next);
  };
  const setOther = (qi: number, other: string) => setAnswers(v => v.map((a, i) => i !== qi ? a : { picks: qs[qi].multiSelect ? a.picks : [], other }));
  const ready = answers.every(a => a.picks.length || (a.other || "").trim());
  return (
    <section className="question-card" aria-label={`${agent} asks you`}>
      <p className="question-from"><b>{agent}</b> is waiting for your answer</p>
      {qs.map((q, qi) => (
        <fieldset className="question" key={qi} disabled={sending}>
          <legend>{q.header && qs.length > 1 && <small>{q.header}</small>}{q.question}</legend>
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
