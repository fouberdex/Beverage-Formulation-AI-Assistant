from __future__ import annotations

import os
from pathlib import Path

import streamlit as st

from beverage_rag.rag.pipeline import RagPipeline
from beverage_rag.settings import Settings


MODULE_ROOT = Path(__file__).resolve().parents[1]

st.set_page_config(page_title="Veille innovation BeverageDzAI", layout="wide")
st.markdown(
    """
    <style>
      :root { --brand:#0369a1; --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --canvas:#f7f8fc; }
      .stApp { background:var(--canvas); color:var(--ink); }
      [data-testid="stHeader"], #MainMenu, footer { display:none; }
      [data-testid="stAppViewContainer"] > .main { padding-top:1.5rem; }
      .block-container { max-width:1480px; padding:1.5rem 2rem 3rem; }
      [data-testid="stSidebar"] { background:#fff; border-right:1px solid var(--line); }
      [data-testid="stSidebar"] .block-container { padding:1.75rem 1.25rem; }
      [data-testid="stSidebar"] h2 { color:var(--ink); font-size:1rem; }
      .rag-hero { display:flex; align-items:flex-end; justify-content:space-between; gap:1rem;
        padding:1.65rem 1.9rem; margin-bottom:1.25rem; border:1px solid var(--line);
        border-radius:1.25rem; background:#fff; box-shadow:0 1px 3px rgba(15,23,42,.06); }
      .rag-kicker { display:inline-block; padding:.3rem .7rem; border-radius:999px; background:#f0f9ff;
        color:var(--brand); font-size:.68rem; font-weight:800; letter-spacing:.13em; text-transform:uppercase; }
      .rag-hero h1 { margin:.55rem 0 .3rem; color:var(--ink); font-size:2rem; letter-spacing:-.035em; }
      .rag-hero p { margin:0; color:var(--muted); font-size:.9rem; }
      .rag-mark { width:3.25rem; height:3.25rem; display:grid; place-items:center; border-radius:1rem;
        background:#f0f9ff; color:var(--brand); font-size:1.55rem; border:1px solid #bae6fd; }
      [data-testid="stVerticalBlockBorderWrapper"] { background:#fff; border-color:var(--line)!important;
        border-radius:1rem!important; box-shadow:0 1px 3px rgba(15,23,42,.05); }
      .stTextArea textarea, .stTextInput input, [data-baseweb="select"] > div {
        border-radius:.7rem!important; border-color:#cbd5e1!important; background:#fff!important; }
      .stButton > button[kind="primary"] { width:100%; border-radius:.75rem; border:0; background:var(--brand);
        color:#fff; font-weight:750; min-height:2.8rem; box-shadow:0 4px 12px rgba(3,105,161,.16); }
      .stButton > button[kind="primary"]:hover { background:#075985; }
      .stLinkButton a, .stButton > button[kind="secondary"] { border-radius:.65rem; border-color:#cbd5e1; }
      [data-testid="stMetric"] { padding:.8rem; border-radius:.8rem; background:#f8fafc; border:1px solid var(--line); }
      details { border-color:var(--line)!important; border-radius:.75rem!important; background:#fff; }
      h2, h3 { color:var(--ink)!important; letter-spacing:-.02em; }
      @media(max-width:700px){ .block-container{padding:1rem}.rag-mark{display:none}.rag-hero{padding:1.25rem}.rag-hero h1{font-size:1.6rem} }
    </style>
    <div class="rag-hero">
      <div><span class="rag-kicker">BeverageAI DZ · Evidence workspace</span>
      <h1>Veille Brevets &amp; Publications</h1>
      <p>Recherche hybride, reranking et génération contrôlée dans les sources publiques indexées localement.</p></div>
      <div class="rag-mark" aria-hidden="true">⌕</div>
    </div>
    """,
    unsafe_allow_html=True,
)


@st.cache_resource(show_spinner=False)
def load_pipeline(config_file: str) -> RagPipeline:
    settings = Settings.load(config_file)
    return RagPipeline(settings)

default_config = os.getenv(
    "BEVERAGE_RAG_CONFIG",
    str(MODULE_ROOT / "config" / "beverages-20k.yaml"),
)
config_path = st.sidebar.text_input("Configuration", default_config)
st.sidebar.markdown("### Périmètre documentaire")
source = st.sidebar.selectbox(
    "Source", ["Toutes", "google_patents_bigquery", "openalex", "semantic_scholar", "pubmed"]
)
with st.container(border=True):
    st.markdown("#### Interroger les preuves techniques")
    st.caption("Décrivez le produit, le défaut, les ingrédients, le procédé et les conditions de stockage.")
    question = st.text_area(
        "Question",
        placeholder="Quelles approches récentes améliorent la stabilité des arômes dans les sodas ?",
    )

if st.button("Rechercher", type="primary", disabled=not question.strip()):
    try:
        with st.spinner("Recherche et génération locales…"):
            pipeline = load_pipeline(config_path)
            result = pipeline.ask(
                question, source=None if source == "Toutes" else source
            )
        if result.diagnostics:
            diagnostic = result.diagnostics
            with st.expander(
                "État vérifiable du pipeline",
                expanded=diagnostic.status != "generated",
            ):
                left, accepted, middle, right = st.columns(4)
                left.metric("Passages récupérés", diagnostic.retrieved_chunks)
                accepted.metric("Preuves retenues", diagnostic.evidence_chunks)
                middle.metric("Tentatives retrieval", diagnostic.retrieval_attempts)
                right.metric(
                    "Meilleur score reranker",
                    f"{diagnostic.max_reranker_score:.4f}"
                    if diagnostic.max_reranker_score is not None
                    else "—",
                )
                if diagnostic.generation_invoked:
                    st.success(
                        f"Qwen appelé ({diagnostic.generation_attempts} tentative(s) de génération)."
                    )
                else:
                    st.warning("Qwen non appelé : arrêt déterministe avant génération.")
                if diagnostic.missing_mechanisms:
                    st.write("Mécanismes sans preuve suffisante : " + ", ".join(diagnostic.missing_mechanisms))
        st.subheader("Réponse")
        st.markdown(result.answer)
        if result.sources:
            st.subheader("Sources retenues")
        for item in result.sources:
            with st.expander(f"[{item.citation_id}] {item.label} — {item.title}"):
                st.write(f"Source : {item.source}")
                st.write(f"Section : {item.section}")
                st.write(f"Score hybride : {item.score:.4f}")
                if item.url:
                    st.link_button("Ouvrir la source publique", item.url)
        if result.retrieved_candidates:
            st.subheader("Passages récupérés mais rejetés comme preuves")
            st.caption(
                "Ces passages prouvent que l’index a été interrogé ; ils ne sont pas utilisés pour soutenir le diagnostic."
            )
            for item in result.retrieved_candidates:
                with st.expander(f"Candidat — {item.label} — {item.title}"):
                    st.write(f"Source : {item.source}")
                    st.write(f"Section : {item.section}")
                    st.write(f"Score reranker : {item.score:.4f}")
                    if item.url:
                        st.link_button("Ouvrir la source publique", item.url)
    except Exception as exc:
        st.error(str(exc))
