# Agent de tri Outlook

Un petit programme qui lit les mails de votre boîte de réception Outlook (Microsoft 365), demande à une IA de les classer, puis les range dans des dossiers, leur donne une catégorie de couleur et signale les urgences. Il produit aussi un résumé de ce qui demande votre attention.

Il **ne supprime jamais** un mail, **n'envoie jamais** de message et **ne marque rien comme lu**. Par défaut il fonctionne en **simulation** : il montre ce qu'il ferait sans rien modifier.

## Comment il classe

| Dossier (créé sous la Boîte de réception) | Catégorie Outlook | Contenu |
|---|---|---|
| Chantier en cours | Chantier | comptes rendus, planning, réserves, aléas, échanges avec le maître d'ouvrage |
| Fournisseurs et sous-traitants | Fournisseurs | commandes, livraisons, relances, documents de sous-traitance |
| Devis et factures | Devis-Factures | devis, factures, situations, acomptes, relances de paiement |
| MOE - BET - Contrôle | MOE-BET-Contrôle | architecte, maître d'œuvre, bureaux d'études, bureau de contrôle, plans |
| Sécurité et réglementaire | Sécurité | PPSPS, coordinateur SPS, accidents, habilitations, normes |
| Administratif | Administratif | RH, assurances, contrats, vie de l'entreprise |
| Newsletters et pubs | Newsletter | publicités, prospection, notifications sans action |
| **À traiter urgent** | Urgent | tout mail qui exige une réaction sous 24 à 48 h, quel que soit le sujet |

Règles complémentaires :

- Un mail urgent est rangé dans « À traiter urgent », reçoit un drapeau rouge, et garde sa catégorie de sujet.
- Un mail où une action est attendue de votre part reçoit en plus la catégorie « Action requise ».
- **Dans le doute, l'agent ne range pas** : sous le seuil de confiance (0,6 par défaut) le mail reste dans la boîte de réception avec la catégorie « À vérifier ».
- Les invitations et réponses de réunion ne sont pas touchées.
- Un mail déjà traité n'est jamais analysé deux fois.

## Mise en place

### 1. Clé API OpenAI

L'abonnement ChatGPT Team ne donne **pas** accès à l'API : c'est un produit séparé, facturé à l'usage. Il faut donc :

1. aller sur <https://platform.openai.com> (avec votre compte professionnel si votre société a une organisation, sinon en demander la création à votre administrateur),
2. créer une clé dans **API keys**,
3. ajouter un petit crédit dans **Billing** et fixer une **limite de dépense mensuelle**.

Avec un modèle de type « mini », le coût pour quelques dizaines de mails par jour est très faible (de l'ordre d'1 € par mois ou moins) ; vérifiez la grille tarifaire en vigueur.

### 2. Application Microsoft (Entra ID)

Sur <https://entra.microsoft.com> :

1. **Applications → Inscriptions d'applications → Nouvelle inscription**.
   - Nom : `Agent Outlook`.
   - Types de comptes : *Comptes dans cet annuaire d'organisation uniquement*.
   - URI de redirection : laisser vide.
2. Dans l'application créée : **Authentification → Paramètres avancés → Autoriser les flux clients publics : Oui**. Enregistrer.
3. **Autorisations d'API → Ajouter une autorisation → Microsoft Graph → Autorisations déléguées** : cocher `Mail.ReadWrite`.
   - Facultatif : `MailboxSettings.ReadWrite`, uniquement pour que la commande `setup` crée aussi les catégories de couleur. Si vous l'ajoutez, mettez `OUTLOOK_SCOPES=Mail.ReadWrite MailboxSettings.ReadWrite` dans `.env`.
   - Si le bouton **Accorder le consentement administrateur** est nécessaire dans votre organisation, il faut l'administrateur.
4. Dans **Vue d'ensemble**, copier l'*ID d'application (client)* et l'*ID de l'annuaire (locataire)*.

L'autorisation est « déléguée » : l'agent agit en votre nom, uniquement sur votre boîte. `Mail.ReadWrite` ne permet pas d'envoyer de mail, et cette permission n'est pas demandée.

### 3. Installation

Il faut Python 3.10 ou plus. Depuis le dossier `agent-outlook` :

```
python -m venv .venv
.venv\Scripts\activate            # Windows   (Mac/Linux : source .venv/bin/activate)
pip install -r requirements.txt
copy .env.example .env            # Windows   (Mac/Linux : cp .env.example .env)
```

