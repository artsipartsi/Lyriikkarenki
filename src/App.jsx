import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Lyriikkarenki – v0.12 (Help-overlay + auto-scroll Ehdotukset + MET/SYN/RHY always on)
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
  const devParam = qs.get("dev");
  const initialDev =
    devParam === "1" ? true : devParam === "0" ? false : localStorage.getItem("lr_dev") === "true";
  const [devMode, setDevMode] = useState(initialDev);
  useEffect(() => localStorage.setItem("lr_dev", String(devMode)), [devMode]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.altKey && (e.key === "d" || e.key === "D")) setDevMode((v) => !v);
      if (e.key === "Escape") setShowHelp(false); // Esc sulkee ohjeen
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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

  // --- Historia sanoittajalle ---
  const [history, setHistory] = useState([""]);
  const [histIndex, setHistIndex] = useState(0);
  const canUndo = histIndex > 0;
  const canRedo = histIndex < history.length - 1;

  const setAuthorTextWithHistory = (next) => {
    setAuthorText(next);
    setHistory((h) => {
      const newArr = h.slice(0, histIndex + 1);
      newArr.push(next);
      return newArr;
    });
    setHistIndex((i) => i + 1);
  };

  const undo = () => {
    if (!canUndo) return;
    const i = histIndex - 1;
    setHistIndex(i);
    setAuthorText(history[i]);
  };
  const redo = () => {
    if (!canRedo) return;
    const i = histIndex + 1;
    setHistIndex(i);
    setAuthorText(history[i]);
  };

  // --- Tila ---
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // --- Ref ---
  const authorRef = useRef(null);
  const renkiRef = useRef(null); // auto-scroll

  // --- Layout (responsiivinen sarake/rinnakkain) ---
  const isWide = useMediaQuery("(min-width: 900px)");
  const layoutCols = useMemo(
    () => ({
      display: "grid",
      gridTemplateColumns: isWide ? "1fr 1fr" : "1fr",
      gap: 12,
      alignItems: "stretch",
    }),
    [isWide]
  );

  // --- Promptin muodostus ---
  const [selTick, setSelTick] = useState(0);
  const bumpSel = () => setSelTick((t) => t + 1);

  const getSelectionOrCurrentLine = () => {
    const el = authorRef.current;
    if (!el) return "";
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    if (start !== end) return authorText.slice(start, end).trim();

    const text = authorText;
    const caret = start;
    const lineStart = text.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
    const nextNL = text.indexOf("\n", caret);
    const lineEnd = nextNL === -1 ? text.length : nextNL;
    return text.slice(lineStart, lineEnd).trim();
  };

  const buildPrompt = (basis) => {
    let p = `Teksti analysoitavaksi:\n"${basis}"\n\n`;
    const wants = [];
    // AINA päällä
    wants.push("kielikuvia", "synonyymejä", "riimiehdotuksia");
    if (wants.length) p += `Sisällytä: ${wants.join(", ")}.\n`;
    if (freeform.trim()) p += `Lisäohje: ${freeform.trim()}\n`;
    return p;
  };

  // Kehittäjätilan prompt-esikatselu
  const [promptPreview, setPromptPreview] = useState("");
  const refreshPromptPreview = () => {
    if (!devMode) return;
    const basis = getSelectionOrCurrentLine();
    setPromptPreview(buildPrompt(basis || "<ei valintaa / kursoririvi tyhjä>"));
  };
  useEffect(() => {
    refreshPromptPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devMode, authorText, wildness, freeform, selTick]);

  const askSuggestions = async () => {
    const basis = getSelectionOrCurrentLine();
    if (!basis) {
      setError("Valitse tekstiä tai siirrä kursori riville, josta haluat ehdotuksia.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const prompt = buildPrompt(basis);
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, temperature: 1.0 }),
      });
      if (!r.ok) throw new Error(`API-virhe ${r.status}: ${await r.text()}`);
      const data = await r.json();
      const content = (data?.content || "").trim();
      if (!content) throw new Error("Tyhjä vastaus.");
      setRenkiText((prev) => prev + `---------------\n${content}\n`);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
      refreshPromptPreview();
    }
  };

  // --- Auto-scroll Ehdotukset-ikkunaan ---
  useEffect(() => {
    const el = renkiRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [renkiText]);

  // --- Korkeuden laskenta (aina lukittu paneelialue, myös asetukset auki) ---
  const headerRef = useRef(null);
  const settingsRef = useRef(null);
  const toolbarRef = useRef(null);
  const footerRef = useRef(null);
  const [paneAreaHeight, setPaneAreaHeight] = useState(null);

  const MIN_ROWS = 5;
  const ROW_PX = 22;
  const TEXTAREA_EXTRA = 24;
  const PANEL_EXTRA = 56;
  const MIN_TEXTAREA_PX = MIN_ROWS * ROW_PX + TEXTAREA_EXTRA;
  const MIN_PANEL_PX = MIN_TEXTAREA_PX + PANEL_EXTRA;

  const recalcPaneHeight = () => {
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const hdr = headerRef.current?.getBoundingClientRect()?.height || 0;
    const set = settingsRef.current?.getBoundingClientRect()?.height || 0;
    const tlb = toolbarRef.current?.getBoundingClientRect()?.height || 0;
    const ftr = footerRef.current?.getBoundingClientRect()?.height || 0;

    const chrome = 32 + 12 + 8;
    const available = Math.max(0, Math.floor(vh - hdr - set - tlb - ftr - chrome));
    setPaneAreaHeight(available);
  };

  useEffect(() => {
    recalcPaneHeight();
    const onResize = () => recalcPaneHeight();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings, isWide]);

  // --- Render ---
  return (
    <div style={pageWrap}>
      {/* Sticky header */}
      <header ref={headerRef} style={headerWrap}>
        <div style={headerInner}>
          <div /> {/* vasen täytesarake */}

          <div style={titleRowCentered}>
            <div style={titleStyle}>Lyriikkarenki</div>
            <div style={versionInline}>v0.12 (gpt-4.1)</div>
          </div>

          {/* ?-nappi */}
          <button
            onClick={() => setShowHelp(true)}
            title="Näytä käyttöohje"
            style={iconBtn}
            aria-label="Käyttöohje"
          >
            <span style={iconGlyph}>?</span>
          </button>

          {/* Asetukset-nappi */}
          <button
            onClick={(e) => {
              setShowSettings((s) => !s);
              e.currentTarget.blur();
            }}
            title={showSettings ? "Piilota asetukset" : "Näytä asetukset"}
            style={iconBtn}
            aria-label="Asetukset"
          >
            <span style={iconGlyph}>⚙</span>
          </button>
        </div>
      </header>

      {/* Settings card */}
      {showSettings && (
        <section ref={settingsRef} style={card}>
          {/* Checkboxit poistettu – MET/SYN/RHY aina päällä */}

          <div style={{ marginTop: 0 }}>
            <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
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
                <span style={{ color: "#6b7280", fontSize: 12 }}>
                  (päivittyy valinnan/kurssorin ja asetusten mukaan)
                </span>
              </div>
              <textarea
                readOnly
                value={promptPreview}
                rows={8}
                style={{ ...baseTextarea, minHeight: 0, height: "auto", background: "#fcfcff" }}
              />
            </div>
          )}

          {error && <div style={{ color: "#b00020", marginTop: 8 }}>{error}</div>}
        </section>
      )}

      {/* Action bar */}
      <section ref={toolbarRef} style={toolbarCard}>
        <button onClick={askSuggestions} disabled={loading} style={primaryBtn}>
          {loading ? "Haetaan..." : "Ehdota"}
        </button>
        <span style={{ color: "#6b7280", fontSize: 12 }}>
          Vihje: Käytetään valittua tekstiä tai jos mitään ei ole valittu, niin käytetään kursorin riviä.
        </span>
      </section>

      {/* Two panes */}
      <section
        style={{
          ...layoutCols,
          height: paneAreaHeight ?? "auto",
          overflow: "hidden",
        }}
      >
        <div style={paneCardFlex}>
          <label style={paneTitle}>Sanoitus</label>
          <textarea
            ref={authorRef}
            value={authorText}
            onChange={(e) => {
              setAuthorTextWithHistory(e.target.value);
              bumpSel();
            }}
            onSelect={bumpSel}
            onKeyUp={bumpSel}
            onMouseUp={bumpSel}
            onFocus={bumpSel}
            onBlur={bumpSel}
            placeholder="Kirjoita tai liitä sanoitus tähän..."
            style={textareaFill(MIN_TEXTAREA_PX)}
          />
        </div>

        <div style={paneCardFlex}>
          <div style={paneHeaderRow}>
            <label style={{ ...paneTitle, marginBottom: 0 }}>Ehdotukset</label>
            <button
              onClick={() => setRenkiText("")}
              style={smallGhostBtn}
              title="Tyhjennä ehdotukset"
              aria-label="Tyhjennä ehdotukset"
            >
              Tyhjennä
            </button>
          </div>

          <textarea
            ref={renkiRef}
            value={renkiText}
            readOnly
            placeholder="Tähän kertyy kielikuvia, riimejä ja synonyymejä..."
            style={{ ...textareaFill(MIN_TEXTAREA_PX), background: "#f7f7f7" }}
          />
        </div>
      </section>

      <footer
        ref={footerRef}
        style={{ textAlign: "center", color: "#9ca3af", fontSize: 12, padding: "16px 0" }}
      >
        © {new Date().getFullYear()} Lyriikkarenki
      </footer>

      {/* --- HELP OVERLAY (koko ikkunan kokoinen) --- */}
      {showHelp && (
        <div role="dialog" aria-modal="true" style={helpOverlay}>
          <div style={helpInner}>
            <button
              onClick={() => setShowHelp(false)}
              aria-label="Sulje ohje"
              title="Sulje"
              style={helpCloseBtn}
            >
              ✕
            </button>

            <h1 style={{ marginTop: 0, marginBottom: 8 }}>Lyriikkarenki – käyttöohje</h1>
            <p style={{ marginTop: 0, color: "#6b7280" }}>
              Toimii kaikenkokoisilla laitteilla kännykästä läppäriin ja isoon ruutuun.
            </p>

            <h3>Mitä teen ensin?</h3>
            <ol>
              <li>Kirjoita tai liitä teksti <strong>Sanoitus</strong>-ikkunaan.</li>
              <li>Valitse tekstistä pätkä – tai jätä pelkkä kursori riville.</li>
              <li>(Valinnaista) Anna <strong>Vapaamuotoinen ohje</strong> (esim. “melankolinen, 8 tavua/rivi”).</li>
              <li>Paina <strong>Ehdota</strong>. Ehdotukset ilmestyvät oikealle ja skrollaavat näkyviin.</li>
            </ol>

            <h3>Vinkkejä</h3>
            <ul>
              <li><em>Valinta voittaa kursorin:</em> jos valitset tekstiä, analyysi tehdään siitä.</li>
              <li><em>Villiyden säätö:</em> nosta arvoa, kun haluat rohkeampia ideoita.</li>
              <li><em>Puhdas pöytä:</em> paina “Tyhjennä” Ehdotukset-otsikon vierestä.</li>
            </ul>

            <h3>Tekstieditorin perustoiminnot</h3>
            <p>
              <strong>Vapaamuotoinen ohje</strong>- ja <strong>Sanoitus</strong>-ikkunoissa toimivat tutut
              komennot: Valitse kaikki, Poista, Peru, Tee uudelleen, Kopioi, Leikkaa, Liitä…
              (Näppäinyhdistelmät vaihtelevat laitteesta riippuen.)
            </p>

            <p style={{ color: "#6b7280", fontSize: 12, marginTop: 24 }}>
              Sulje ohje painamalla ✕ tai Esc.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- helpers ---------------- */

function clamp01(x) {
  if (Number.isNaN(x)) return 0;
  return Math.min(1, Math.max(0, x));
}
function lsBool(key, fallback) {
  const v = localStorage.getItem(key);
  return v === null ? fallback : v === "true";
}
function useMediaQuery(query) {
  const [match, setMatch] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const handler = () => setMatch(m.matches);
    handler();
    m.addEventListener?.("change", handler);
    return () => m.removeEventListener?.("change", handler);
  }, [query]);
  return match;
}

