import { useEffect, useMemo, useRef, useState } from "react";
import './App.css'

/**
 * Lyriikkarenki – perus-UI ja logiikka
 * - Otsikko + Asetukset (hammasratas)
 * - Valintaruudut: autoOnEnter, metaphors, synonyms, rhymes
 * - Painikkeet: ehdota, tyhjennä sanoittaja, peru, uudelleen, tyhjennä renki, piilota asetukset
 * - Vapaamuotoinen ohje
 * - Villiyden liukusäädin (0.0–1.0)
 * - Tekstikentät: Sanoittajan ikkuna (muokattava), Rengin ikkuna (readOnly)
 */

export default function App() {
  // UI state
  const [showSettings, setShowSettings] = useState(() => {
    const saved = localStorage.getItem("lr_showSettings");
    return saved ? saved === "true" : true;
  });

  // Options (persist to localStorage)
  const [autoOnEnter, setAutoOnEnter] = useState(() => lsBool("lr_autoOnEnter", false));
  const [wantMetaphors, setWantMetaphors] = useState(() => lsBool("lr_metaphors", true));
  const [wantSynonyms, setWantSynonyms] = useState(() => lsBool("lr_synonyms", true));
  const [wantRhymes, setWantRhymes] = useState(() => lsBool("lr_rhymes", true));
  const [wildness, setWildness] = useState(() => {
    const s = localStorage.getItem("lr_wildness");
    return s ? Number(s) : 0.7;
  });
  const [freeform, setFreeform] = useState(() => localStorage.getItem("lr_freeform") || "");

  // Main text areas
  const [authorText, setAuthorText] = useState("");
  const [renkiText, setRenkiText] = useState("");

  // Undo/redo history for author
  const [history, setHistory] = useState([""]);
  const [histIndex, setHistIndex] = useState(0);

  // Loading/error
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Refs
  const authorRef = useRef(null);
  const lastEnterFiredRef = useRef(false); // estetään tuplalaukaisu rivinvaihdosta

  // Persist options
  useEffect(() => localStorage.setItem("lr_showSettings", String(showSettings)), [showSettings]);
  useEffect(() => localStorage.setItem("lr_autoOnEnter", String(autoOnEnter)), [autoOnEnter]);
  useEffect(() => localStorage.setItem("lr_metaphors", String(wantMetaphors)), [wantMetaphors]);
  useEffect(() => localStorage.setItem("lr_synonyms", String(wantSynonyms)), [wantSynonyms]);
  useEffect(() => localStorage.setItem("lr_rhymes", String(wantRhymes)), [wantRhymes]);
  useEffect(() => localStorage.setItem("lr_wildness", String(wildness)), [wildness]);
  useEffect(() => localStorage.setItem("lr_freeform", freeform), [freeform]);

  // Update history when authorText changes by user typing (not programmatic undo/redo set)
  const setAuthorTextWithHistory = (next) => {
    setAuthorText(next);
    setHistory((h) => {
      const newArr = h.slice(0, histIndex + 1);
      newArr.push(next);
      return newArr;
    });
    setHistIndex((i) => i + 1);
  };

  const canUndo = histIndex > 0;
  const canRedo = histIndex < history.length - 1;

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

  // Helpers to get selection or last line
  const getSelectionOrLastLine = () => {
    const el = authorRef.current;
    if (!el) return { basis: "", type: "none" };

    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;

    if (start !== end) {
      return { basis: authorText.slice(start, end), type: "selection" };
    }

    // last line before caret
    const before = authorText.slice(0, start);
    const lines = before.split("\n");
    return { basis: lines[lines.length - 1] ?? "", type: "lastLine" };
  };

  // Prompt builder
  const buildPrompt = (basis) => {
    let p = `Analysoi annettu teksti ja tuota listamuotoisia ehdotuksia suomeksi.\n`;
    p += `Teksti: """${basis.trim()}"""\n\n`;

    const wants = [];
    if (wantMetaphors) wants.push("kielikuvia (metaforia, vertauskuvia)");
    if (wantSynonyms) wants.push("synonyymejä ja vaihtoehtoisia ilmauksia");
    if (wantRhymes) wants.push("riimiehdotuksia ja loppusointi-ideoita");

    if (wants.length) {
      p += `Sisällytä: ${wants.join(", ")}.\n`;
    } else {
      p += `Jos mitään erityistä ei pyydetä, ehdota ytimekkäitä parannuksia rivirakenteeseen tai sanavalintoihin.\n`;
    }

    if (freeform.trim()) {
      p += `\nLisäohje: ${freeform.trim()}\n`;
    }

    // Ohjeistetaan muoto
    p += `\nPalauta napakka luettelo (1–8 kohtaa). Jokainen kohta omalle rivilleen ilman selittelyä. Älä toista annettua tekstiä.\n`;

    return p;
  };

  // Call API
  const askSuggestions = async (explicitBasis) => {
    const basisObj = explicitBasis
      ? { basis: explicitBasis, type: "given" }
      : getSelectionOrLastLine();

    const basis = (basisObj.basis || "").trim();
    if (!basis) {
      setError("Valitse tekstiä tai kirjoita rivi ensin.");
      return;
    }
    setError("");
    setLoading(true);

    try {
      const prompt = buildPrompt(basis);
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          temperature: clamp01(wildness),
        }),
      });

      if (!r.ok) {
        const t = await r.text();
        throw new Error(`API-virhe ${r.status}: ${t}`);
      }

      const data = await r.json();
      const content = (data?.content || "").trim();
      if (!content) throw new Error("Tyhjä vastaus.");

      const stamp = new Date().toLocaleString();
      const toAppend = `--- Ehdotukset (${stamp}) ---\n${content}\n\n`;
      setRenkiText((prev) => prev + toAppend);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  // Handle Enter-triggered suggestions
  const onAuthorKeyDown = (e) => {
    if (e.key === "Enter") {
      // merkitään että Enter painettiin – käsitellään onChange:ssa tai blurissa
      lastEnterFiredRef.current = true;
    }
  };

  const onAuthorChange = (e) => {
    const next = e.target.value;
    const prev = authorText;

    setAuthorTextWithHistory(next);

    // automaattinen ehdotus – kun rivinvaihto lisättiin loppuun
    if (
      autoOnEnter &&
      lastEnterFiredRef.current &&
      next.length >= 1 &&
      next.length > prev.length &&
      next.endsWith("\n")
    ) {
      // otetaan viimeinen ei-tyhjä rivi (edellinen rivi)
      const lines = next.split("\n");
      const justCompleted = (lines[lines.length - 2] || "").trim();
      if (justCompleted) {
        // pieni viive, että caret ehtii asettua
        setTimeout(() => askSuggestions(justCompleted), 0);
      }
    }
    lastEnterFiredRef.current = false;
  };

  // Buttons
  const clearAuthor = () => {
    setAuthorText("");
    setHistory([""]);
    setHistIndex(0);
  };
  const clearRenki = () => setRenkiText("");

  // Simple responsive layout styles (voit korvata omilla CSS:illä)
  const layoutStyle = useMemo(
    () => ({
      display: "grid",
      gridTemplateColumns: "1fr",
      gap: "12px",
    }),
    []
  );

  const wideLayoutStyle = useMemo(
    () => ({
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "12px",
    }),
    []
  );

  const isWide = useMediaQuery("(min-width: 900px)");

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 16, maxWidth: 1200, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Lyriikkarenki</h1>
        <button
          onClick={() => setShowSettings((s) => !s)}
          title={showSettings ? "Piilota asetukset" : "Näytä asetukset"}
          style={iconButtonStyle}
          aria-label="Asetukset"
        >
          ⚙
        </button>
      </div>

      {/* Settings */}
      {showSettings && (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            padding: 12,
            marginBottom: 12,
            background: "#fafafa",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
            <label style={checkStyle}>
              <input
                type="checkbox"
                checked={autoOnEnter}
                onChange={(e) => setAutoOnEnter(e.target.checked)}
              />
              &nbsp;ehdotuksia tehdään joka rivinvaihdolla
            </label>
            <label style={checkStyle}>
              <input
                type="checkbox"
                checked={wantMetaphors}
                onChange={(e) => setWantMetaphors(e.target.checked)}
              />
              &nbsp;kielikuvia
            </label>
            <label style={checkStyle}>
              <input
                type="checkbox"
                checked={wantSynonyms}
                onChange={(e) => setWantSynonyms(e.target.checked)}
              />
              &nbsp;synonyymejä
            </label>
            <label style={checkStyle}>
              <input
                type="checkbox"
                checked={wantRhymes}
                onChange={(e) => setWantRhymes(e.target.checked)}
              />
              &nbsp;riimiehdotuksia
            </label>
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
              Vapaamuotoinen ohje tekoälylle
            </label>
            <textarea
              value={freeform}
              onChange={(e) => setFreeform(e.target.value)}
              rows={3}
              placeholder="Kerrot tähän lisäohjeen (esim. 'käytä 8 tavun rytmiä', 'älä käytä anglismeja', 'sävytä melankoliseksi' tms.)"
              style={textareaStyle}
            />
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={{ fontWeight: 600 }}>
              Ehdotusten villiys: {wildness.toFixed(2)}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={wildness}
              onChange={(e) => setWildness(Number(e.target.value))}
              style={{ width: "100%", marginTop: 8 }}
              aria-label="Villiyden liukusäädin"
            />
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            <button onClick={() => askSuggestions()} disabled={loading} style={primaryBtn}>
              {loading ? "Haetaan..." : "Ehdota"}
            </button>
            <button onClick={clearAuthor} style={btnStyle}>
              tyhjennä sanoittajan ikkuna
            </button>
            <button onClick={undo} disabled={!canUndo} style={btnStyle}>
              peru muutos (sanoittajan ikkunassa)
            </button>
            <button onClick={redo} disabled={!canRedo} style={btnStyle}>
              tee muutos uudelleen (sanoittajan ikkunassa)
            </button>
            <button onClick={clearRenki} style={btnStyle}>
              tyhjennä rengin ikkuna
            </button>
            <button onClick={() => setShowSettings(false)} style={btnStyle}>
              piilota asetukset
            </button>
          </div>

          {error && (
            <div style={{ color: "#b00020", marginTop: 8 }}>
              {error}
            </div>
          )}
        </div>
      )}

      {/* Two panes: author + renki */}
      <div style={isWide ? wideLayoutStyle : layoutStyle}>
        <div>
          <label style={{ fontWeight: 600, display: "block", marginBottom: 6 }}>Sanoittajan ikkuna</label>
          <textarea
            ref={authorRef}
            value={authorText}
            onChange={onAuthorChange}
            onKeyDown={onAuthorKeyDown}
            placeholder="Kirjoita tai liitä sanoitus tähän..."
            rows={20}
            style={textareaStyle}
          />
        </div>

        <div>
          <label style={{ fontWeight: 600, display: "block", marginBottom: 6 }}>Rengin ikkuna</label>
          <textarea
            value={renkiText}
            readOnly
            placeholder="Tähän kertyy kielikuvia, riimejä ja synonyymejä..."
            rows={20}
            style={{ ...textareaStyle, background: "#f7f7f7" }}
          />
        </div>
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */

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

/* ---------- styles ---------- */

const textareaStyle = {
  width: "100%",
  minHeight: 320,
  resize: "vertical",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #ddd",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  lineHeight: 1.4,
};

const checkStyle = {
  userSelect: "none",
};

const btnStyle = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #ccc",
  background: "white",
  cursor: "pointer",
};

const primaryBtn = {
  ...btnStyle,
  background: "#111827",
  color: "white",
  borderColor: "#111827",
};

const iconButtonStyle = {
  ...btnStyle,
  width: 40,
  height: 40,
  borderRadius: 10,
  fontSize: 20,
  lineHeight: "20px",
  display: "grid",
  placeItems: "center",
};
