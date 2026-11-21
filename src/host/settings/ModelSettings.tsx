// "AI model": the router, model and key Mosaic's agent runs on. Profiles are byok.js's (this
// browser only). The key field is uncontrolled and cleared after each save, so the key is never
// rendered back into the page, the URL or a recipe.
import * as Dialog from "@radix-ui/react-dialog";
import { CpuIcon, InfoIcon, TrashIcon, WarningIcon, XIcon } from "@phosphor-icons/react";
import { useRef, useState, type FormEvent } from "react";
import { DEFAULT_MODEL, OTARI_ROUTER } from "../agentic/network";
import { NO_KEY_MESSAGE, routerHostOf } from "../agentic/engine";
import { ROUTER_PRESETS, type RouterPreset } from "../agentic/routers";
import { Banner, Button, Tag } from "../primitives";
import { useAgentEngine } from "./engine-context";

const OTARI_SIGNUP = "https://otari.ai";

/** The top-bar button. Shows which mode Mosaic is in at a glance. */
export function ModelSettingsButton() {
  const [open, setOpen] = useState(false);
  const { mode } = useAgentEngine();
  return (
    <>
      <Button variant="tertiary" size="sm" icon={<CpuIcon />} className={`model-button ${mode}`} onClick={() => setOpen(true)} aria-haspopup="dialog">
        AI model
      </Button>
      <ModelSettings open={open} onOpenChange={setOpen} />
    </>
  );
}