/* ---------------- styles ---------------- */

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
  backdropFilter: "saturate(180%) blur(6px)",
  borderBottom: "1px solid #eee",
};

const headerInner = {
  maxWidth: "none",
  margin: 0,
  display: "grid",
  gridTemplateColumns: "40px 1fr 40px 40px", // vasen täyte | otsikko | ? | ⚙
  alignItems: "center",
  padding: "10px 12px",
  columnGap: 8,
};

const card = {
  width: "100%",
  maxWidth: "none",
  margin: "12px 0",
  background: "white",
  border: "1px solid #eee",
  borderRadius: 0,
  padding: 14,
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
};

const toolbarCard = {
  ...card,
  display: "flex",
  alignItems: "center",
  gap: 12,
  paddingTop: 10,
  paddingBottom: 10,
  flexWrap: "wrap",
};

const paneCard = {
  background: "white",
  border: "1px solid #eee",
  borderRadius: 12,
  padding: 12,
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
};

const paneCardFlex = {
  ...paneCard,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  height: "100%",
};

const paneTitle = { fontWeight: 600, display: "block", marginBottom: 6 };

const baseTextarea = {
  width: "100%",
  resize: "none",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #ddd",
  outline: "none",
  background: "white",
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  lineHeight: 1.4,
};

const textareaFill = (minPx) => ({
  ...baseTextarea,
  flex: 1,
  minHeight: minPx,
});

