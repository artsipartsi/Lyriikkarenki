import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Lyriikkarenki – v0.25 (Help-overlay + auto-scroll Ehdotukset + MET/SYN/RHY always on)
 */

export default function App() {
  // --- UI ---
  const [showSettings, setShowSettings] = useState(() => {
    const saved = localStorage.getItem("lr_showSettings");
    return saved ? saved === "true" : true;
  });
  const [showHelp, setShowHelp] = useState(false); // käyttöohje-ikkuna

  // --- Kehittäjätila (backdoor) ---
  const qs = new URLSearchParams(window.location.search);
  const devModeQS = qs.get("dev");
  const [devMode, setDevMode] = useState(() => {
    const saved = localStorage.getItem("lr_devMode");
    if (devModeQS === "1") return true;
    if (devModeQS === "0") return false;
    return saved ? saved === "true" : false;
  });
  useEffect(() => localStorage.setItem("lr_devMode", String(devMode)), [devMode]);

  // --- Pane-korkeudet ---
  const [paneAreaHeight, setPaneAreaHeight] = useState(420);
  const [leftPaneHeight, setLeftPaneHeight] = useState(420);
  const [rightPaneHeight, setRightPaneHeight] = useState(420);

  const recalcPaneHeight = () => {
    const vh = window.innerHeight || 0;
    const hdr = document.getElementById("hdr")?.offsetHeight || 0;
    const set = document.getElementById("settings")?.offsetHeight || 0;
    const tlb = document.getElementById("toolbar")?.offsetHeight || 0;
    const ftr = document.getElementById("footer")?.offsetHeight || 0;

    // iOS Safari random padding fix
    const body = document.body;
    const html = document.documentElement;
    const height = Math.max(
      body.scrollHeight,
      body.offsetHeight,
      html.clientHeight,
      html.scrollHeight,
      html.offsetHeight
    );

    const chrome = 32 + 12 + 8;
    const available = Math.max(0, Math.floor(vh - hdr - set - tlb - ftr - chrome));
    setPaneAreaHeight(available);
  };

  // --- Autohaku ---
  const typingTimerRef = useRef(null);
  const AUTO_DELAY_MS = 2300; // ~2–3 s tauko
  const [lastAutoSig, setLastAutoSig] = useState("");
  // Muistaa viimeisimmän taukoautohakua vastaavan rivin
  const lastPauseRef = useRef({ line: "", at: 0 });


  useEffect(() => {
    recalcPaneHeight();
    const onResize = () => recalcPaneHeight();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // --- Valinnat (persist) ---
  // Kielikuvat, synonyymit ja riimit ovat tästä versiosta alkaen AINA päällä → ei checkboxeja
  const [wildness, setWildness] = useState(() => {
    const s = localStorage.getItem("lr_wildness");
    return s ? Number(s) : 0.7;
  });
  const [freeform, setFreeform] = useState(() => localStorage.getItem("lr_freeform") || "");

  useEffect(() => localStorage.setItem("lr_showSettings", String(showSettings)), [showSettings]);
  useEffect(() => localStorage.setItem("lr_wildness", String(wildness)), [wildness]);
  useEffect(() => localStorage.setItem("lr_freeform", freeform), [freeform]);

  // --- Tekstit ---
  const [authorText, setAuthorText] = useState("");
  const [renkiText, setRenkiText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // --- Ohjaimet / refit ---
  const authorRef = useRef(null);
  const renkiRef = useRef(null);

  // --- Valinnan apurit ---
  const [selTick, setSelTick] = useState(0);
  const bumpSel = () => setSelTick((n) => n + 1);

  const getSelectionOrCurrentLine = () => {
    const el = authorRef.current;
    if (!el) return "";
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    if (start !== end) return authorText.slice(start, end);
    return getLineAt(authorText, end);
  };

  // Palauta valinnan teksti tai tyhjä
  const getSelectedText = () => {
    const el = authorRef.current;
    if (!el) return "";
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    return start !== end ? authorText.slice(start, end) : "";
  };

  // Onko valintaa?
  const hasSelection = () => {
    const el = authorRef.current;
    if (!el) return false;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    return start !== end;
  };

  // --- Promptit ---
  const [promptPreview, setPromptPreview] = useState("");
  const [lastPromptBasis, setLastPromptBasis] = useState("");

  useEffect(() => {
    if (!devMode) return;
    const p = buildPromptSmart(getCurrentLineText());
    setPromptPreview(p);
  }, [devMode, authorText, wildness, freeform, selTick]);

  const getCurrentLineText = () => getSelectionOrCurrentLine();

  const wordCount = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);
  const lastWord = (s) => (s.trim() ? s.trim().split(/\s+/).pop() : "");

  const buildPromptSmart = (line) => {
    const txt = line ?? "";
    const wc = wordCount(txt.trim());
    const lw = lastWord(txt.trim());
    let p = `Teksti analysoitavaksi:\n"${txt}"\n\n`;
    if (wc >= 1 && lw) {
      p += `Anna synonyymejä ja riimiehdotuksia viimeiselle sanalle: "${lw}".\n`;
    }
    if (wc >= 2) {
      p += `Keksi myös 2–4 tuoretta kielikuvaa koko rivistä.\n`;
    }
    p += `\nTyyli: suomeksi, luova mutta käyttökelpoinen.\n`;
    p += `Skaalaa lennokkuutta asteikolla 0–1: ${wildness.toFixed(2)}.\n`;
    if (freeform.trim()) p += `\nLisäohje: ${freeform.trim()}\n`;
    return p;
  };

  const buildPromptSelected = (sel) => {
    let p = `Keksi synonyymejä, riimiehdotuksia ja kielikuvia valitusta tekstistä:\n"${sel}"\n`;
    if (freeform.trim()) p += `\nLisäohje: ${freeform.trim()}\n`;
    return p;
  };

  const askSuggestions = async () => {
    const sel = getSelectedText();
    if (!sel) {
      setError("Valitse teksti, josta haluat ehdotuksia.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const prompt = buildPromptSelected(sel);
      setLastPromptBasis(sel);
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, temperature: 1.0 }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setRenkiText((t) => `${t}${t && !t.endsWith("\n") ? "\n" : ""}${data.text || "(tyhjä vastaus)"}\n`);
    } catch (e) {
      setError(`Ehdotusten haku epäonnistui: ${e.message}`);
    } finally {
      setLoading(false);
      if (devMode) setPromptPreview(buildPromptSelected(getSelectedText()));
    }
  };

  const askSmartSuggestions = async (line, reason = "auto") => {
    const sig = `${reason}|${line.trim()}`;
    if (!line.trim() || sig === lastAutoSig) return; // estä duplikaatit
    setLastAutoSig(sig);

    if (reason === "pause") {
      lastPauseRef.current = { line: (line || "").trim(), at: Date.now() };
    }

    setError("");
    setLoading(true);
    try {
      const prompt = buildPromptSmart(line);
      setLastPromptBasis(line);              // talteen mahdollisia dev-käyttöjä varten
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, temperature: 1.0 }), // villiys aina maksimi
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setRenkiText((t) => `${t}${t && !t.endsWith("\n") ? "\n" : ""}${data.text || "(tyhjä vastaus)"}\n`);
    } catch (e) {
      setError(`Ehdotusten haku epäonnistui: ${e.message}`);
    } finally {
      setLoading(false);
      // Näytä esikatselussa TÄSMÄLLEEN sama promptti kuin API:lle
      if (devMode) setPromptPreview(prompt);
    }
  };

  // --- Auto-scroll Ehdotukset-ikkunaan ---
  useEffect(() => {
    const el = renkiRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [renkiText]);

  // --- Toolbar-toiminnot ---
  const insertAtCursor = (snippet) => {
    const el = authorRef.current;
    if (!el) return;
    const start = el.selectionStart ?? authorText.length;
    const end = el.selectionEnd ?? authorText.length;
    const before = authorText.slice(0, start);
    const after = authorText.slice(end);
    const next = `${before}${snippet}${after}`;
    setAuthorTextWithHistory(next);
    setTimeout(() => {
      const pos = start + snippet.length;
      el.focus();
      el.setSelectionRange(pos, pos);
      bumpSel();
    }, 0);
  };

  const copyRenkiToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(renkiText);
    } catch {}
  };

  // --- Undo/Redo yksinkertaisena pinona ---
  const [hist, setHist] = useState([""]);
  const [hIdx, setHIdx] = useState(0);
  const setAuthorTextWithHistory = (val) => {
    setAuthorText(val);
    setHist((h) => {
      const h2 = h.slice(0, hIdx + 1);
      h2.push(val);
      return h2.slice(-50);
    });
    setHIdx((i) => Math.min(i + 1, 49));
  };
  const undo = () => {
    setHIdx((i) => Math.max(0, i - 1));
    setAuthorText((_, __) => hist[Math.max(0, hIdx - 1)]);
    bumpSel();
  };
  const redo = () => {
    setHIdx((i) => Math.min(hist.length - 1, i + 1));
    setAuthorText((_, __) => hist[Math.min(hist.length - 1, hIdx + 1)]);
    bumpSel();
  };

  // --- Render ---
  return (
    <div style={pageWrap}>
      <header id="hdr" style={headerWrap}>
        <div style={brandLine}>
          <div style={logoWrap}>
            <div style={logoMark} aria-hidden>♪</div>
            <div style={brandText}>Lyriikkarenki</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button title="Käyttöohje ( ? )" style={ghostBtn} onClick={() => setShowHelp(true)}>?</button>
            <button style={ghostBtn} onClick={() => setShowSettings((s) => !s)}>
              {showSettings ? "Piilota asetukset" : "Näytä asetukset"}
            </button>
          </div>
        </div>
      </header>

      {showSettings && (
        <section id="settings" style={settingsWrap}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <label htmlFor="wild" style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>Lennokkuus (0–1)</label>
              <input
                id="wild"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={wildness}
                onChange={(e) => setWildness(Number(e.target.value))}
                style={{ width: "100%" }}
              />
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                Vaikuttaa kielikuvien villiyteen ja ehdotusten rohkeuteen.
              </div>
            </div>

            <div>
              <label htmlFor="ff" style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
                Vapaamuotoinen ohje tekoälylle
              </label>
              <textarea
                value={freeform}
                onChange={(e) => setFreeform(e.target.value)}
                rows={3}
                placeholder="Esim. 'sävy melankolinen', 'vältä anglismeja', '8 tavua / rivi'..."
                style={{ ...baseTextarea, minHeight: 0, height: "auto" }}
              />
            </div>

            {devMode && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={devBadge}>DEV</span>
                  <strong>AI-prompt (esikatselu)</strong>
                  <span style={{ color: "#6b7280", fontSize: 12 }}>(päivittyy kun kirjoitat tai muutat asetuksia)</span>
                </div>
                <pre style={promptPreviewStyle}>{promptPreview}</pre>
              </div>
            )}
          </div>
        </section>
      )}

      <section id="toolbar" style={toolbarWrap}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={primaryBtn} onClick={askSuggestions}>EHDOTA (valinnasta)</button>
          <button style={ghostBtn} title="Peruuta (Ctrl+Z)" onClick={undo}>Peruuta</button>
          <button style={ghostBtn} title="Tee uudestaan (Ctrl+Y)" onClick={redo}>Tee uudestaan</button>
          <button style={ghostBtn} onClick={() => insertAtCursor("\n")} title="Rivinvaihto">↵</button>
          <button style={ghostBtn} onClick={copyRenkiToClipboard} title="Kopioi ehdotukset leikepöydälle">Kopioi ehdotukset</button>
          <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={devMode} onChange={(e) => setDevMode(e.target.checked)} /> DEV-tila
          </label>
        </div>
      </section>

      <main style={{ ...mainWrap, minHeight: paneAreaHeight }}>
        <section style={{ ...pane, height: paneAreaHeight }}>
          <h2 style={paneHeader}>Sanoitus</h2>
          <textarea
            ref={authorRef}
            value={authorText}
            onChange={(e) => {
              lastPauseRef.current = { line: "", at: 0 };
              const textNow = e.target.value;
              setAuthorTextWithHistory(textNow);
              bumpSel();

              // Käytä UUTTA arvoa ja caretia -> ei katoa viimeinen merkki
              if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
              const caret = e.target.selectionEnd ?? textNow.length;
              const line = getLineAt(textNow, caret);
              const lw = lastWord(line);
              if (lw && lw.length >= 4) {
                typingTimerRef.current = setTimeout(() => {
                  askSmartSuggestions(line.trim(), "pause");
                }, AUTO_DELAY_MS);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const caret = e.currentTarget.selectionEnd ?? authorText.length;
                const lineBeforeBreak = getLineAt(authorText, caret);
                const lineTrim = (lineBeforeBreak || "").trim();

                // Estä enter-haku, jos samasta rivistä tehtiin juuri "pause"-autohaku
                const { line, at } = lastPauseRef.current || {};
                const RECENT_MS = 60_000; // Enter-haku sallitaan vasta 60 s jälkeen tai kun rivi muuttuu
                const justPausedSameLine = line && line === lineTrim && Date.now() - at < RECENT_MS;
                if (justPausedSameLine) {
                  // ei hakua – käyttäjä vain teki rivinvaihdon aiemmin autohakuiltuun riviin
                  return;
                }

                // Muuten tee normaali enter-haku
                setTimeout(() => askSmartSuggestions(lineBeforeBreak, "enter"), 0);
              }
            }}
            onBlur={() => {
              if (typingTimerRef.current) {
                clearTimeout(typingTimerRef.current);
                typingTimerRef.current = null;
              }
            }}
            placeholder={"Kirjoita sanoitusta tähän… (AI antaa synonyymejä, riimejä ja kielikuvia)"}
            style={{ ...baseTextarea, height: leftPaneHeight }}
          />
        </section>

        <section style={{ ...pane, height: paneAreaHeight }}>
          <h2 style={paneHeader}>Ehdotukset</h2>
          <pre ref={renkiRef} style={{ ...renkiArea, height: rightPaneHeight }}>{renkiText || "(Tähän ilmestyy ehdotuksia. Kirjoita vasemmalle.)"}</pre>
        </section>
      </main>

      <footer id="footer" style={footerWrap}>
        <div style={{ fontSize: 12, color: "#6b7280" }}>
          Vihje: pidä kohdistin rivin lopussa, odota pari sekuntia ja saat automaattisesti ehdotuksia.
        </div>
      </footer>

      {showHelp && (
        <div style={helpOverlay}>
          <div style={helpCard}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Lyriikkarenki – pikaohje</h3>
              <button style={ghostBtn} onClick={() => setShowHelp(false)}>✕</button>
            </div>
            <ol>
              <li>Kirjoita sanoitus vasemmalle. Pidä kursori rivin lopussa.</li>
              <li>Odota ~2–3 s → saat ehdotuksia automaattisesti.</li>
              <li>Enter tekee rivinvaihdon. Enter-haku estetään, jos samasta rivistä tuli jo hetki sitten autohaku.</li>
              <li>EHDOTA-painikkeella saat ehdotuksia valitusta tekstistä.</li>
            </ol>
            <p style={{ fontSize: 12, color: "#6b7280" }}>Vinkki: lisää vapaamuotoinen ohje asetuksista.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Tyylit ---
const pageWrap = {
  fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
  background: "linear-gradient(180deg,#fafafa, #ffffff)",
  minHeight: "100vh",
  padding: 0,
  width: "100vw",
  overflowX: "hidden",
};

const headerWrap = {
  position: "sticky",
  top: 0,
  zIndex: 10,
  background: "rgba(255,255,255,0.9)",
  backdropFilter: "saturate(120%) blur(6px)",
  borderBottom: "1px solid #e5e7eb",
};

const brandLine = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 16px",
};

const logoWrap = { display: "flex", alignItems: "center", gap: 10 };
const logoMark = {
  width: 28,
  height: 28,
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  display: "grid",
  placeItems: "center",
  fontSize: 16,
  lineHeight: "1",
};
const brandText = { fontWeight: 800, letterSpacing: 0.2 };

const settingsWrap = {
  padding: 16,
  borderBottom: "1px solid #e5e7eb",
  background: "#fff",
};

const toolbarWrap = {
  padding: 12,
  borderBottom: "1px solid #e5e7eb",
  background: "#fff",
};

const mainWrap = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 16,
  padding: 16,
};