export function ModelSettings({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="palette-overlay" />
        <Dialog.Content className="settings" aria-describedby={undefined}>
          <header className="settings-head">
            <Dialog.Title className="settings-title">AI model</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="tertiary" size="sm" icon={<XIcon />} aria-label="Close" />
            </Dialog.Close>
          </header>
          <SettingsBody />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SettingsBody() {
  const engine = useAgentEngine();
  const { store, mode } = engine;
  const keyRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [router, setRouter] = useState(OTARI_ROUTER);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [preset, setPreset] = useState<RouterPreset>(ROUTER_PRESETS[0]!);
  const [problem, setProblem] = useState<string | null>(null);
  const [check, setCheck] = useState<{ state: "running" | "ok" | "error"; text: string } | null>(null);
  const selected = store?.profiles.find((p) => p.id === store.selectedId) ?? null;
  const routerHost = routerHostOf({ router: router.trim() });

  const choose = (p: RouterPreset) => {
    setPreset(p);
    setRouter(p.router);
    setModel(p.model);
    setName(p.name);
    setProblem(null);
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    const key = keyRef.current?.value.trim() ?? "";
    let url: URL;
    try {
      url = new URL(router.trim());
    } catch {
      setProblem("Enter the router's full base URL, like https://api.otari.ai/api/v1.");
      return;
    }
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      setProblem("Use an https:// router, so your key is never sent in the clear.");
      return;
    }
    if (!key) {
      setProblem("Paste your key. Without one, Mosaic plans steps without a model.");
      return;
    }
    if (!model.trim()) {
      setProblem("Enter a model your router supports.");
      return;
    }
    setProblem(null);
    setCheck(null);
    engine.saveProfile({ name: name.trim() || undefined, router: url.href.replace(/\/$/, ""), model: model.trim(), key });
    if (keyRef.current) keyRef.current.value = "";
    setName("");
  };

  const testModel = async () => {
    if (!engine.agent || engine.agent.mode !== "model") return;
    setCheck({ state: "running", text: "Asking the model…" });
    let text = "";
    try {
      for await (const ev of engine.agent.runTurn("Reply with one short sentence so I know you can read this. Do not call any tools.")) {
        if (ev.type === "turn.completed") text = ev.result?.text ?? text;
        if (ev.type === "turn.failed") throw new Error(ev.error ?? "The turn failed.");
      }
      engine.agent.engine.history.length = 0;
      setCheck({ state: "ok", text: text.trim() || "The model answered with no text." });
    } catch (err) {
      setCheck({ state: "error", text: (err as Error).message });
    }
  };

  return (
    <div className="settings-body">
      {mode === "manual" ? (
        <Banner tone="info" icon={<InfoIcon />} className="settings-mode" data-mode="manual">
          <b>{NO_KEY_MESSAGE}.</b> Add a key from your own router to let the agent plan and run steps across your sites.{" "}
          <a href={OTARI_SIGNUP} target="_blank" rel="noreferrer noopener">
            Get an Otari key
          </a>
        </Banner>
      ) : (
        <Banner tone="success" icon={<CpuIcon />} className="settings-mode" data-mode="model">
          Using <b>{selected?.name}</b>: {selected?.model || "the network's model"} at <code>{engine.routerHost}</code>.
        </Banner>
      )}

      {!!store?.profiles.length && (
        <section aria-labelledby="profiles-label">
          <h3 id="profiles-label" className="label">
            Saved in this browser
          </h3>
          <ul className="profiles">
            {store.profiles.map((p) => {
              const on = p.id === store.selectedId;
              return (
                <li key={p.id} className={`profile ${on ? "on" : ""}`} data-profile={p.name}>
                  <div className="profile-text">
                    <span className="profile-name">{p.name}</span>
                    <span className="profile-meta">
                      {p.model || "network model"} · <code>{routerHostOf(p)}</code> · {p.key ? "key saved" : "no key"}
                    </span>
                  </div>
                  {on ? (
                    <Tag tone="success">In use</Tag>
                  ) : (
                    <Button size="xs" variant="secondary" onClick={() => engine.selectProfile(p.id)}>
                      Use
                    </Button>
                  )}
                  <Button size="xs" variant="tertiary" icon={<TrashIcon />} aria-label={`Delete ${p.name}`} onClick={() => engine.deleteProfile(p.id)} />
                </li>
              );
            })}
          </ul>
          {mode === "model" && (
            <div className="settings-check">
              <Button size="sm" variant="secondary" onClick={testModel} disabledReason={engine.status !== "ready" ? "The agent is still loading." : check?.state === "running" ? "Waiting for the model." : null}>
                Test model
              </Button>
              {check && (
                <p className={`check-line ${check.state}`} role="status">
                  {check.state === "error" && <WarningIcon />}
                  {check.text}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      <form className="settings-form" onSubmit={save} autoComplete="off">
        <h3 className="label">Add a model</h3>
        <div className="settings-presets" role="group" aria-label="Router">
          {ROUTER_PRESETS.map((p) => (
            <Button key={p.id} type="button" size="xs" variant={p.id === preset.id ? "primary" : "secondary"} aria-pressed={p.id === preset.id} data-preset={p.id} onClick={() => choose(p)}>
              {p.label}
            </Button>
          ))}
        </div>
        <p className="settings-note" data-testid="preset-note">
          {preset.note}
        </p>
        <label className="field">
          <span>Router base URL</span>
          <input className="settings-input mono" value={router} onChange={(e) => setRouter(e.target.value)} spellCheck={false} inputMode="url" />
        </label>
        <label className="field">
          <span>Model</span>
          <input className="settings-input mono" value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} />
        </label>
        <label className="field">
          <span>Key</span>
          <input ref={keyRef} className="settings-input mono" type="password" name="router-key" placeholder={preset.keyHint} autoComplete="off" spellCheck={false} />
        </label>
        <label className="field">
          <span>Name (optional)</span>
          <input className="settings-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={preset.name} />
        </label>
        <p className="settings-note" data-testid="key-note">
          Your key is sent only to {routerHost}. Mosaic and the sites you connect never see it.
        </p>
        {problem && (
          <p className="check-line error" role="alert">
            <WarningIcon />
            {problem}
          </p>
        )}
        <div className="settings-actions">
          <Button type="submit" variant="primary">
            Save and use
          </Button>
        </div>
      </form>
      {engine.status === "error" && engine.error && (
        <Banner tone="danger" icon={<WarningIcon />}>
          {engine.error}
        </Banner>
      )}
    </div>
  );
}
