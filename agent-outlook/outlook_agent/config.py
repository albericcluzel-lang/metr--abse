"""Paramètres de l'agent : catégories de tri et réglages lus dans l'environnement."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

PROJECT_DIR = Path(__file__).resolve().parent.parent


class ConfigError(RuntimeError):
    """Réglage manquant ou invalide."""


class FatalError(RuntimeError):
    """Erreur qui toucherait tous les mails (clé refusée, connexion expirée...) : le passage s'arrête."""


@dataclass(frozen=True)
class Category:
    key: str          # identifiant renvoyé par l'IA
    folder: str       # dossier Outlook, créé sous la Boîte de réception
    label: str        # catégorie Outlook (pastille de couleur)
    color: str        # couleur Outlook : preset0 à preset24
    description: str  # consigne donnée à l'IA


# Pour changer le tri : modifier, ajouter ou retirer des lignes ici.
CATEGORIES: tuple[Category, ...] = (
    Category(
        "chantier", "Chantier en cours", "Chantier", "preset7",
        "Chantiers en cours : comptes rendus de réunion de chantier, planning et avancement, "
        "OPR, réserves et levées de réserves, photos, incidents ou aléas sur site, coordination "
        "entre lots, accès au chantier, livraisons attendues sur site, échanges avec le maître "
        "d'ouvrage ou le client à propos d'un chantier.",
    ),
    Category(
        "fournisseurs", "Fournisseurs et sous-traitants", "Fournisseurs", "preset4",
        "Fournisseurs, négoces et sous-traitants : commandes, accusés de réception, bons de "
        "livraison, disponibilités et délais, relances d'entreprises, planning d'intervention, "
        "documents de sous-traitance (Kbis, URSSAF, assurances), fiches techniques.",
    ),
    Category(
        "devis_factures", "Devis et factures", "Devis-Factures", "preset3",
        "Argent : devis, factures, avoirs, situations de travaux, acomptes, retenues de garantie, "
        "relances de paiement, bons de commande chiffrés, décompte général définitif, tout "
        "échange portant sur un montant.",
    ),
    Category(
        "moe_bet_controle", "MOE - BET - Contrôle", "MOE-BET-Contrôle", "preset8",
        "Maîtrise d'œuvre et intervenants techniques : architecte, maître d'œuvre, BET (structure, "
        "fluides, thermique, acoustique), bureau de contrôle (rapports, avis), géomètre, OPC, "
        "plans et indices de plans, notes de calcul, visas, comptes rendus de MOE.",
    ),
    Category(
        "securite", "Sécurité et réglementaire", "Sécurité", "preset15",
        "Sécurité et réglementaire : PPSPS, plan de prévention, coordinateur SPS, accidents du "
        "travail, DUERP, habilitations et formations sécurité, EPI, amiante et plomb, DICT/DT, "
        "inspection du travail, CARSAT, OPPBTP, normes et DTU, accessibilité, déclarations "
        "administratives de chantier.",
    ),
    Category(
        "administratif", "Administratif", "Administratif", "preset12",
        "Administratif et vie de l'entreprise : RH, congés, notes de service, assurances, "
        "contrats, comptabilité interne, informatique, réunions internes, formations, "
        "déplacements, notes de frais.",
    ),
    Category(
        "newsletters", "Newsletters et pubs", "Newsletter", "preset13",
        "Newsletters, publicités, prospection commerciale non sollicitée, webinaires, "
        "notifications automatiques sans action à mener, offres promotionnelles.",
    ),
)

# Un mail urgent est rangé ici quel que soit son sujet (le sujet reste visible en catégorie).
URGENT_FOLDER = "À traiter urgent"

URGENT_LABEL = "Urgent"
ACTION_LABEL = "Action requise"
REVIEW_LABEL = "À vérifier"

# Catégories Outlook ajoutées en plus de celles des dossiers, avec leur couleur.
EXTRA_LABELS = {
    URGENT_LABEL: "preset0",
    ACTION_LABEL: "preset1",
    REVIEW_LABEL: "preset3",
}

DEFAULT_CONTEXT = (
    "Le destinataire est directeur de travaux dans le bâtiment : il pilote des chantiers et des "
    "entreprises sous-traitantes, commande à des fournisseurs et échange avec des maîtres "
    "d'ouvrage, maîtres d'œuvre, bureaux d'études et bureaux de contrôle."
)


DEFAULT_LLM_BASE_URL = "https://api.openai.com/v1"
LOCAL_HOSTS = ("localhost", "127.0.0.1", "::1")
# Comment obtenir une réponse structurée : « auto » essaie le schéma JSON strict, puis se replie
# sur le mode JSON simple, puis sur du texte, si le fournisseur refuse le format demandé.
JSON_MODES = ("auto", "schema", "json", "text")


