from __future__ import annotations

from pathlib import Path

import streamlit as st

from beverage_rag.rag.pipeline import RagPipeline
from beverage_rag.settings import Settings


MODULE_ROOT = Path(__file__).resolve().parents[1]

st.set_page_config(page_title="Veille innovation BeverageDzAI", layout="wide")
st.title("Veille Brevets & Publications")
st.caption("Recherche hybride dans des sources publiques indexées localement")

config_path = st.sidebar.text_input(
    "Configuration", str(MODULE_ROOT / "config" / "beverages-20k.yaml")
)
source = st.sidebar.selectbox(
    "Source", ["Toutes", "google_patents_bigquery", "openalex", "semantic_scholar", "pubmed"]
)
question = st.text_area(
    "Question",
    placeholder="Quelles approches récentes améliorent la stabilité des arômes dans les sodas ?",
)

if st.button("Rechercher", type="primary", disabled=not question.strip()):
    try:
        with st.spinner("Recherche et génération locales…"):
            settings = Settings.load(config_path)
            result = RagPipeline(settings).ask(
                question, source=None if source == "Toutes" else source
            )
        st.subheader("Réponse")
        st.markdown(result.answer)
        st.subheader("Sources récupérées")
        for item in result.sources:
            with st.expander(f"[{item.citation_id}] {item.label} — {item.title}"):
                st.write(f"Source : {item.source}")
                st.write(f"Section : {item.section}")
                st.write(f"Score hybride : {item.score:.4f}")
                if item.url:
                    st.link_button("Ouvrir la source publique", item.url)
    except Exception as exc:
        st.error(str(exc))