Ouvrir `.env` et renseigner `OUTLOOK_CLIENT_ID`, `OUTLOOK_TENANT_ID` et `OPENAI_API_KEY`.

### 4. Premier lancement

```
python -m outlook_agent login            # connexion Microsoft : suivre le message (code à saisir sur une page web)
python -m outlook_agent setup            # crée les dossiers dans Outlook (et les couleurs si la permission est donnée)
python -m outlook_agent run --limit 20   # SIMULATION sur les 20 derniers mails
```

Lisez le résultat : pour chaque mail, le dossier prévu, puis un résumé (urgents, actions à mener, répartition). Le résumé est aussi enregistré dans `dernier_resume.md`. Si le classement vous convient :

```
python -m outlook_agent run --apply
```

Si quelque chose ne va pas, **annulez le dernier passage**. Les mails reviennent dans la boîte de réception, et l'agent retire les catégories et le drapeau qu'il avait posés, sans toucher à ceux que vous avez ajoutés depuis :

```
python -m outlook_agent undo            # simulation
python -m outlook_agent undo --apply
```

Les mails annulés ne sont pas ré-analysés ensuite. Pour les reclasser après avoir modifié les réglages : `run --reprocess --apply`.

### 5. Automatiser

Le plus simple est une tâche planifiée sur votre PC (il doit être allumé). Windows, toutes les 15 minutes :

```
schtasks /Create /SC MINUTE /MO 15 /TN "Agent Outlook" /TR "cmd /c cd /d C:\chemin\vers\agent-outlook && .venv\Scripts\python.exe -m outlook_agent run --apply --since-days 2"
```

Mac/Linux (cron) :

```
*/15 * * * * cd ~/agent-outlook && .venv/bin/python -m outlook_agent run --apply --since-days 2
```

Une tâche planifiée ne se reconnecte jamais seule : si Microsoft demande une nouvelle connexion (jeton expiré, politique de sécurité), elle s'arrête avec un message ; relancez `login`.

## Personnaliser

- **Dossiers, catégories, consignes données à l'IA** : le fichier `outlook_agent/config.py`. Ajouter une ligne `Category(...)` suffit ; relancer `setup` pour créer le dossier.
- **Contexte métier** : variable `OUTLOOK_AGENT_CONTEXT` dans `.env` pour décrire votre activité en une ou deux phrases.
- **Prudence** : `OUTLOOK_MIN_CONFIDENCE` (0,6 par défaut) ou l'option `--min-confidence`. Plus le seuil est haut, plus de mails restent dans la boîte de réception.
- **Modèle** : `OPENAI_MODEL` (par défaut `gpt-4o-mini`). Si le modèle n'est plus disponible sur votre compte, choisissez-en un autre dans la liste de platform.openai.com.

## Sécurité et confidentialité

- **Le contenu des mails est envoyé à OpenAI** : l'expéditeur, l'objet, la date et les premiers caractères du corps (1200 par défaut, réglable avec `OUTLOOK_BODY_CHARS`). Les pièces jointes ne sont pas envoyées. Vérifiez la politique de votre société sur l'usage de l'IA avant de brancher une boîte professionnelle, et les conditions d'OpenAI sur les données transmises par l'API.
- Un mail piégé qui contient des instructions n'a pas de prise : l'IA ne peut répondre que par un choix dans la liste des catégories, et le programme ne fait rien d'autre que ranger.
- Le jeton de connexion, l'historique des actions (objets et expéditeurs des mails rangés) et l'état sont gardés dans `~/.outlook_agent/` (réglable avec `OUTLOOK_AGENT_HOME`), hors du dépôt. Le fichier `.env` contient la clé OpenAI : il est ignoré par git, ne le partagez pas.
- Fixez une limite de dépense sur la clé OpenAI.

## Dépannage

| Message | Cause probable |
|---|---|
| `AADSTS7000218` | « Autoriser les flux clients publics » n'est pas sur *Oui* (étape 2.2) |
| `AADSTS65001` | consentement non accordé : l'administrateur doit cliquer sur « Accorder le consentement administrateur » |
| `403` / `ErrorAccessDenied` de Graph | permission manquante dans l'application |
| `MailboxNotEnabledForRESTAPI` | boîte hébergée sur un Exchange interne : Microsoft Graph ne fonctionne qu'avec Exchange Online |
| `Connexion Microsoft requise` | relancer `python -m outlook_agent login` |

## Tests

```
pip install -r requirements-dev.txt
python -m pytest
```

Les tests utilisent une boîte mail simulée : ils ne contactent ni Microsoft ni OpenAI.