@dataclass(frozen=True)
class Settings:
    client_id: str
    tenant_id: str
    scopes: tuple[str, ...]
    model: str
    home: Path
    body_chars: int
    min_confidence: float
    user_context: str
    # Fournisseur d'IA : tout service compatible avec l'API OpenAI (Mistral, Gemini, Ollama local...).
    llm_base_url: str = DEFAULT_LLM_BASE_URL
    llm_pause: float = 0.0        # secondes minimum entre deux appels (limites des offres gratuites)
    llm_max_retries: int = 2      # nouvelles tentatives du SDK sur saturation ou erreur passagère
    json_mode: str = "auto"
    # Paramètres envoyés au modèle seulement s'ils sont définis (chaque fournisseur a ses valeurs).
    llm_temperature: float | None = None
    llm_max_tokens: int | None = None
    llm_reasoning_effort: str | None = None

    @property
    def llm_is_local(self) -> bool:
        """Modèle qui tourne sur ce PC (Ollama, LM Studio) : rien ne sort de la machine."""
        return is_local_url(self.llm_base_url)

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv(PROJECT_DIR / ".env")
        home = Path(_env("OUTLOOK_AGENT_HOME", "~/.outlook_agent")).expanduser()
        try:
            body_chars = int(_env("OUTLOOK_BODY_CHARS", "1200"))
            min_confidence = float(_env("OUTLOOK_MIN_CONFIDENCE", "0.6").replace(",", "."))
            llm_pause = float(_env("OUTLOOK_LLM_PAUSE", "0").replace(",", "."))
            llm_max_retries = int(_env("OPENAI_MAX_RETRIES", "2"))
            base_url = _env("OPENAI_BASE_URL", DEFAULT_LLM_BASE_URL)
            local = is_local_url(base_url)
            # En local, Ollama répond au hasard sans température 0 et un petit modèle peut boucler
            # sans limite de longueur : valeurs sûres par défaut. Ailleurs, défaut du fournisseur.
            llm_temperature = _optional(_env("OUTLOOK_LLM_TEMPERATURE", "0" if local else "none"), float)
            llm_max_tokens = _optional(_env("OUTLOOK_LLM_MAX_TOKENS", "512" if local else "none"), int)
        except ValueError as exc:
            raise ConfigError(f"Valeur numérique invalide dans l'environnement : {exc}") from exc
        if not 0.0 <= min_confidence <= 1.0:
            raise ConfigError("OUTLOOK_MIN_CONFIDENCE doit être entre 0 et 1 (par exemple 0.6).")
        if body_chars < 1:
            raise ConfigError("OUTLOOK_BODY_CHARS doit être un nombre positif.")
        if llm_pause < 0 or llm_max_retries < 0:
            raise ConfigError("OUTLOOK_LLM_PAUSE et OPENAI_MAX_RETRIES ne peuvent pas être négatifs.")
        if llm_max_tokens is not None and llm_max_tokens < 1:
            raise ConfigError("OUTLOOK_LLM_MAX_TOKENS doit être un nombre positif (ou « none »).")
        json_mode = _env("OUTLOOK_JSON_MODE", "auto").lower()
        if json_mode not in JSON_MODES:
            raise ConfigError(f"OUTLOOK_JSON_MODE doit valoir {', '.join(JSON_MODES)}.")
        return cls(
            client_id=_env("OUTLOOK_CLIENT_ID"),
            tenant_id=_env("OUTLOOK_TENANT_ID", "organizations"),
            scopes=tuple(_env("OUTLOOK_SCOPES", "Mail.ReadWrite").split()),
            model=_env("OPENAI_MODEL", "gpt-4o-mini"),
            home=home,
            body_chars=body_chars,
            min_confidence=min_confidence,
            user_context=_env("OUTLOOK_AGENT_CONTEXT", DEFAULT_CONTEXT),
            llm_base_url=base_url,
            llm_pause=llm_pause,
            llm_max_retries=llm_max_retries,
            json_mode=json_mode,
            llm_temperature=llm_temperature,
            llm_max_tokens=llm_max_tokens,
            llm_reasoning_effort=_optional(_env("OUTLOOK_LLM_REASONING_EFFORT", "none"), str),
        )


def is_local_url(url: str) -> bool:
    return urlparse(url).hostname in LOCAL_HOSTS


def _env(name: str, default: str = "") -> str:
    """Variable d'environnement ; une valeur laissée vide dans .env compte comme absente."""
    return os.environ.get(name, "").strip() or default


def _optional(value: str, convert):
    """« none » (ou « aucun ») : paramètre non envoyé au modèle."""
    if value.lower() in ("none", "aucun"):
        return None
    return convert(value.replace(",", ".") if convert is float else value)