const pane = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
};

const paneHeader = {
  margin: 0,
  padding: "10px 12px",
  background: "#f9fafb",
  borderBottom: "1px solid #e5e7eb",
};

const baseTextarea = {
  width: "100%",
  resize: "none",
  border: "none",
  outline: "none",
  padding: 12,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  fontSize: 14,
  lineHeight: 1.6,
  background: "#fff",
};

const renkiArea = {
  ...baseTextarea,
  whiteSpace: "pre-wrap",
  background: "#fcfcfd",
};

const footerWrap = {
  padding: 12,
  borderTop: "1px solid #e5e7eb",
  background: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const primaryBtn = {
  padding: "8px 12px",
  background: "#111827",
  color: "#fff",
  border: "1px solid #111827",
  borderRadius: 10,
  cursor: "pointer",
};

const ghostBtn = {
  padding: "8px 12px",
  background: "transparent",
  color: "#111827",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  cursor: "pointer",
};

const devBadge = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 6px",
  height: 18,
  borderRadius: 6,
  fontSize: 11,
  lineHeight: 1,
  fontWeight: 700,
  color: "#111827",
  background: "#e5e7eb",
  border: "1px solid #d1d5db",
};

const promptPreviewStyle = {
  whiteSpace: "pre-wrap",
  border: "1px dashed #e5e7eb",
  background: "#fafafa",
  borderRadius: 8,
  padding: 12,
  marginTop: 8,
  fontSize: 12,
  color: "#374151",
};

const helpOverlay = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.5)",
  display: "grid",
  placeItems: "center",
};

const helpCard = {
  width: "min(720px, 92vw)",
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 16,
};

// --- Apurit ---
const getLineAt = (text, caretEnd) => {
  const caret = typeof caretEnd === "number" ? caretEnd : text.length;
  const lineStart = text.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
  const nextNL = text.indexOf("\n", caret);
  const lineEnd = nextNL === -1 ? text.length : nextNL;
  return text.slice(lineStart, lineEnd); // ei trimmiä
};