const btnStyle = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "white",
  cursor: "pointer",
  transition: "transform .02s ease",
};
const primaryBtn = {
  ...btnStyle,
  background: "#111827",
  color: "white",
  borderColor: "#111827",
};

const iconBtn = {
  width: 32,
  height: 32,
  border: "none",
  outline: "none",
  background: "transparent",
  color: "#111827",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
};

const iconGlyph = { fontSize: 20, lineHeight: 1, display: "block" };

const devBadge = {
  display: "inline-block",
  padding: "1px 6px",
  borderRadius: 6,
  fontSize: 11,
  background: "#eef2ff",
  color: "#3730a3",
  border: "1px solid #c7d2fe",
};

const titleRowCentered = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  justifySelf: "center",
  width: "max-content",
  textAlign: "center",
};

const titleStyle = {
  fontSize: 22,
  fontWeight: 800,
  letterSpacing: 0.2,
  margin: 0,
  lineHeight: 1.05,
};

const versionInline = {
  fontSize: 14,
  color: "#6b7280",
  lineHeight: 1,
};

const paneHeaderRow = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 6,
};

const smallGhostBtn = {
  ...btnStyle,
  padding: "6px 10px",
  background: "transparent",
  borderColor: "#e5e7eb",
};

const rangeFull = {
  width: "95%",
  boxSizing: "border-box",
  marginTop: 8,
  marginRight: 8,
  paddingInline: 0,
};

/* -------- HELP OVERLAY styles -------- */

const helpOverlay = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  background: "rgba(0,0,0,0.5)",
  backdropFilter: "blur(2px)",
  display: "grid",
  placeItems: "center",
};

const helpInner = {
  width: "min(920px, 92vw)",
  height: "min(86vh, 960px)",
  background: "white",
  borderRadius: 14,
  border: "1px solid #e5e7eb",
  boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
  padding: 20,
  boxSizing: "border-box",
  overflow: "auto",
  position: "relative",
};

const helpCloseBtn = {
  position: "absolute",
  top: 10,
  right: 10,
  width: 36,
  height: 36,
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  background: "white",
  cursor: "pointer",
  fontSize: 18,
  lineHeight: "18px",
};
