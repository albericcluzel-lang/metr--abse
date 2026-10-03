"""Paramètres de l'agent : catégories de tri et réglages lus dans l'environnement."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

PROJECT_DIR = Path(__file__).resolve().parent.parent


class ConfigError(RuntimeError):
    """Réglage manquant ou invalide."""


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

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv(PROJECT_DIR / ".env")
        load_dotenv()
        home = Path(os.environ.get("OUTLOOK_AGENT_HOME", "~/.outlook_agent")).expanduser()
        try:
            body_chars = int(os.environ.get("OUTLOOK_BODY_CHARS", "1200"))
            min_confidence = float(os.environ.get("OUTLOOK_MIN_CONFIDENCE", "0.6").replace(",", "."))
        except ValueError as exc:
            raise ConfigError(f"Valeur numérique invalide dans l'environnement : {exc}") from exc
        if not 0.0 <= min_confidence <= 1.0:
            raise ConfigError("OUTLOOK_MIN_CONFIDENCE doit être entre 0 et 1 (par exemple 0.6).")
        if body_chars < 1:
            raise ConfigError("OUTLOOK_BODY_CHARS doit être un nombre positif.")
        return cls(
            client_id=os.environ.get("OUTLOOK_CLIENT_ID", "").strip(),
            tenant_id=os.environ.get("OUTLOOK_TENANT_ID", "").strip() or "organizations",
            scopes=tuple(os.environ.get("OUTLOOK_SCOPES", "Mail.ReadWrite").split()),
            model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini").strip(),
            home=home,
            body_chars=body_chars,
            min_confidence=min_confidence,
            user_context=os.environ.get("OUTLOOK_AGENT_CONTEXT", DEFAULT_CONTEXT),
        )
